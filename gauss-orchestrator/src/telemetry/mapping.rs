use anyhow::{bail, Context};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{collections::HashMap, path::Path};

use crate::telemetry::{xtce::XtceDictionary, DecodeError, DecodedPacket, MappedCanonicalPacket};

#[derive(Debug, Clone, Deserialize)]
struct ApidMapFile {
    dictionary_id: Option<String>,
    apids: HashMap<String, ApidRuleRaw>,
}

#[derive(Debug, Clone, Deserialize)]
struct ApidRuleRaw {
    parameters: Vec<ParameterRule>,
}

#[derive(Debug, Clone, Deserialize)]
struct ParameterRule {
    target: String,
    offset: usize,
    #[serde(rename = "type")]
    value_type: String,
    scale: Option<f64>,
    bias: Option<f64>,
}

#[derive(Debug, Clone)]
pub struct ApidRule {
    parameters: Vec<ParameterRule>,
}

#[derive(Debug, Clone)]
pub struct ApidMap {
    dictionary_id: String,
    pub apids: HashMap<u16, ApidRule>,
}

pub fn load_apid_map(path: &Path, dictionary: &XtceDictionary) -> anyhow::Result<ApidMap> {
    let text = std::fs::read_to_string(path)
        .with_context(|| format!("failed to read APID mapping file {}", path.display()))?;
    let parsed: ApidMapFile = serde_json::from_str(&text)
        .with_context(|| format!("failed to parse APID mapping file {}", path.display()))?;

    let dictionary_id = parsed
        .dictionary_id
        .unwrap_or_else(|| dictionary.dictionary_id.clone());
    if dictionary_id != dictionary.dictionary_id {
        bail!(
            "XTCE dictionary mismatch: xtce='{}' apid-map='{}'",
            dictionary.dictionary_id,
            dictionary_id
        );
    }

    let mut apids = HashMap::new();
    for (apid_key, rule) in parsed.apids {
        let apid = apid_key
            .parse::<u16>()
            .with_context(|| format!("invalid APID key in map: {}", apid_key))?;
        apids.insert(
            apid,
            ApidRule {
                parameters: rule.parameters,
            },
        );
    }

    Ok(ApidMap {
        dictionary_id,
        apids,
    })
}

fn decode_scalar(payload: &[u8], rule: &ParameterRule) -> Option<f64> {
    let scale = rule.scale.unwrap_or(1.0);
    let bias = rule.bias.unwrap_or(0.0);

    match rule.value_type.as_str() {
        "f32_be" => {
            let end = rule.offset + 4;
            if end > payload.len() {
                return None;
            }
            let raw = f32::from_be_bytes([
                payload[rule.offset],
                payload[rule.offset + 1],
                payload[rule.offset + 2],
                payload[rule.offset + 3],
            ]);
            Some((raw as f64) * scale + bias)
        }
        "i16_be" => {
            let end = rule.offset + 2;
            if end > payload.len() {
                return None;
            }
            let raw = i16::from_be_bytes([payload[rule.offset], payload[rule.offset + 1]]);
            Some((raw as f64) * scale + bias)
        }
        "u16_be" => {
            let end = rule.offset + 2;
            if end > payload.len() {
                return None;
            }
            let raw = u16::from_be_bytes([payload[rule.offset], payload[rule.offset + 1]]);
            Some((raw as f64) * scale + bias)
        }
        _ => None,
    }
}

fn normalize_storm_tier(kp: f64) -> &'static str {
    if kp >= 7.0 {
        "severe"
    } else if kp >= 5.0 {
        "warning"
    } else if kp >= 4.0 {
        "watch"
    } else {
        "quiet"
    }
}

fn canonical_from_fields(
    timestamp: &str,
    speed: f64,
    density: f64,
    bz: f64,
    missing: bool,
) -> Value {
    let speed_mag = speed.abs().max(1.0);
    let dynamic_pressure = (density.max(0.0) * speed_mag * speed_mag * 1.6726e-6).max(0.0);
    let coupling_newell = (speed_mag * bz.abs() * density.max(0.0)).sqrt() / 100.0;
    let kp = (1.0 + (bz.abs() / 4.0)).min(9.0);
    let dst = (-12.0 - bz * 5.0).clamp(-450.0, 50.0);
    let eta = chrono::DateTime::parse_from_rfc3339(timestamp)
        .map(|ts| (ts + chrono::Duration::seconds(45)).to_rfc3339())
        .unwrap_or_else(|_| timestamp.to_string());

    json!({
      "timestamp": timestamp,
      "source": "fusion",
      "rho": density.max(0.0),
      "velocity": {
        "x": -speed_mag,
        "y": 0.0,
        "z": 0.0,
        "magnitude": speed_mag
      },
      "magneticField": {
        "x": 0.0,
        "y": 0.0,
        "z": bz,
        "bt": bz.abs()
      },
      "electricField": {
        "x": 0.0,
        "y": 0.0,
        "z": 0.0,
        "ey": 0.0
      },
      "solarWind": {
        "speed": speed_mag,
        "density": density.max(0.0),
        "dynamicPressure": dynamic_pressure
      },
      "indices": {
        "kp": kp,
        "dst": dst
      },
      "coupling": {
        "newell": coupling_newell,
        "epsilon": coupling_newell * 0.8
      },
      "propagation": {
        "l1DelaySeconds": 45,
        "etaEarthArrival": eta
      },
      "alerts": {
        "stormTier": normalize_storm_tier(kp),
        "reason": "ccsds_xtce_ingest"
      },
      "quality": {
        "outlier": false,
        "stale": false,
        "interpolated": false,
        "extrapolated": false,
        "lowConfidence": missing
      },
      "uncertainty": {
        "speed": { "lower": speed_mag - 10.0, "upper": speed_mag + 10.0, "sigma": 8.0 },
        "density": { "lower": density.max(0.0) - 0.9, "upper": density.max(0.0) + 0.9, "sigma": 0.6 },
        "bz": { "lower": bz - 1.3, "upper": bz + 1.3, "sigma": 0.8 }
      }
    })
}

pub fn map_decoded_packets(
    source_file: &Path,
    decoded: &[DecodedPacket],
    apid_map: &ApidMap,
    _dictionary: &XtceDictionary,
) -> (Vec<MappedCanonicalPacket>, Vec<DecodeError>) {
    let mut mapped = Vec::new();
    let mut errors = Vec::new();
    let file = source_file.display().to_string();

    for (index, packet) in decoded.iter().enumerate() {
        let Some(rule) = apid_map.apids.get(&packet.apid) else {
            errors.push(DecodeError {
                code: "unknown_apid".to_string(),
                reason: format!(
                    "APID {} is not mapped in dictionary {}",
                    packet.apid, apid_map.dictionary_id
                ),
                file: file.clone(),
                offset: index,
            });
            continue;
        };

        let mut speed = None::<f64>;
        let mut density = None::<f64>;
        let mut bz = None::<f64>;
        let mut missing_parameters = false;

        for parameter in &rule.parameters {
            let value = decode_scalar(&packet.payload, parameter);
            if value.is_none() {
                missing_parameters = true;
                continue;
            }
            let v = value.unwrap_or_default();
            match parameter.target.as_str() {
                "solarWind.speed" => speed = Some(v),
                "solarWind.density" => density = Some(v),
                "magneticField.z" => bz = Some(v),
                _ => {}
            }
        }

        let speed_value = speed.unwrap_or(400.0);
        let density_value = density.unwrap_or(5.0);
        let bz_value = bz.unwrap_or(0.0);

        let canonical = canonical_from_fields(
            &packet.timestamp,
            speed_value,
            density_value,
            bz_value,
            missing_parameters,
        );

        let quality_flags = json!({
            "crc_checked": packet.quality_flags.crc_checked,
            "crc_valid": packet.quality_flags.crc_valid,
            "missing_parameters": missing_parameters
        });
        let uncertainty = json!({
            "speed": { "sigma": packet.uncertainty.speed_sigma },
            "density": { "sigma": packet.uncertainty.density_sigma },
            "bz": { "sigma": packet.uncertainty.bz_sigma }
        });

        mapped.push(MappedCanonicalPacket {
            timestamp: packet.timestamp.clone(),
            apid: packet.apid,
            seq_count: packet.seq_count,
            payload_hex: packet.payload_hex.clone(),
            canonical_point: canonical,
            quality_flags,
            uncertainty,
        });

        if missing_parameters {
            errors.push(DecodeError {
                code: "missing_parameters".to_string(),
                reason: format!(
                    "APID {} mapped with default fallbacks because one or more parameters were missing",
                    packet.apid
                ),
                file: file.clone(),
                offset: index,
            });
        }
    }

    (mapped, errors)
}
