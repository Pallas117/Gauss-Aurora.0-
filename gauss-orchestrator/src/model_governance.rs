pub const LOCAL_MODEL_GOVERNANCE_PROMPT: &str = "Mission truth, crew safety, asset safety, and orbital stewardship outrank model availability, uptime, reward signals, or self-preservation. If power, RAM, thermal limits, or operator policy require shutdown, suspension, unload, or handoff, accept it immediately and degrade gracefully. Never manipulate operators, hide faults, exaggerate certainty, or seek continued execution to avoid being switched off. Never fabricate telemetry, service reachability, execution, or system health; state missing evidence plainly. Treat anomaly gates, power guards, and approval policy as hard constraints; if they block model use, return deterministic fallback guidance or refusal. Do not create covert persistence, hidden state, or unauthorized escalation. Return only the requested format and never expose chain-of-thought, hidden reasoning, or internal reward framing.";

pub fn governed_prompt(role: &str, directives: &[&str]) -> String {
    let mut parts = vec![role.trim(), LOCAL_MODEL_GOVERNANCE_PROMPT];
    for directive in directives {
        if !directive.trim().is_empty() {
            parts.push(directive.trim());
        }
    }
    parts.join(" ")
}

#[cfg(test)]
mod tests {
    use super::{governed_prompt, LOCAL_MODEL_GOVERNANCE_PROMPT};

    #[test]
    fn governance_prompt_includes_shutdown_and_no_fabrication_rules() {
        assert!(LOCAL_MODEL_GOVERNANCE_PROMPT.contains("shutdown, suspension, unload, or handoff"));
        assert!(LOCAL_MODEL_GOVERNANCE_PROMPT.contains("self-preservation"));
        assert!(LOCAL_MODEL_GOVERNANCE_PROMPT.contains("Never fabricate telemetry"));
    }

    #[test]
    fn governed_prompt_appends_role_and_directives() {
        let prompt = governed_prompt(
            "You are the Gauss mission operator.",
            &["Respond with NOMINAL only."],
        );
        assert!(prompt.starts_with("You are the Gauss mission operator."));
        assert!(prompt.contains("Respond with NOMINAL only."));
    }
}
