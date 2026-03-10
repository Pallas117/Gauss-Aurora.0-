use anyhow::{bail, Context};
use chrono::Utc;
use regex::Regex;
use serde::Deserialize;
use std::collections::{HashMap, HashSet};
use std::path::Path;

#[derive(Debug)]
pub struct XtceApidMapValidationError {
    pub apid: String,
    pub parameter: String,
    pub message: String,
}

#[derive(Debug, Deserialize)]
struct ApidMapForValidation {
    apids: HashMap<String, ApidParamsForValidation>,
}

#[derive(Debug, Deserialize)]
struct ApidParamsForValidation {
    parameters: Vec<ParamRuleForValidation>,
}

#[derive(Debug, Deserialize)]
struct ParamRuleForValidation {
    target: String,
    #[serde(rename = "type")]
    value_type: String,
}

#[derive(Debug, Clone)]
pub struct XtceDictionary {
    pub dictionary_id: String,
    pub path: String,
    pub loaded_at: String,
}

/// Parameter name → parameterTypeRef (e.g. "solarWind.speed" → "f32_be").
pub fn parse_parameter_set(xtce_content: &str) -> anyhow::Result<HashMap<String, String>> {
    let mut out = HashMap::new();
    // Match <Parameter name="..." parameterTypeRef="..." /> or with other attributes
    let re = Regex::new(r#"<Parameter\s+name\s*=\s*"([^"]+)"\s+[^>]*parameterTypeRef\s*=\s*"([^"]+)""#)
        .context("failed to compile Parameter regex")?;
    for cap in re.captures_iter(xtce_content) {
        let name = cap.get(1).map(|m| m.as_str().trim().to_string()).unwrap_or_default();
        let type_ref = cap.get(2).map(|m| m.as_str().trim().to_string()).unwrap_or_default();
        if !name.is_empty() && !type_ref.is_empty() {
            out.insert(name, type_ref);
        }
    }
    Ok(out)
}

/// Type names defined in ParameterTypeSet (e.g. FloatParameterType name="f32_be").
pub fn parse_parameter_type_set(xtce_content: &str) -> HashSet<String> {
    let mut out = HashSet::new();
    // FloatParameterType, IntegerParameterType, etc.
    let re = Regex::new(r#"<(?:Float|Integer|String|Binary|Boolean)ParameterType\s+[^>]*\bname\s*=\s*"([^"]+)""#)
        .unwrap();
    for cap in re.captures_iter(xtce_content) {
        if let Some(m) = cap.get(1) {
            let name = m.as_str().trim().to_string();
            if !name.is_empty() {
                out.insert(name);
            }
        }
    }
    out
}

pub fn load_xtce_dictionary(path: &Path) -> anyhow::Result<XtceDictionary> {
    let content = std::fs::read_to_string(path)
        .with_context(|| format!("failed to read XTCE dictionary {}", path.display()))?;
    if !content.contains("SpaceSystem") {
        bail!(
            "XTCE dictionary missing SpaceSystem root marker: {}",
            path.display()
        );
    }

    let name_matcher = Regex::new(r#"(?i)<\s*SpaceSystem\b[^>]*\bname\s*=\s*"([^"]+)""#)
        .context("failed to compile XTCE name regex")?;
    let dictionary_id = name_matcher
        .captures(&content)
        .and_then(|captures| captures.get(1).map(|m| m.as_str().trim().to_string()))
        .filter(|id| !id.is_empty())
        .unwrap_or_else(|| {
            path.file_stem()
                .and_then(|stem| stem.to_str())
                .unwrap_or("xtce-dictionary")
                .to_string()
        });

    Ok(XtceDictionary {
        dictionary_id,
        path: path.display().to_string(),
        loaded_at: Utc::now().to_rfc3339(),
    })
}

/// Validates that every parameter in the apid-map exists in the XTCE ParameterSet
/// and that its type matches the XTCE ParameterTypeRef (and that the type is in ParameterTypeSet).
pub fn validate_apid_map_against_xtce(
    xtce_content: &str,
    apid_map_json: &str,
) -> Result<(), Vec<XtceApidMapValidationError>> {
    let param_set = parse_parameter_set(xtce_content).unwrap_or_default();
    let type_set = parse_parameter_type_set(xtce_content);

    let apid_map: ApidMapForValidation = serde_json::from_str(apid_map_json).map_err(|e| {
        vec![XtceApidMapValidationError {
            apid: String::new(),
            parameter: String::new(),
            message: format!("invalid apid-map JSON: {}", e),
        }]
    })?;

    let mut errors = Vec::new();
    for (apid, rule) in &apid_map.apids {
        for param in &rule.parameters {
            let name = &param.target;
            let type_ref = &param.value_type;
            match param_set.get(name) {
                None => {
                    errors.push(XtceApidMapValidationError {
                        apid: apid.clone(),
                        parameter: name.clone(),
                        message: format!("parameter '{}' not in XTCE ParameterSet", name),
                    });
                }
                Some(xtce_type) => {
                    if xtce_type != type_ref {
                        errors.push(XtceApidMapValidationError {
                            apid: apid.clone(),
                            parameter: name.clone(),
                            message: format!(
                                "type mismatch: apid-map has '{}', XTCE has '{}'",
                                type_ref, xtce_type
                            ),
                        });
                    }
                    if !type_set.contains(type_ref) {
                        errors.push(XtceApidMapValidationError {
                            apid: apid.clone(),
                            parameter: name.clone(),
                            message: format!(
                                "type '{}' not in XTCE ParameterTypeSet",
                                type_ref
                            ),
                        });
                    }
                }
            }
        }
    }
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors)
    }
}

/// Load XTCE and apid-map from paths and validate; returns list of errors if any.
pub fn validate_xtce_apid_paths(
    xtce_path: &Path,
    apid_map_path: &Path,
) -> Result<(), Vec<XtceApidMapValidationError>> {
    let xtce_content = std::fs::read_to_string(xtce_path).map_err(|e| {
        vec![XtceApidMapValidationError {
            apid: String::new(),
            parameter: String::new(),
            message: format!("failed to read XTCE {}: {}", xtce_path.display(), e),
        }]
    })?;
    let apid_content = std::fs::read_to_string(apid_map_path).map_err(|e| {
        vec![XtceApidMapValidationError {
            apid: String::new(),
            parameter: String::new(),
            message: format!("failed to read apid-map {}: {}", apid_map_path.display(), e),
        }]
    })?;
    validate_apid_map_against_xtce(&xtce_content, &apid_content)
}

#[cfg(test)]
mod tests {
    use super::*;

    const BASELINE_XTCE: &str = r#"<?xml version="1.0"?>
<SpaceSystem name="gauss-baseline-v1" xmlns="http://www.omg.org/spec/XTCE/20180204">
  <TelemetryMetaData>
    <ParameterTypeSet>
      <FloatParameterType name="f32_be"><UnitSet><Unit>SI</Unit></UnitSet></FloatParameterType>
    </ParameterTypeSet>
    <ParameterSet>
      <Parameter name="solarWind.speed" parameterTypeRef="f32_be" />
      <Parameter name="solarWind.density" parameterTypeRef="f32_be" />
      <Parameter name="magneticField.z" parameterTypeRef="f32_be" />
    </ParameterSet>
  </TelemetryMetaData>
</SpaceSystem>"#;

    const VALID_APID_MAP: &str = r#"{"dictionary_id":"gauss-baseline-v1","apids":{"900":{"parameters":[{"target":"solarWind.speed","offset":0,"type":"f32_be","scale":1},{"target":"solarWind.density","offset":4,"type":"f32_be","scale":1},{"target":"magneticField.z","offset":8,"type":"f32_be","scale":1}]}}}"#;

    #[test]
    fn parse_parameter_set_extracts_names_and_types() {
        let set = parse_parameter_set(BASELINE_XTCE).unwrap();
        assert_eq!(set.get("solarWind.speed"), Some(&"f32_be".to_string()));
        assert_eq!(set.get("solarWind.density"), Some(&"f32_be".to_string()));
        assert_eq!(set.get("magneticField.z"), Some(&"f32_be".to_string()));
        assert_eq!(set.len(), 3);
    }

    #[test]
    fn parse_parameter_type_set_extracts_type_names() {
        let set = parse_parameter_type_set(BASELINE_XTCE);
        assert!(set.contains("f32_be"));
    }

    #[test]
    fn validate_apid_map_against_xtce_passes_for_matching_map() {
        let r = validate_apid_map_against_xtce(BASELINE_XTCE, VALID_APID_MAP);
        assert!(r.is_ok(), "{:?}", r.err());
    }

    #[test]
    fn validate_apid_map_against_xtce_fails_for_unknown_parameter() {
        let bad = r#"{"apids":{"900":{"parameters":[{"target":"unknown.param","offset":0,"type":"f32_be"}]}}}"#;
        let r = validate_apid_map_against_xtce(BASELINE_XTCE, bad);
        assert!(r.is_err());
        let errs = r.unwrap_err();
        assert!(!errs.is_empty());
        assert!(errs[0].message.contains("not in XTCE ParameterSet"));
    }

    #[test]
    fn validate_apid_map_against_xtce_fails_for_type_mismatch() {
        let bad = r#"{"apids":{"900":{"parameters":[{"target":"solarWind.speed","offset":0,"type":"i16_be"}]}}}"#;
        let r = validate_apid_map_against_xtce(BASELINE_XTCE, bad);
        assert!(r.is_err());
        let errs = r.unwrap_err();
        assert!(errs.iter().any(|e| e.message.contains("type mismatch")));
    }
}
