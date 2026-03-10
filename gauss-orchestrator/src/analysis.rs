use crate::types::Sensitivity;

pub fn detect_sensitive_content(content: &str) -> (Sensitivity, Vec<String>) {
    let mut patterns = Vec::new();
    if content.contains("CLASSIFIED") {
        patterns.push("CLASSIFIED".to_string());
    }
    if content.contains("PROPRIETARY") {
        patterns.push("PROPRIETARY".to_string());
    }

    let sensitivity = if !patterns.is_empty() {
        Sensitivity::High
    } else {
        Sensitivity::Low
    };
    (sensitivity, patterns)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_classified() {
        let (s, p) = detect_sensitive_content("this is CLASSIFIED data");
        assert_eq!(s, Sensitivity::High);
        assert!(p.contains(&"CLASSIFIED".to_string()));
    }

    #[test]
    fn detects_none() {
        let (s, p) = detect_sensitive_content("normal data");
        assert_eq!(s, Sensitivity::Low);
        assert!(p.is_empty());
    }
}
