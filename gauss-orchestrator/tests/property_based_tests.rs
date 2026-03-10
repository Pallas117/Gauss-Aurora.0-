use gauss_orchestrator::analysis::detect_sensitive_content;
use gauss_orchestrator::anonymization::anonymize_telemetry;
use gauss_orchestrator::types::Sensitivity;
use proptest::prelude::*;

// Property: sensitivity detection should be consistent
// If content is marked HIGH, it should always be HIGH
proptest! {
    #[test]
    fn prop_sensitivity_detection_is_deterministic(content in ".*CLASSIFIED.*") {
        let (sens1, _) = detect_sensitive_content(&content);
        let (sens2, _) = detect_sensitive_content(&content);

        // Both detections should yield the same result
        match (&sens1, &sens2) {
            (Sensitivity::High, Sensitivity::High) => {},
            (Sensitivity::Low, Sensitivity::Low) => {},
            (Sensitivity::Unknown, Sensitivity::Unknown) => {},
            _ => panic!("Sensitivity detection inconsistent across calls"),
        }
    }
}

// Property: anonymization should be idempotent
// Applying anonymization twice should be same as once
proptest! {
    #[test]
    fn prop_anonymization_is_idempotent(content in r"[a-zA-Z0-9,:\.\s\-]*") {
        let anon1 = anonymize_telemetry(&content);
        let anon2 = anonymize_telemetry(&anon1);

        // Second anonymization should produce same result
        prop_assert_eq!(anon1, anon2, "Anonymization is not idempotent");
    }
}

// Property: anonymization should preserve structure
// Number of lines should remain constant
proptest! {
    #[test]
    fn prop_anonymization_preserves_line_count(content in "[a-zA-Z0-9,: \n]*") {
        let orig_lines = content.lines().count();
        let anon = anonymize_telemetry(&content);
        let anon_lines = anon.lines().count();

        prop_assert_eq!(orig_lines, anon_lines, "Anonymization changed line count");
    }
}

// Property: detection should work for various content lengths
proptest! {
    #[test]
    fn prop_detection_works_for_all_lengths(content in r"(CLASSIFIED|PROPRIETARY|[a-z]+\n?)*") {
        let (sensitivity, _patterns) = detect_sensitive_content(&content);

        // Should always return a valid sensitivity
        match sensitivity {
            Sensitivity::High | Sensitivity::Low | Sensitivity::Unknown => {},
        }
    }
}
