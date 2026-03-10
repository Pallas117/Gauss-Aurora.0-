//! Local-only decision model guard: no egress of sensitive data.
//! Aligns with MLX-style local-first (https://github.com/ml-explore/mlx): inference on device, unified memory, no cloud.
//! Allowlist: 127.0.0.1, ::1, localhost, and Tailscale mesh 100.x.x.x.

/// True if the URL host is local or trusted (no egress).
/// - 127.0.0.1, localhost
/// - [::1], ::1 (IPv6 loopback)
/// - 100.x.x.x (Tailscale CGNAT range)
pub fn is_local_or_trusted(url: &str) -> bool {
    let host = host_from_url(url);
    is_local_or_trusted_host(&host)
}

fn host_from_url(url: &str) -> String {
    let s = url.trim();
    let after_proto = if let Some(i) = s.find("://") {
        &s[i + 3..]
    } else {
        s
    };
    let host = after_proto
        .split('/')
        .next()
        .unwrap_or(after_proto)
        .split('@')
        .last()
        .unwrap_or(after_proto)
        .to_string();
    // Strip port if present (e.g. :8089 or ]:8089 for IPv6)
    if let Some(colon) = host.rfind(':') {
        let after = &host[colon + 1..];
        if after.parse::<u16>().is_ok() {
            return host[..colon].to_string();
        }
    }
    host
}

fn is_local_or_trusted_host(host: &str) -> bool {
    let h = host.trim().to_lowercase();
    if h.is_empty() {
        return false;
    }
    if h == "localhost" || h == "127.0.0.1" || h == "::1" || h == "[::1]" {
        return true;
    }
    if h.starts_with('[') && h.ends_with(']') {
        let inner = h[1..h.len() - 1].trim().to_lowercase();
        if inner == "::1" {
            return true;
        }
    }
    if let Some(stripped) = h.strip_suffix(']') {
        if stripped == "[::1" {
            return true;
        }
    }
    if h.starts_with("100.") {
        let rest = &h[4..];
        let parts: Vec<&str> = rest.split('.').collect();
        if parts.len() == 3 {
            return parts
                .iter()
                .all(|p| p.parse::<u8>().is_ok());
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn localhost_trusted() {
        assert!(is_local_or_trusted("http://localhost:8089/v1/chat/completions"));
        assert!(is_local_or_trusted("http://127.0.0.1:8088/v1"));
        assert!(is_local_or_trusted("http://[::1]:8089/v1/chat/completions"));
    }

    #[test]
    fn tailscale_trusted() {
        assert!(is_local_or_trusted("http://100.64.0.1:8089/v1"));
        assert!(is_local_or_trusted("http://100.101.102.103:8088/v1/chat/completions"));
    }

    #[test]
    fn cloud_rejected() {
        assert!(!is_local_or_trusted("https://api.openai.com/v1/chat/completions"));
        assert!(!is_local_or_trusted("https://generativelanguage.googleapis.com/v1beta/models"));
        assert!(!is_local_or_trusted("https://api.anthropic.com/v1/messages"));
        assert!(!is_local_or_trusted("http://192.168.1.1:8089"));
    }
}
