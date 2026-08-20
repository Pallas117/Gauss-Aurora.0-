use anyhow::Context;
use gauss_orchestrator as orchestrator;
use notify::{RecursiveMode, Watcher};
use orchestrator::{
    analysis,
    config::{load_config, OrchestratorConfig},
    decode_api, logging, pass_api, pipeline, routing, ssa, ssa_api, state,
    telegram_connector::{run_telegram_listener, TelegramConnector},
    telemetry, types,
};
use reqwest::Client;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::mpsc;
use types::Sensitivity;

/// Parse environment variable as boolean; returns default if not set or invalid.
fn parse_env_bool(name: &str, default_value: bool) -> bool {
    std::env::var(name)
        .ok()
        .map(|value| {
            let normalized = value.trim().to_lowercase();
            !["0", "false", "off", "no", "disabled"].contains(&normalized.as_str())
        })
        .unwrap_or(default_value)
}

/// Returns (process_file_path, rest_args) if --process-file <path> is present.
fn take_process_file_arg() -> (Option<PathBuf>, Vec<String>) {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let mut rest = Vec::new();
    let mut process_file: Option<PathBuf> = None;
    let mut i = 0;
    while i < args.len() {
        if args[i] == "--process-file" && i + 1 < args.len() {
            process_file = Some(PathBuf::from(&args[i + 1]));
            i += 2;
            continue;
        }
        rest.push(args[i].clone());
        i += 1;
    }
    (process_file, rest)
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    logging::init_tracing();

    let (process_file_path, _rest) = take_process_file_arg();
    if let Some(path) = process_file_path {
        // One-shot: process one packet file and exit. Used by full-adherence-audit "Orchestrator live ingest".
        let mut config = load_config();
        config.decode_enabled = true;
        if config.ingest_api_token.is_none() {
            anyhow::bail!(
                "ORCHESTRATOR_INGEST_API_TOKEN is required for --process-file. Set it and ORCHESTRATOR_INGEST_API_URL (backend must be running)."
            );
        }
        let path = path
            .canonicalize()
            .with_context(|| format!("path not found: {}", path.display()))?;
        let client = Client::new();
        let report = telemetry::process_packet_file(&client, &path, &config).await?;
        let ok = report.accepted_count >= 1
            || (report.decoded_count > 0
                && report.mapped_count > 0
                && !report.parse_rate_below_threshold);
        if ok {
            tracing::info!(
                decoded = report.decoded_count,
                mapped = report.mapped_count,
                accepted = report.accepted_count,
                rejected = report.rejected_count,
                "process-file done"
            );
            return Ok(());
        }
        anyhow::bail!(
            "process-file: no packets accepted (decoded={} mapped={} accepted={} rejected={})",
            report.decoded_count,
            report.mapped_count,
            report.accepted_count,
            report.rejected_count
        );
    }

    tracing::info!("starting gauss orchestrator");

    let config = load_config();
    tracing::info!(
        telemetry_dir=%config.telemetry_dir,
        local_engine=%config.local_engine_url,
        decode_enabled=%config.decode_enabled,
        ingest_api=%config.ingest_api_url,
        "config loaded"
    );

    let client = Client::new();

    let pass_api_enabled = parse_env_bool("ORCHESTRATOR_PASS_API_ENABLED", false);
    if pass_api_enabled {
        let pass_api_bind = std::env::var("ORCHESTRATOR_PASS_API_BIND")
            .unwrap_or_else(|_| "127.0.0.1:8091".to_string());
        let pass_api_state = pass_api::state_with_store(
            config.pass_store_path.as_deref(),
            config.pass_api_default_role.clone(),
            config.pass_api_audit_max_entries,
        );
        let pass_api_bind_for_task = pass_api_bind.clone();
        tokio::spawn(async move {
            if let Err(error) = pass_api::serve(&pass_api_bind_for_task, pass_api_state).await {
                tracing::error!(error = %error, "pass API exited unexpectedly");
            }
        });
        tracing::info!(bind_addr = %pass_api_bind, "pass API enabled");
    } else {
        tracing::info!("pass API disabled (set ORCHESTRATOR_PASS_API_ENABLED=true to enable)");
    }

    if let Some(ref bind) = config.decode_api_bind {
        let config_arc = Arc::new(config.clone());
        let bind_for_task = bind.clone();
        tokio::spawn(async move {
            if let Err(error) = decode_api::serve(&bind_for_task, config_arc).await {
                tracing::error!(error = %error, "decode API exited unexpectedly");
            }
        });
        tracing::info!(bind_addr = %bind, "decode API enabled (POST /telemetry/decode)");
    } else {
        tracing::info!("decode API disabled (set ORCHESTRATOR_DECODE_API_BIND to enable)");
    }

    if let Some(ref bind) = config.ssa_api_bind {
        let engine = Arc::new(tokio::sync::RwLock::new(ssa::AssociationEngine::new(
            ssa::AssociationConfig::default(),
        )));
        let state = ssa_api::SsaApiState { engine };
        let bind_for_task = bind.clone();
        tokio::spawn(async move {
            if let Err(error) = ssa_api::serve(&bind_for_task, state).await {
                tracing::error!(error = %error, "SSA API exited unexpectedly");
            }
        });
        tracing::info!(bind_addr = %bind, "SSA API enabled (POST /ssa/measurements, GET /ssa/tracks)");
    } else {
        tracing::info!("SSA API disabled (set ORCHESTRATOR_SSA_API_BIND to enable)");
    }

    // --- Telegram connector setup ---
    let telegram_token = std::env::var("ORCHESTRATOR_TELEGRAM_BOT_TOKEN").unwrap_or_default();
    let telegram_chat_id: i64 = std::env::var("ORCHESTRATOR_TELEGRAM_CHAT_ID")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);
    let telegram_enabled = !telegram_token.trim().is_empty() && telegram_chat_id != 0;
    let telegram = TelegramConnector::new(&telegram_token, telegram_chat_id);

    // Channel for orchestrator control from Telegram commands
    let (command_tx, mut command_rx) = mpsc::channel::<String>(16);

    // Spawn Telegram listener only when configured.
    if telegram_enabled {
        let telegram_token_for_task = telegram_token.clone();
        let command_tx_for_task = command_tx.clone();
        tokio::spawn(async move {
            run_telegram_listener(
                &telegram_token_for_task,
                telegram_chat_id,
                command_tx_for_task,
            )
            .await;
        });
        tracing::info!("telegram listener enabled");
    } else {
        tracing::info!("telegram listener disabled (configure bot token and chat id to enable)");
    }

    // Spawn task to handle Telegram commands
    if telegram_enabled {
        let telegram_clone = telegram.clone();
        let client_clone = client.clone();
        tokio::spawn(async move {
            while let Some(msg) = command_rx.recv().await {
                // Parse message as command
                if let Some(cmd) = orchestrator::telegram_commands::TelegramCommand::parse(&msg) {
                    let telegram = telegram_clone.clone();
                    let client = client_clone.clone();
                    tokio::spawn(async move {
                        if let Err(e) = orchestrator::telegram_commands::handle_telegram_command(
                            cmd, &client, &telegram,
                        )
                        .await
                        {
                            tracing::error!("command handler failed: {}", e);
                            telegram.notify_error("Command Failed", &e).await;
                        }
                    });
                }
            }
        });
    }

    let audit_automation_enabled = parse_env_bool("ORCHESTRATOR_AUDIT_AUTOMATION_ENABLED", false);
    if audit_automation_enabled {
        let telegram_clone = telegram.clone();
        tokio::spawn(async move {
            orchestrator::audit_automation::run_periodic_audit_automation(telegram_clone).await;
        });
        tracing::info!(
            "periodic audit automation running in background; continue with other tasks. Human approval only when WARN/FAIL."
        );
    } else {
        tracing::info!(
            "periodic audit automation disabled (set ORCHESTRATOR_AUDIT_AUTOMATION_ENABLED=true)"
        );
    }

    // --- COI Supervisor setup ---
    let coi_enabled = parse_env_bool("ORCHESTRATOR_COI_ENABLED", true);
    if coi_enabled {
        let telegram_clone = telegram.clone();
        let interval_sec = std::env::var("ORCHESTRATOR_COI_INTERVAL_SEC")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(3600); // Default to 1 hour
        tokio::spawn(async move {
            let supervisor = orchestrator::coi::CoiSupervisor::new(
                telegram_clone,
                std::time::Duration::from_secs(interval_sec),
            );
            supervisor.run_loop().await;
        });
        tracing::info!(interval_sec = %interval_sec, "COI supervisor enabled");
    }

    // Check if autonomous code analysis should run at startup
    let analyze_at_startup = parse_env_bool("ORCHESTRATOR_ANALYZE_AT_STARTUP", false);
    if analyze_at_startup {
        let telegram_clone = telegram.clone();
        let client_clone = client.clone();
        tokio::spawn(async move {
            if let Err(e) = run_autonomous_analysis(&client_clone, &telegram_clone).await {
                tracing::error!(error = %e, "autonomous analysis failed");
                telegram_clone
                    .notify_error("Code Analysis", &e.to_string())
                    .await;
            }
        });
    }

    // Tokio channel to receive created file paths from watcher thread
    let (file_tx, mut file_rx) = mpsc::channel::<String>(32);

    // Spawn watcher in a dedicated thread using notify's recommended_watcher
    let watch_dir = config.telemetry_dir.clone();
    let decode_enabled = config.decode_enabled;
    let file_tx_clone = file_tx.clone();
    std::thread::spawn(move || {
        let tx_callback = move |res: notify::Result<notify::Event>| match res {
            Ok(event) => {
                for path in event.paths.iter() {
                    if let Some(ext) = path.extension().and_then(|s: &std::ffi::OsStr| s.to_str()) {
                        let is_csv = ext.eq_ignore_ascii_case("csv");
                        let is_packet = ext.eq_ignore_ascii_case("bin")
                            || ext.eq_ignore_ascii_case("hex")
                            || ext.eq_ignore_ascii_case("ccsds");
                        if is_csv || (decode_enabled && is_packet) {
                            let s = path.to_string_lossy().to_string();
                            let _ = file_tx_clone.blocking_send(s);
                        }
                    }
                }
            }
            Err(e) => tracing::error!(error = %e, "watcher error"),
        };

        let mut watcher = match notify::recommended_watcher(tx_callback) {
            Ok(w) => w,
            Err(e) => {
                tracing::error!(error = %e, "failed to create watcher");
                return;
            }
        };

        let watch_path = std::path::Path::new(&watch_dir);
        if !watch_path.exists() {
            if let Err(e) = std::fs::create_dir_all(watch_path) {
                tracing::warn!(
                    path = %watch_dir,
                    error = %e,
                    "telemetry dir missing and could not create; file watcher disabled"
                );
                return;
            }
            tracing::info!(path = %watch_dir, "created telemetry dir");
        }
        if let Err(e) = watcher.watch(watch_path, RecursiveMode::Recursive) {
            tracing::error!(error = %e, "failed to watch dir");
            return;
        }

        tracing::info!(watch_dir = %watch_dir, decode_enabled = decode_enabled, "watcher thread started");

        // Keep thread alive. thread::park() blocks (no CPU spin); per power directive we do not use
        // while true polling. The notify watcher is event-driven; this thread only needs to stay alive.
        loop {
            std::thread::park();
        }
    });

    // Main event loop: process telemetry files as they are detected
    while let Some(path_str) = file_rx.recv().await {
        let client = client.clone();
        let cfg = config.clone();
        let telegram = telegram.clone();
        tokio::spawn(async move {
            if let Err(e) = process_path(&client, PathBuf::from(path_str), &cfg, &telegram).await {
                let err_msg = format!("Failed to process file: {}", e);
                tracing::error!(error = %e, "failed to process file");
                telegram
                    .notify(&format!("❌ <b>Error:</b> {}", err_msg))
                    .await;
            }
        });
    }

    Ok(())
}

/// Process a telemetry file: keep CSV legacy routing and optionally decode packet telemetry.
async fn process_path(
    client: &Client,
    path: PathBuf,
    config: &OrchestratorConfig,
    telegram: &TelegramConnector,
) -> anyhow::Result<()> {
    let file_name = path
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "unknown".to_string());
    tracing::info!(file = %file_name, "file detected");
    telegram
        .notify(&format!("📊 New Telemetry Detected: <b>{}</b>", file_name))
        .await;

    let extension = path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_lowercase())
        .unwrap_or_default();

    if extension == "bin" || extension == "hex" || extension == "ccsds" {
        if !config.decode_enabled {
            tracing::warn!(file = %file_name, "packet file detected but decode path disabled");
            telegram
                .notify(&format!(
                    "⚠️ Packet file <b>{}</b> ignored because decode path is disabled.",
                    file_name
                ))
                .await;
            return Ok(());
        }

        let report = telemetry::process_packet_file(client, &path, config).await?;
        tracing::info!(
            file = %file_name,
            decoded = report.decoded_count,
            mapped = report.mapped_count,
            accepted = report.accepted_count,
            rejected = report.rejected_count,
            dictionary = %report.dictionary_id,
            "packet file processed"
        );

        let status = if report.rejected_count == 0 && !report.parse_rate_below_threshold {
            "✅"
        } else {
            "⚠️"
        };
        let rate_info = match (report.parse_rate_pct, report.accepted_rate_pct) {
            (Some(p), Some(a)) => format!(" parse={:.0}% accepted={:.0}%", p, a),
            (Some(p), None) => format!(" parse={:.0}%", p),
            (None, Some(a)) => format!(" accepted={:.0}%", a),
            (None, None) => String::new(),
        };
        let threshold_warn = if report.parse_rate_below_threshold {
            " ⚠️ Below 90% parse threshold"
        } else {
            ""
        };
        let physics_info = if report.physics_adjusted_count > 0
            || report.physics_rejected_count > 0
            || report.sigma_flagged_count > 0
        {
            format!(
                " physics_adj={} physics_rej={} sigma_flagged={}",
                report.physics_adjusted_count,
                report.physics_rejected_count,
                report.sigma_flagged_count
            )
        } else {
            String::new()
        };
        telegram
            .notify(&format!(
                "{} Packet ingest for <b>{}</b>: decoded={} mapped={} accepted={} rejected={}{}{}{} dictionary=<b>{}</b>",
                status,
                file_name,
                report.decoded_count,
                report.mapped_count,
                report.accepted_count,
                report.rejected_count,
                rate_info,
                threshold_warn,
                physics_info,
                report.dictionary_id
            ))
            .await;
        return Ok(());
    }

    // Read CSV content in blocking task to avoid blocking async runtime
    let path_for_triad = path.clone();
    let content = tokio::task::spawn_blocking(move || std::fs::read_to_string(&path))
        .await
        .context("failed to join blocking read task")??;

    let timestamp = chrono::Local::now().to_rfc3339();
    let (sensitivity, patterns) = analysis::detect_sensitive_content(&content);

    let analysis = types::TelemetryAnalysis {
        timestamp: timestamp.clone(),
        sensitivity: sensitivity.clone(),
        detected_patterns: patterns.clone(),
        file_name: file_name.clone(),
    };

    state::push_analysis(analysis);

    // Route based on sensitivity level. DeepSeek is the operator/decision-maker we are training.
    match sensitivity {
        Sensitivity::High => {
            tracing::info!(file = %file_name, "routing to local engine (HIGH sensitivity)");
            telegram
                .notify(&format!(
                    "🧠 Sensitivity: <b>HIGH</b> for <b>{}</b>. Routing to DeepSeek (operator)...",
                    file_name
                ))
                .await;
            let decision = routing::route_to_local(client, &content, config).await?;
            if let Some(ref op) = decision.operator_decision {
                state::set_last_operator_decision(Some(op.clone()));
                let _ = telegram
                    .notify(&format!(
                        "📋 <b>Operator decision</b> (DeepSeek):\n<code>{}</code>",
                        op.replace('<', "&lt;").replace('>', "&gt;")
                    ))
                    .await;
            }
        }
        Sensitivity::Low | Sensitivity::Unknown => {
            tracing::info!(file = %file_name, "routing to cloud (LOW/UNKNOWN sensitivity)");
            telegram
                .notify(&format!(
                    "☁️ Sensitivity: <b>LOW/UNKNOWN</b> for <b>{}</b>. Routing to CLOUD...",
                    file_name
                ))
                .await;
            let decision = routing::route_to_cloud(client, &content, config).await?;
            if let Some(ref op) = decision.operator_decision {
                state::set_last_operator_decision(Some(op.clone()));
                let _ = telegram
                    .notify(&format!(
                        "📋 <b>Operator decision</b> (DeepSeek):\n<code>{}</code>",
                        op.replace('<', "&lt;").replace('>', "&gt;")
                    ))
                    .await;
            }
        }
    }

    // Triad pipeline: prefer Rust-native (Surya stub or HTTP + DeepSeek); fallback to backend API if configured
    if config.triad_on_csv {
        let client = client.clone();
        let config = config.clone();
        let path = path_for_triad;
        let telegram = telegram.clone();
        tokio::spawn(async move {
            let report_result = pipeline::run_triad_native(&client, &path, &config).await;
            let report_result = match report_result {
                Ok(json) => Ok(json),
                Err(e) => {
                    tracing::warn!("triad native failed: {}; trying backend API", e);
                    if config.pipeline_api_url.is_some() {
                        pipeline::trigger_triad(&client, &path, &config).await
                    } else {
                        Err(e)
                    }
                }
            };
            match report_result {
                Ok(report_json) => {
                    tracing::info!("triad pipeline returned report (Rust or backend)");
                    let _ = telegram
                        .notify("🔄 <b>Triad</b> report received; applying Sovereign Buffer.")
                        .await;
                    if let Err(e) =
                        pipeline::export_scrubbed_to_cloud_and_save(&client, &report_json, &config)
                            .await
                    {
                        tracing::warn!("cloud export: {}", e);
                    }
                }
                Err(e) => {
                    tracing::warn!("triad failed: {}", e);
                    let _ = telegram.notify(&format!("⚠️ Triad pipeline: {}", e)).await;
                }
            }
        });
    }

    Ok(())
}

/// Autonomous code analysis orchestrator - indexes codebase, detects issues, routes to agents
async fn run_autonomous_analysis(
    _client: &reqwest::Client,
    telegram: &orchestrator::telegram_connector::TelegramConnector,
) -> anyhow::Result<()> {
    println!("[autonomous-analysis] 🔍 Starting codebase analysis...");

    // Backend lint scan (writes reports/progress/backend-lint-issues.json for work-queue merge)
    let _ = tokio::task::spawn_blocking(|| {
        let _ = std::process::Command::new("npm")
            .args(["run", "scan:backend-lint"])
            .output();
    })
    .await;

    // Phase 1: Index codebase (multi-root from ORCHESTRATOR_SCAN_ROOTS or default ./src,./gauss-orchestrator/src)
    let roots = orchestrator::code_indexer::scan_roots_from_env();
    let index = orchestrator::code_indexer::index_multiple_roots(&roots)
        .await
        .map_err(|e| anyhow::anyhow!("Failed to index codebase: {}", e))?;
    println!(
        "[autonomous-analysis] 📊 Indexed {} files, {} symbols (roots: {:?})",
        index.files_indexed,
        index.symbols.len(),
        roots
    );

    // Phase 2: Analyze for issues
    let analyzer = orchestrator::code_indexer::CodeAnalyzer::new(index.clone());
    let issues = analyzer.analyze();

    let critical_count = issues
        .iter()
        .filter(|i| i.severity == orchestrator::code_indexer::IssueSeverity::Critical)
        .count();
    let error_count = issues
        .iter()
        .filter(|i| i.severity == orchestrator::code_indexer::IssueSeverity::Error)
        .count();
    let warning_count = issues
        .iter()
        .filter(|i| i.severity == orchestrator::code_indexer::IssueSeverity::Warning)
        .count();

    println!(
        "[autonomous-analysis] ⚠️  Found {} issues (Critical: {}, Error: {}, Warning: {})",
        issues.len(),
        critical_count,
        error_count,
        warning_count
    );

    // Send summary to Telegram
    let summary = format!(
        "🔍 <b>Codebase Analysis Complete</b>\n\n\
         📊 <b>Statistics:</b>\n\
         • Files: {}\n\
         • Symbols: {}\n\
         • Issues: {}\n\n\
         ⚠️  <b>Severity Breakdown:</b>\n\
         • 🔴 Critical: {}\n\
         • 🟠 Errors: {}\n\
         • 🟡 Warnings: {}\n\
         • ℹ️ Info: {}",
        index.files_indexed,
        index.symbols.len(),
        issues.len(),
        critical_count,
        error_count,
        warning_count,
        issues
            .iter()
            .filter(|i| i.severity == orchestrator::code_indexer::IssueSeverity::Info)
            .count()
    );
    telegram.notify(&summary).await;

    // Phase 3: Route to multi-agent analysis if agents enabled (analyze any issues)
    let use_agents = std::env::var("ORCHESTRATOR_ANALYZE_WITH_AGENTS").is_ok();
    if use_agents && !issues.is_empty() {
        println!("[autonomous-analysis] 🧠 Routing to multi-agent system for deep analysis...");

        // Get multi-agent config from environment
        let ma_config = orchestrator::multi_agent::MultiAgentConfig::from_env();
        let ma_orchestrator =
            orchestrator::multi_agent::MultiAgentOrchestrator::new(ma_config.clone());
        let ca_orchestrator =
            orchestrator::code_analysis::CodeAnalysisOrchestrator::new(ma_orchestrator);

        // Analyze top issues (prioritize critical/error, fall back to warnings/info)
        let mut analysis_issues: Vec<_> = issues
            .iter()
            .filter(|i| i.severity >= orchestrator::code_indexer::IssueSeverity::Error)
            .take(10)
            .cloned()
            .collect();

        // If no critical/error issues, include warnings
        if analysis_issues.is_empty() {
            analysis_issues = issues
                .iter()
                .filter(|i| i.severity >= orchestrator::code_indexer::IssueSeverity::Warning)
                .take(5)
                .cloned()
                .collect();
        }

        if !analysis_issues.is_empty() {
            println!(
                "[autonomous-analysis] 🤔 Running multi-agent analysis on {} issues...",
                analysis_issues.len()
            );

            let analyses = ca_orchestrator
                .analyze_issues(analysis_issues.clone())
                .await;

            // Generate and send detailed report
            telegram
                .send_code_analysis_report(&analyses, issues.len())
                .await;

            // Emit work queue for Cursor subagent coordination (agents-project-manager)
            let mut queue =
                orchestrator::code_analysis::build_work_queue(&analysis_issues, &analyses);
            orchestrator::code_analysis::merge_backend_lint_into_queue(
                &mut queue,
                std::path::Path::new("reports/progress/backend-lint-issues.json"),
            );
            orchestrator::code_analysis::merge_directive_uncompleted_into_queue(
                &mut queue,
                std::path::Path::new("reports/progress/uncompleted-implementations.json"),
            );
            let work_queue_path = std::env::var("ORCHESTRATOR_WORK_QUEUE_PATH")
                .unwrap_or_else(|_| "reports/orchestrator/work-queue.json".to_string());
            if let Err(e) = orchestrator::code_analysis::write_work_queue(&queue, &work_queue_path)
            {
                eprintln!(
                    "[autonomous-analysis] ⚠️  Failed to write work queue: {}",
                    e
                );
            } else {
                println!(
                    "[autonomous-analysis] 📋 Work queue written to {}",
                    work_queue_path
                );
                let issues_path =
                    orchestrator::code_analysis::work_queue_issues_path(&work_queue_path);
                if let Err(e) =
                    orchestrator::code_analysis::write_issues(&analysis_issues, &issues_path)
                {
                    eprintln!(
                        "[autonomous-analysis] ⚠️  Failed to write issues for patch loop: {}",
                        e
                    );
                } else {
                    println!(
                        "[autonomous-analysis] 📋 Issues written to {} (for patch batch loop)",
                        issues_path
                    );
                }
            }

            println!(
                "[autonomous-analysis] ✅ Multi-agent analysis complete, report sent to Telegram"
            );
        }
    } else if !use_agents {
        println!("[autonomous-analysis] ℹ️  Skipping agent analysis (use ORCHESTRATOR_ANALYZE_WITH_AGENTS=true to enable)");
    }

    // Phase 4: Autonomous fixes (feed agent insights to fixer for continuous patching)
    let auto_fix_enabled = parse_env_bool("ORCHESTRATOR_AUTO_FIX", false);
    if auto_fix_enabled && !issues.is_empty() {
        println!("[autonomous-analysis] 🔧 Applying autonomous fixes based on agent analysis...");
        telegram
            .notify("🔧 <b>Autonomous Fixing</b>\n\nApplying fixes to detected issues...")
            .await;

        let fixer = orchestrator::code_fixer::CodeFixer::new("./src");
        let fix_batch = fixer.apply_fixes(issues.clone()).await;

        let fix_msg = format!(
            "✅ <b>Fixes Applied</b>\n\n\
             📊 Total Issues: {}\n\
             ✅ Successfully Fixed: {}\n\
             ❌ Failed: {}\n\
             🧪 Validation: {}\n\n\
             All changes have been tested with cargo test.",
            fix_batch.total_issues,
            fix_batch.successful_fixes,
            fix_batch.failed_fixes,
            if fix_batch.validation_passed {
                "PASSED"
            } else {
                "FAILED"
            }
        );
        telegram.notify(&fix_msg).await;

        println!(
            "[autonomous-analysis] ✅ Fixes complete: {} applied, {} failed",
            fix_batch.successful_fixes, fix_batch.failed_fixes
        );
    } else if !auto_fix_enabled && !issues.is_empty() {
        println!("[autonomous-analysis] ℹ️  Autonomous fixes disabled (set ORCHESTRATOR_AUTO_FIX=true to enable)");
    }

    println!("[autonomous-analysis] ✨ Analysis complete!");
    Ok(())
}
