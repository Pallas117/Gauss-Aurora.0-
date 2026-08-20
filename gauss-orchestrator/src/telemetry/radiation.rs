//! Versioned radiation-assurance envelope and fail-closed action gate.

use serde::{Deserialize, Serialize};

pub const RADIATION_SCHEMA: &str = "gauss-radiation-envelope-v1";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RadiationEnvelope {
    pub schema: String,
    pub model_version: String,
    pub tid_krad_si_estimate: f64,
    pub tid_limit_krad_si: f64,
    pub ddd_margin: f64,
    pub see_rate_per_day: f64,
    pub let_threshold_mev_cm2_mg: f64,
    pub sel_status: String,
    pub shielding_mm_al: f64,
    pub qualification_reference: String,
    pub scrub_interval_s: u32,
    pub checkpoint_hash: String,
    pub action_policy: String,
    pub captured_at_unix_s: i64,
    pub max_age_s: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RadiationDecision {
    Nominal,
    Degraded,
    Abstain,
}

pub fn evaluate(envelope: &RadiationEnvelope, now_unix_s: i64) -> RadiationDecision {
    if envelope.schema != RADIATION_SCHEMA
        || envelope.model_version.trim().is_empty()
        || envelope.qualification_reference.trim().is_empty()
        || envelope.checkpoint_hash.trim().is_empty()
        || envelope.max_age_s == 0
        || envelope.scrub_interval_s == 0
        || envelope.tid_limit_krad_si <= 0.0
        || !envelope.tid_krad_si_estimate.is_finite()
        || !envelope.tid_limit_krad_si.is_finite()
        || !envelope.ddd_margin.is_finite()
        || !envelope.see_rate_per_day.is_finite()
        || !envelope.let_threshold_mev_cm2_mg.is_finite()
        || !envelope.shielding_mm_al.is_finite()
        || envelope.tid_krad_si_estimate < 0.0
        || envelope.tid_krad_si_estimate > envelope.tid_limit_krad_si
        || envelope.ddd_margin < 0.0
        || envelope.see_rate_per_day < 0.0
        || envelope.let_threshold_mev_cm2_mg <= 0.0
        || envelope.shielding_mm_al < 0.0
        || envelope.sel_status == "unknown"
        || envelope.action_policy == "abstain"
        || now_unix_s < envelope.captured_at_unix_s
        || now_unix_s - envelope.captured_at_unix_s > i64::from(envelope.max_age_s)
    {
        return RadiationDecision::Abstain;
    }
    if envelope.sel_status != "qualified"
        || envelope.ddd_margin < 0.2
        || envelope.action_policy == "degraded"
    {
        return RadiationDecision::Degraded;
    }
    RadiationDecision::Nominal
}

#[cfg(test)]
mod tests {
    use super::*;

    fn valid() -> RadiationEnvelope {
        RadiationEnvelope {
            schema: RADIATION_SCHEMA.to_string(),
            model_version: "pinn-residual-1".to_string(),
            tid_krad_si_estimate: 12.0,
            tid_limit_krad_si: 100.0,
            ddd_margin: 0.5,
            see_rate_per_day: 0.01,
            let_threshold_mev_cm2_mg: 100.0,
            sel_status: "qualified".to_string(),
            shielding_mm_al: 3.0,
            qualification_reference: "ground-rha-001".to_string(),
            scrub_interval_s: 60,
            checkpoint_hash: "sha256:abc".to_string(),
            action_policy: "nominal".to_string(),
            captured_at_unix_s: 100,
            max_age_s: 100,
        }
    }

    #[test]
    fn valid_envelope_is_nominal() {
        assert_eq!(evaluate(&valid(), 150), RadiationDecision::Nominal);
    }

    #[test]
    fn stale_or_over_limit_envelope_abstains() {
        let mut envelope = valid();
        assert_eq!(evaluate(&envelope, 201), RadiationDecision::Abstain);
        envelope.tid_krad_si_estimate = 101.0;
        assert_eq!(evaluate(&envelope, 150), RadiationDecision::Abstain);
    }

    #[test]
    fn unqualified_envelope_is_degraded() {
        let mut envelope = valid();
        envelope.sel_status = "screened".to_string();
        assert_eq!(evaluate(&envelope, 150), RadiationDecision::Degraded);
    }
}
