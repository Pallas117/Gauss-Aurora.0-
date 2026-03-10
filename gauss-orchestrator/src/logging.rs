pub fn init_tracing() {
    use tracing_subscriber::{fmt, EnvFilter};

    // Default to info level if RUST_LOG is not set
    let env_filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));

    let _ = fmt()
        .json()
        .with_env_filter(env_filter)
        .with_current_span(false)
        .with_span_events(tracing_subscriber::fmt::format::FmtSpan::NONE)
        .try_init();
}

#[cfg(test)]
mod tests {
    use super::init_tracing;

    #[test]
    fn init_tracing_is_idempotent() {
        init_tracing();
        init_tracing();
    }
}
