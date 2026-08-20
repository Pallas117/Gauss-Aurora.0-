//! Fixed-shape, dependency-free analytics tensor contract.
//!
//! This is the Rust-side serializer for `config/analytics-tensor.schema.json`.
//! It intentionally uses stack-shaped arrays and serde rather than a tensor
//! runtime: safety-path decoding stays cheap, while ONNX/MLX workers can later
//! consume the same bounded JSON contract.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::MappedCanonicalPacket;

pub const FUSED_TENSOR_SCHEMA: &str = "gauss-analytics-tensor-v1";
pub const PHYSICS_STEPS: usize = 24;
pub const PHYSICS_FEATURES: usize = 18;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TensorMasks {
    pub physics: [f64; PHYSICS_STEPS],
    pub mms: f64,
    pub solar: f64,
    pub exogenous: f64,
    pub doctrine: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TensorProvenance {
    pub source: String,
    pub runtime: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FusedTensorEnvelope {
    pub schema: String,
    #[serde(rename = "generatedAt")]
    pub generated_at: String,
    pub timestamp: String,
    #[serde(rename = "cadenceSeconds")]
    pub cadence_seconds: u8,
    pub physics: Vec<[f64; PHYSICS_FEATURES]>,
    pub mms: [f64; 20],
    pub solar: [f64; 8],
    pub exogenous: [f64; 8],
    pub reliability: [f64; 10],
    pub doctrine: [f64; 6],
    pub masks: TensorMasks,
    pub provenance: TensorProvenance,
}

fn clamp(value: f64, low: f64, high: f64) -> f64 {
    if value.is_finite() {
        value.clamp(low, high)
    } else {
        0.0
    }
}

fn value_at<'a>(root: &'a Value, path: &[&str]) -> Option<&'a Value> {
    path.iter().try_fold(root, |value, key| value.get(*key))
}

fn number(root: &Value, path: &[&str]) -> f64 {
    value_at(root, path).and_then(Value::as_f64).unwrap_or(0.0)
}

fn unit(value: f64, scale: f64) -> f64 {
    clamp(value / scale, -1.0, 1.0)
}

fn storm_tier(root: &Value) -> f64 {
    match value_at(root, &["alerts", "stormTier"]).and_then(Value::as_str) {
        Some("watch") => 1.0 / 3.0,
        Some("warning") => 2.0 / 3.0,
        Some("severe") => 1.0,
        _ => 0.0,
    }
}

fn physics_row(
    packet: &MappedCanonicalPacket,
    previous: Option<&MappedCanonicalPacket>,
) -> [f64; PHYSICS_FEATURES] {
    let point = &packet.canonical_point;
    let previous_dst = previous
        .map(|item| number(&item.canonical_point, &["indices", "dst"]))
        .unwrap_or_else(|| number(point, &["indices", "dst"]));
    let by = number(point, &["magneticField", "y"]);
    let bz = number(point, &["magneticField", "z"]);
    let clock_angle = value_at(point, &["diagnostics", "clockAngleRad"])
        .and_then(Value::as_f64)
        .unwrap_or_else(|| by.atan2(bz));
    [
        clamp(number(point, &["solarWind", "speed"]) / 2000.0, 0.0, 1.0),
        clamp(number(point, &["solarWind", "density"]) / 1000.0, 0.0, 1.0),
        unit(bz, 100.0),
        unit(by, 100.0),
        clamp(number(point, &["magneticField", "bt"]) / 100.0, 0.0, 1.0),
        unit(number(point, &["electricField", "ey"]), 100.0),
        clamp(
            number(point, &["solarWind", "dynamicPressure"]) / 1000.0,
            0.0,
            1.0,
        ),
        clamp(
            (number(point, &["coupling", "newell"]).max(0.0) + 1.0).ln() / 12.0,
            0.0,
            1.0,
        ),
        clamp(
            (number(point, &["coupling", "epsilon"]).max(0.0) + 1.0).ln() / 30.0,
            0.0,
            1.0,
        ),
        clamp(number(point, &["indices", "kp"]) / 9.0, 0.0, 1.0),
        clamp(
            (number(point, &["indices", "dst"]) + 400.0) / 480.0,
            0.0,
            1.0,
        ),
        unit(number(point, &["indices", "dst"]) - previous_dst, 120.0),
        clamp(number(point, &["diagnostics", "shueR0Re"]) / 25.0, 0.0, 1.0),
        clamp(
            number(point, &["diagnostics", "alfvenSpeedKmS"]) / 5000.0,
            0.0,
            1.0,
        ),
        clock_angle.sin(),
        clock_angle.cos(),
        clamp(
            number(point, &["propagation", "l1DelaySeconds"]) / 6000.0,
            0.0,
            1.0,
        ),
        storm_tier(point),
    ]
}

/// Build the deterministic Rust-side tensor envelope from a bounded packet window.
pub fn build_contract_tensor(
    packets: &[MappedCanonicalPacket],
    generated_at: &str,
) -> FusedTensorEnvelope {
    let bounded = &packets[packets.len().saturating_sub(PHYSICS_STEPS)..];
    let mut physics = vec![[0.0; PHYSICS_FEATURES]; PHYSICS_STEPS];
    let mut physics_mask = [0.0; PHYSICS_STEPS];
    let offset = PHYSICS_STEPS.saturating_sub(bounded.len());
    for (index, packet) in bounded.iter().enumerate() {
        physics[offset + index] = physics_row(
            packet,
            index
                .checked_sub(1)
                .and_then(|previous| bounded.get(previous)),
        );
        physics_mask[offset + index] = 1.0;
    }
    let timestamp = bounded
        .last()
        .map(|packet| packet.timestamp.clone())
        .unwrap_or_else(|| generated_at.to_string());
    let coverage = physics_mask.iter().sum::<f64>() / PHYSICS_STEPS as f64;
    FusedTensorEnvelope {
        schema: FUSED_TENSOR_SCHEMA.to_string(),
        generated_at: generated_at.to_string(),
        timestamp,
        cadence_seconds: 5,
        physics,
        mms: [0.0; 20],
        solar: [0.0; 8],
        exogenous: [0.0; 8],
        doctrine: [0.0; 6],
        reliability: [
            coverage, coverage, 1.0, 1.0, 1.0, coverage, 0.0, 0.0, 0.0, coverage,
        ],
        masks: TensorMasks {
            physics: physics_mask,
            mms: 0.0,
            solar: 0.0,
            exogenous: 0.0,
            doctrine: 0.0,
        },
        provenance: TensorProvenance {
            source: "deterministic".to_string(),
            runtime: "contract-only".to_string(),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn packet(timestamp: &str, bz: f64) -> MappedCanonicalPacket {
        MappedCanonicalPacket {
            timestamp: timestamp.to_string(),
            apid: 1,
            seq_count: 1,
            payload_hex: String::new(),
            canonical_point: json!({
                "solarWind": { "speed": 400.0, "density": 5.0, "dynamicPressure": 1.3 },
                "magneticField": { "y": 2.0, "z": bz, "bt": 6.0 },
                "electricField": { "ey": 2.0 },
                "indices": { "kp": 3.0, "dst": -12.0 },
                "coupling": { "newell": 120.0, "epsilon": 2.0 },
                "propagation": { "l1DelaySeconds": 3750.0 },
                "alerts": { "stormTier": "watch" },
                "diagnostics": { "shueR0Re": 8.0, "alfvenSpeedKmS": 420.0 }
            }),
            quality_flags: json!({}),
            uncertainty: json!({}),
        }
    }

    #[test]
    fn emits_fixed_shape_contract() {
        let tensor = build_contract_tensor(
            &[packet("2026-07-18T00:00:00Z", -5.0)],
            "2026-07-18T00:00:01Z",
        );
        assert_eq!(tensor.schema, FUSED_TENSOR_SCHEMA);
        assert_eq!(tensor.physics.len(), PHYSICS_STEPS);
        assert!(tensor
            .physics
            .iter()
            .all(|row| row.len() == PHYSICS_FEATURES));
        assert_eq!(
            tensor
                .masks
                .physics
                .iter()
                .filter(|value| **value == 1.0)
                .count(),
            1
        );
        assert_eq!(tensor.mms, [0.0; 20]);
        let encoded = serde_json::to_value(tensor).expect("tensor should serialize");
        assert_eq!(encoded["cadenceSeconds"], 5);
        assert_eq!(encoded["provenance"]["runtime"], "contract-only");
    }
}
