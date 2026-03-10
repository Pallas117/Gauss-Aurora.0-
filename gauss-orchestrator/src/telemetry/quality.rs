use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PacketQualityFlags {
    pub crc_checked: bool,
    pub crc_valid: Option<bool>,
    pub missing_parameters: bool,
}

impl Default for PacketQualityFlags {
    fn default() -> Self {
        Self {
            crc_checked: false,
            crc_valid: None,
            missing_parameters: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PacketUncertainty {
    pub speed_sigma: f64,
    pub density_sigma: f64,
    pub bz_sigma: f64,
}

impl Default for PacketUncertainty {
    fn default() -> Self {
        Self {
            speed_sigma: 8.0,
            density_sigma: 0.6,
            bz_sigma: 0.8,
        }
    }
}
