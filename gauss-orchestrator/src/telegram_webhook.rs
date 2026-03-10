/// Telegram webhook handler - receives messages from Telegram Bot API
/// Simpler than polling, works with Telegram's webhook delivery system
use axum::{extract::Json, http::StatusCode, response::IntoResponse, routing::post, Router};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::mpsc;

/// Telegram Update structure (simplified from teloxide)
#[derive(Debug, Deserialize, Serialize)]
pub struct TelegramUpdate {
    pub update_id: i64,
    pub message: Option<TelegramMessage>,
}

/// Telegram Message structure
#[derive(Debug, Deserialize, Serialize)]
pub struct TelegramMessage {
    pub message_id: i64,
    pub from: Option<TelegramUser>,
    pub chat: TelegramChat,
    pub text: Option<String>,
}

/// Telegram User
#[derive(Debug, Deserialize, Serialize)]
pub struct TelegramUser {
    pub id: i64,
    pub is_bot: bool,
    pub first_name: String,
}

/// Telegram Chat
#[derive(Debug, Deserialize, Serialize)]
pub struct TelegramChat {
    pub id: i64,
    #[serde(rename = "type")]
    pub chat_type: String,
}

/// Command received from Telegram
#[derive(Debug, Clone)]
pub struct CommandMessage {
    pub text: String,
}

/// Start the webhook server for Telegram updates
pub async fn start_webhook_server(
    bind_addr: &str,
    command_tx: mpsc::Sender<String>,
) -> Result<(), Box<dyn std::error::Error>> {
    let tx = Arc::new(command_tx);

    let app = Router::new()
        .route("/webhook/telegram", post(handle_telegram_webhook))
        .with_state(tx);

    let listener = tokio::net::TcpListener::bind(bind_addr).await?;
    tracing::info!("Telegram webhook server listening on {}", bind_addr);

    axum::serve(listener, app).await?;
    Ok(())
}

/// Handler for incoming Telegram messages via webhook
async fn handle_telegram_webhook(
    axum::extract::State(tx): axum::extract::State<Arc<mpsc::Sender<String>>>,
    Json(update): Json<TelegramUpdate>,
) -> impl IntoResponse {
    if let Some(message) = update.message {
        if let Some(text) = message.text {
            tracing::info!("📱 Telegram message: {}", text);

            // Send command to orchestrator
            let _ = tx.send(text).await;
        }
    }

    StatusCode::OK
}
