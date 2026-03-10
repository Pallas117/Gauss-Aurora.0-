use anyhow::{bail, Context};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::path::Path;
use std::time::Instant;
use uuid::Uuid;

use crate::config::OrchestratorConfig;

pub mod ccsds;
pub mod decoder_registry;
pub mod ingest_client;
pub mod mapping;
pub mod physics_validation;
pub mod quality;
pub mod xtce;

/// Result of decode + map only (no physics, no ingest). Used by the HTTP decode API.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DecodeMapResponse {
    pub decoded_count: usize,
    pub mapped_count: usize,
    pub format: String,
    pub dictionary_id: String,
    pub packets: Vec<MappedCanonicalPacket>,
    pub errors: Vec<DecodeError>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CcsdsPrimaryHeader {
    pub version: u8,
    pub packet_type: u8,
    pub sec_header_flag: bool,
    pub apid: u16,
    pub seq_flags: u8,
    pub seq_count: u16,
    pub data_length: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DecodeError {
    pub code: String,
    pub reason: String,
    pub file: String,
    pub offset: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DecodedPacket {
    pub timestamp: String,
    pub apid: u16,
    pub seq_count: u16,
    pub payload_hex: String,
    #[serde(skip)]
    pub payload: Vec<u8>,
    pub quality_flags: quality::PacketQualityFlags,
    pub uncertainty: quality::PacketUncertainty,
}

#[derive(Debug, Clone)]
pub struct DecodeBatch {
    pub packets: Vec<DecodedPacket>,
    pub errors: Vec<DecodeError>,
    pub format: decoder_registry::DecoderFormat,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MappedCanonicalPacket {
    pub timestamp: String,
    pub apid: u16,
    pub seq_count: u16,
    pub payload_hex: String,
    pub canonical_point: Value,
    pub quality_flags: Value,
    pub uncertainty: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PacketProcessSummary {
    pub run_id: String,
    pub format: String,
    pub dictionary_id: String,
    pub decoded_count: usize,
    pub mapped_count: usize,
    pub accepted_count: usize,
    pub rejected_count: usize,
    pub errors: Vec<DecodeError>,
    /// Parse rate (mapped / decoded) as percentage, when decoded_count > 0.
    pub parse_rate_pct: Option<f64>,
    /// Accepted rate (accepted / mapped) as percentage, when mapped_count > 0.
    pub accepted_rate_pct: Option<f64>,
    /// Packets adjusted by physics validation (clamped).
    pub physics_adjusted_count: usize,
    /// Packets rejected by physics validation (out of range when not clamping).
    pub physics_rejected_count: usize,
    /// Whether the batch was below min_parse_rate threshold (ingest may still have been attempted).
    pub parse_rate_below_threshold: bool,
    /// Packets flagged or dropped by 3-sigma statistical anomaly pass (when ORCHESTRATOR_PHYSICS_SIGMA_REJECT enabled).
    pub sigma_flagged_count: usize,
}

#[tracing::instrument(skip(client, config), fields(file = %path.display()))]
pub async fn process_packet_file(
    client: &Client,
    path: &Path,
    config: &OrchestratorConfig,
) -> anyhow::Result<PacketProcessSummary> {
    let start = Instant::now();
    if !config.decode_enabled {
        bail!("Packet decode path disabled (ORCHESTRATOR_DECODE_ENABLED=false)");
    }

    let file_bytes = std::fs::read(path)
        .with_context(|| format!("failed to read packet file {}", path.display()))?;
    if file_bytes.len() > config.packet_max_bytes {
        bail!(
            "packet file exceeds max bytes ({} > {})",
            file_bytes.len(),
            config.packet_max_bytes
        );
    }

    let decode_batch = decoder_registry::decode_packet_file(path, &file_bytes, config)?;
    let dictionary = xtce::load_xtce_dictionary(Path::new(&config.xtce_path))?;
    let apid_map = mapping::load_apid_map(Path::new(&config.apid_map_path), &dictionary)?;
    let (mapped_packets, mapping_errors) =
        mapping::map_decoded_packets(path, &decode_batch.packets, &apid_map, &dictionary);

    let mut all_errors = decode_batch.errors;
    all_errors.extend(mapping_errors);

    let decoded_count = decode_batch.packets.len();
    let mapped_count = mapped_packets.len();
    let parse_rate = if decoded_count > 0 {
        (mapped_count as f64) / (decoded_count as f64)
    } else {
        1.0
    };
    let parse_rate_below_threshold = parse_rate < config.min_parse_rate;
    let parse_rate_pct = if decoded_count > 0 {
        Some(100.0 * parse_rate)
    } else {
        None
    };

    let (packets_after_physics, physics_adjusted_count, physics_rejected_count) =
        if config.physics_validation {
            let result = physics_validation::validate_and_clamp(
                mapped_packets,
                config.physics_clamp,
            );
            for _ in 0..result.rejected_count {
                all_errors.push(DecodeError {
                    code: "physics_rejected".to_string(),
                    reason: "Packet out of physics bounds and clamp disabled".to_string(),
                    file: path.display().to_string(),
                    offset: 0,
                });
            }
            (
                result.packets,
                result.adjusted_count,
                result.rejected_count,
            )
        } else {
            (mapped_packets, 0, 0)
        };

    let (packets_to_ingest, sigma_flagged_count) = if config.physics_sigma_reject {
        let (filtered, flagged) = physics_validation::apply_sigma_filter(
            packets_after_physics,
            true,
            config.physics_sigma_window,
        );
        for _ in 0..flagged {
            all_errors.push(DecodeError {
                code: "sigma_flagged".to_string(),
                reason: "Packet beyond 3-sigma from batch mean (ORCHESTRATOR_PHYSICS_SIGMA_REJECT)".to_string(),
                file: path.display().to_string(),
                offset: 0,
            });
        }
        (filtered, flagged)
    } else {
        (packets_after_physics, 0)
    };

    let run_id = Uuid::new_v4().to_string();
    let mut accepted_count = 0usize;
    let mut rejected_count = 0usize;

    if !packets_to_ingest.is_empty() {
        let format_label = decode_batch.format.as_str();
        for chunk in packets_to_ingest.chunks(config.packet_max_batch.max(1)) {
            let request = ingest_client::PacketIngestRequest {
                run_id: run_id.clone(),
                source: "ccsds-orchestrator".to_string(),
                format: format_label.to_string(),
                dictionary_id: dictionary.dictionary_id.clone(),
                packets: chunk.to_vec(),
            };

            let packets_for_ingest = if let Some(ref refine_url) = config.refinement_api_url {
                match ingest_client::post_refine_packets(
                    client,
                    refine_url,
                    config.ingest_api_token.as_deref(),
                    &request,
                )
                .await
                {
                    Ok(refined) => refined.packets,
                    Err(e) => {
                        tracing::warn!(error = %e, "refine API failed; using unrefined packets");
                        chunk.to_vec()
                    }
                }
            } else {
                chunk.to_vec()
            };

            let ingest_request = ingest_client::PacketIngestRequest {
                packets: packets_for_ingest,
                ..request
            };

            if config.lancedb_checksum_log {
                if let Ok(bytes) = serde_json::to_vec(&ingest_request) {
                    let mut hasher = Sha256::new();
                    hasher.update(&bytes);
                    let digest = hasher.finalize();
                    let checksum: String = digest
                        .iter()
                        .map(|b| format!("{:02x}", b))
                        .collect();
                    tracing::info!(
                        run_id = %run_id,
                        sha256 = %checksum,
                        "LanceDB/SEU: batch payload checksum for verification when retrieved for LLM"
                    );
                }
            }
            let response = ingest_client::post_ingest_packets(client, config, &ingest_request).await?;
            accepted_count += response.accepted_count;
            rejected_count += response.rejected_count;
            for err in response.errors {
                all_errors.push(DecodeError {
                    code: err.code,
                    reason: err.reason,
                    file: path.display().to_string(),
                    offset: err.index,
                });
            }
        }
    } else {
        rejected_count += all_errors.len();
    }

    let accepted_rate_pct = if !packets_to_ingest.is_empty() {
        Some(100.0 * (accepted_count as f64) / (packets_to_ingest.len() as f64))
    } else {
        None
    };

    let duration_ms = start.elapsed().as_millis();
    tracing::info!(
        file = %path.display(),
        decoded_count,
        mapped_count,
        accepted_count,
        rejected_count,
        duration_ms,
        "packet file processed"
    );

    Ok(PacketProcessSummary {
        run_id,
        format: decode_batch.format.as_str().to_string(),
        dictionary_id: dictionary.dictionary_id,
        decoded_count,
        mapped_count,
        accepted_count,
        rejected_count,
        errors: all_errors,
        parse_rate_pct,
        accepted_rate_pct,
        physics_adjusted_count,
        physics_rejected_count,
        parse_rate_below_threshold,
        sigma_flagged_count,
    })
}

/// Decode and map packet bytes only (no physics, no ingest). Used by the HTTP decode API.
pub fn decode_and_map_packets(
    bytes: &[u8],
    format: decoder_registry::DecoderFormat,
    config: &OrchestratorConfig,
) -> anyhow::Result<DecodeMapResponse> {
    if bytes.len() > config.packet_max_bytes {
        anyhow::bail!(
            "payload exceeds max bytes ({} > {})",
            bytes.len(),
            config.packet_max_bytes
        );
    }
    let path = Path::new(decoder_registry::INLINE_DECODE_PATH);
    let decode_batch =
        decoder_registry::decode_packet_bytes(path, bytes, format, config);
    let dictionary = xtce::load_xtce_dictionary(Path::new(&config.xtce_path))?;
    let apid_map = mapping::load_apid_map(Path::new(&config.apid_map_path), &dictionary)?;
    let (mapped_packets, mapping_errors) =
        mapping::map_decoded_packets(path, &decode_batch.packets, &apid_map, &dictionary);
    let mut all_errors = decode_batch.errors;
    all_errors.extend(mapping_errors);
    Ok(DecodeMapResponse {
        decoded_count: decode_batch.packets.len(),
        mapped_count: mapped_packets.len(),
        format: decode_batch.format.as_str().to_string(),
        dictionary_id: dictionary.dictionary_id,
        packets: mapped_packets,
        errors: all_errors,
    })
}
