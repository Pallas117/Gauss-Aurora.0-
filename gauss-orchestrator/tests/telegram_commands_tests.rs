use gauss_orchestrator::telegram_commands::TelegramCommand;

#[test]
fn parses_plain_text_as_ask_command() {
    let cmd = TelegramCommand::parse("What is the latest storm tier?")
        .expect("plain text should parse as Ask");
    match cmd {
        TelegramCommand::Ask(text) => assert_eq!(text, "What is the latest storm tier?"),
        other => panic!("expected Ask command, got {:?}", other),
    }
}

#[test]
fn parses_ask_with_argument() {
    let cmd =
        TelegramCommand::parse("/ask summarize the latest audit run").expect("/ask should parse");
    match cmd {
        TelegramCommand::Ask(text) => assert_eq!(text, "summarize the latest audit run"),
        other => panic!("expected Ask command, got {:?}", other),
    }
}

#[test]
fn parses_help_command() {
    let cmd = TelegramCommand::parse("/help").expect("/help should parse");
    assert!(matches!(cmd, TelegramCommand::Help));
}

#[test]
fn empty_message_returns_none() {
    assert!(TelegramCommand::parse("   ").is_none());
}

#[test]
fn parses_progress_command() {
    let cmd = TelegramCommand::parse("/progress").expect("/progress should parse");
    assert!(matches!(cmd, TelegramCommand::Progress));
}
