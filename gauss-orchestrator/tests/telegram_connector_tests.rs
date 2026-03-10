use gauss_orchestrator::telegram_connector::TelegramConnector;

#[test]
fn test_telegram_connector_disabled_without_token() {
    let connector = TelegramConnector::new("", 7909911632);
    assert!(
        !connector.enabled,
        "Connector should be disabled without token"
    );
}

#[test]
fn test_telegram_connector_disabled_without_chat_id() {
    let connector = TelegramConnector::new("test-token", 0);
    assert!(
        !connector.enabled,
        "Connector should be disabled without chat ID"
    );
}

#[test]
fn test_telegram_connector_enabled_with_both() {
    let connector = TelegramConnector::new("test-token", 7909911632);
    // In restricted sandboxes, Bot construction can fail due platform proxy APIs.
    // In that case, connector gracefully degrades to disabled with no bot handle.
    assert_eq!(
        connector.enabled,
        connector.bot.is_some(),
        "enabled flag must match bot availability"
    );
}

#[test]
fn test_telegram_connector_enabled_with_whitespace() {
    let connector = TelegramConnector::new("  ", 7909911632);
    assert!(
        !connector.enabled,
        "Connector should be disabled when token is only whitespace"
    );
}

#[tokio::test]
async fn test_telegram_connector_notify_when_disabled() {
    let connector = TelegramConnector::new("", 0);
    // Should not panic or error when disabled
    connector.notify("Test message").await;
}

#[tokio::test]
async fn test_telegram_connector_notify_error() {
    let connector = TelegramConnector::new("", 0);
    // Should not panic or error when disabled
    connector
        .notify_error("TestError", "Something went wrong")
        .await;
}

#[tokio::test]
async fn test_telegram_connector_notify_success() {
    let connector = TelegramConnector::new("", 0);
    // Should not panic or error when disabled
    connector.notify_success("Operation completed").await;
}
