/// Sensitive key names (case-insensitive) to strip or redact from report payloads before cloud export.
const SENSITIVE_KEYS: &[&str] = &[
    "satellite_id",
    "orbital_vector",
    "orbital_elements",
    "norad_id",
    "cospar_id",
    "classification",
    "classified",
    "raw_telemetry",
    "position",
    "velocity",
    "latitude",
    "longitude",
    "lat",
    "lon",
];

/// Patterns (substrings) to redact from string values; replaced with [REDACTED].
const SENSITIVE_PATTERNS: &[&str] = &[
    "Satellite_ID_",
    "Lat:",
    "Lon:",
    "CLASSIFIED",
    "NORAD",
    "COSPAR",
];

/// Anonymize raw telemetry text (legacy).
pub fn anonymize_telemetry(content: &str) -> String {
    content
        .replace("Satellite_ID_", "Asset_")
        .replace("Lat:", "Loc_X:")
        .replace("Lon:", "Loc_Y:")
}

/// Sovereign Buffer: strip sensitive keys and redact patterns in JSON report payload before cloud export.
/// Returns scrubbed JSON string; on parse error returns the original string.
pub fn anonymize_payload(json_str: &str) -> String {
    let value: serde_json::Value = match serde_json::from_str(json_str) {
        Ok(v) => v,
        Err(_) => return json_str.to_string(),
    };
    let scrubbed = scrub_value(value);
    serde_json::to_string(&scrubbed).unwrap_or_else(|_| json_str.to_string())
}

fn scrub_value(v: serde_json::Value) -> serde_json::Value {
    use serde_json::Value;
    match v {
        Value::Object(map) => {
            let out: std::collections::HashMap<String, Value> = map
                .into_iter()
                .filter(|(k, _)| !is_sensitive_key(k))
                .map(|(k, v)| (k, scrub_value(v)))
                .collect();
            Value::Object(out.into_iter().collect())
        }
        Value::Array(arr) => Value::Array(arr.into_iter().map(scrub_value).collect()),
        Value::String(s) => Value::String(redact_string(&s)),
        other => other,
    }
}

fn is_sensitive_key(k: &str) -> bool {
    let lower = k.to_lowercase();
    SENSITIVE_KEYS.iter().any(|&s| lower.contains(s))
}

fn redact_string(s: &str) -> String {
    let mut out = s.to_string();
    for &pat in SENSITIVE_PATTERNS {
        if out.contains(pat) {
            out = out.replace(pat, "[REDACTED]");
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn anonymize_basic() {
        let input = "Satellite_ID_001,Lat:42.5,Lon:-73.2";
        let out = anonymize_telemetry(input);
        assert!(out.contains("Asset_001"));
        assert!(out.contains("Loc_X:42.5"));
        assert!(out.contains("Loc_Y:-73.2"));
    }

    #[test]
    fn anonymize_payload_strips_sensitive_keys() {
        let input = r#"{"summary":"ok","satellite_id":"SAT-1","recommendation":"proceed"}"#;
        let out = anonymize_payload(input);
        assert!(!out.contains("SAT-1"));
        assert!(out.contains("summary"));
        assert!(out.contains("recommendation"));
    }

    #[test]
    fn anonymize_payload_redacts_patterns() {
        let input = r#"{"text":"Contact Satellite_ID_001 at Lat:42 Lon:-73"}"#;
        let out = anonymize_payload(input);
        assert!(out.contains("[REDACTED]"));
    }
}
