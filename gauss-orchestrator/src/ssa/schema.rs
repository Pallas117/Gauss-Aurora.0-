//! GAUSS-COMP-201: Canonical measurement schema for optical and RF SSA sensors.
//! Validation enforces units and covariance presence.

use serde::{Deserialize, Serialize};

/// Upper-triangle covariance (6 elements: xx, xy, xz, yy, yz, zz) in SI or angle units.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Covariance6 {
    pub xx: f64,
    pub xy: f64,
    pub xz: f64,
    pub yy: f64,
    pub yz: f64,
    pub zz: f64,
}

impl Covariance6 {
    /// Default diagonal (small uncertainty).
    pub fn default_diagonal(sigma_sq: f64) -> Self {
        Self {
            xx: sigma_sq,
            xy: 0.0,
            xz: 0.0,
            yy: sigma_sq,
            yz: 0.0,
            zz: sigma_sq,
        }
    }

    pub fn to_vec(&self) -> [f64; 6] {
        [self.xx, self.xy, self.xz, self.yy, self.yz, self.zz]
    }

    fn valid(&self) -> bool {
        self.xx >= 0.0 && self.yy >= 0.0 && self.zz >= 0.0
            && (self.xx * self.yy - self.xy * self.xy) >= -1e-12
            && (self.yy * self.zz - self.yz * self.yz) >= -1e-12
            && (self.xx * self.zz - self.xz * self.xz) >= -1e-12
    }
}

/// Sensor provenance and calibration metadata.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SensorProvenance {
    pub sensor_id: String,
    #[serde(default)]
    pub calibration_metadata: Option<serde_json::Value>,
}

/// Optical observation: angles (deg), magnitude, covariance.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpticalMeasurement {
    /// Right ascension in degrees [0, 360).
    pub ra_deg: f64,
    /// Declination in degrees [-90, 90].
    pub dec_deg: f64,
    pub magnitude: f64,
    pub covariance: Covariance6,
    /// ISO8601 timestamp.
    pub observed_at: String,
    #[serde(default)]
    pub provenance: Option<SensorProvenance>,
}

/// RF observation: range, range-rate, DOA, SNR, covariance.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RfMeasurement {
    /// Range in meters.
    pub range_m: f64,
    /// Range rate in m/s.
    pub range_rate_m_s: f64,
    /// Direction of arrival in degrees [0, 360).
    pub doa_deg: f64,
    /// Signal-to-noise ratio in dB.
    pub snr_db: f64,
    pub covariance: Covariance6,
    pub observed_at: String,
    #[serde(default)]
    pub provenance: Option<SensorProvenance>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Measurement {
    Optical(OpticalMeasurement),
    Rf(RfMeasurement),
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct MeasurementBatch {
    #[serde(default)]
    pub optical: Vec<OpticalMeasurement>,
    #[serde(default)]
    pub rf: Vec<RfMeasurement>,
}

#[derive(Debug)]
pub struct ValidationError {
    pub field: String,
    pub message: String,
}

fn validate_optical(m: &OpticalMeasurement) -> Result<(), ValidationError> {
    if !(0.0..360.0).contains(&m.ra_deg) {
        return Err(ValidationError {
            field: "ra_deg".to_string(),
            message: "ra_deg must be in [0, 360)".to_string(),
        });
    }
    if !(-90.0..=90.0).contains(&m.dec_deg) {
        return Err(ValidationError {
            field: "dec_deg".to_string(),
            message: "dec_deg must be in [-90, 90]".to_string(),
        });
    }
    if !m.covariance.valid() {
        return Err(ValidationError {
            field: "covariance".to_string(),
            message: "covariance must be positive semi-definite".to_string(),
        });
    }
    if m.observed_at.is_empty() {
        return Err(ValidationError {
            field: "observed_at".to_string(),
            message: "observed_at is required".to_string(),
        });
    }
    Ok(())
}

fn validate_rf(m: &RfMeasurement) -> Result<(), ValidationError> {
    if m.range_m < 0.0 {
        return Err(ValidationError {
            field: "range_m".to_string(),
            message: "range_m must be non-negative".to_string(),
        });
    }
    if !(0.0..360.0).contains(&m.doa_deg) {
        return Err(ValidationError {
            field: "doa_deg".to_string(),
            message: "doa_deg must be in [0, 360)".to_string(),
        });
    }
    if !m.covariance.valid() {
        return Err(ValidationError {
            field: "covariance".to_string(),
            message: "covariance must be positive semi-definite".to_string(),
        });
    }
    if m.observed_at.is_empty() {
        return Err(ValidationError {
            field: "observed_at".to_string(),
            message: "observed_at is required".to_string(),
        });
    }
    Ok(())
}

impl OpticalMeasurement {
    pub fn validate(&self) -> Result<(), ValidationError> {
        validate_optical(self)
    }
}

impl RfMeasurement {
    pub fn validate(&self) -> Result<(), ValidationError> {
        validate_rf(self)
    }
}

impl MeasurementBatch {
    pub fn validate(&self) -> Result<(), ValidationError> {
        for (i, m) in self.optical.iter().enumerate() {
            m.validate().map_err(|e| ValidationError {
                field: format!("optical[{}].{}", i, e.field),
                message: e.message,
            })?;
        }
        for (i, m) in self.rf.iter().enumerate() {
            m.validate().map_err(|e| ValidationError {
                field: format!("rf[{}].{}", i, e.field),
                message: e.message,
            })?;
        }
        Ok(())
    }
}

impl Measurement {
    pub fn validate(&self) -> Result<(), ValidationError> {
        match self {
            Measurement::Optical(m) => m.validate(),
            Measurement::Rf(m) => m.validate(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn default_optical() -> OpticalMeasurement {
        OpticalMeasurement {
            ra_deg: 180.0,
            dec_deg: 45.0,
            magnitude: 10.0,
            covariance: Covariance6::default_diagonal(1e-6),
            observed_at: "2026-01-01T00:00:00Z".to_string(),
            provenance: None,
        }
    }

    fn default_rf() -> RfMeasurement {
        RfMeasurement {
            range_m: 1e6,
            range_rate_m_s: -100.0,
            doa_deg: 90.0,
            snr_db: 15.0,
            covariance: Covariance6::default_diagonal(100.0),
            observed_at: "2026-01-01T00:00:00Z".to_string(),
            provenance: None,
        }
    }

    #[test]
    fn accepts_valid_optical() {
        let m = default_optical();
        assert!(m.validate().is_ok());
    }

    #[test]
    fn accepts_valid_rf() {
        let m = default_rf();
        assert!(m.validate().is_ok());
    }

    #[test]
    fn rejects_optical_ra_out_of_range() {
        let mut m = default_optical();
        m.ra_deg = 400.0;
        assert!(m.validate().is_err());
        m.ra_deg = -0.1;
        assert!(m.validate().is_err());
    }

    #[test]
    fn rejects_optical_dec_out_of_range() {
        let mut m = default_optical();
        m.dec_deg = 91.0;
        assert!(m.validate().is_err());
        m.dec_deg = -91.0;
        assert!(m.validate().is_err());
    }

    #[test]
    fn rejects_rf_negative_range() {
        let mut m = default_rf();
        m.range_m = -1.0;
        assert!(m.validate().is_err());
    }

    #[test]
    fn rejects_rf_doa_out_of_range() {
        let mut m = default_rf();
        m.doa_deg = 360.0;
        assert!(m.validate().is_err());
    }

    #[test]
    fn rejects_empty_observed_at() {
        let mut m = default_optical();
        m.observed_at = String::new();
        assert!(m.validate().is_err());
        let mut r = default_rf();
        r.observed_at = String::new();
        assert!(r.validate().is_err());
    }

    #[test]
    fn batch_accepts_both_optical_and_rf() {
        let batch = MeasurementBatch {
            optical: vec![default_optical()],
            rf: vec![default_rf()],
        };
        assert!(batch.validate().is_ok());
    }

    #[test]
    fn batch_rejects_invalid_optical() {
        let mut bad = default_optical();
        bad.ra_deg = 500.0;
        let batch = MeasurementBatch {
            optical: vec![bad],
            rf: vec![],
        };
        assert!(batch.validate().is_err());
    }
}
