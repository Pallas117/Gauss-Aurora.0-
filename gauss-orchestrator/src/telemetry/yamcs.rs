//! Yamcs-facing normalized packet envelope.
//!
//! Yamcs remains the mission-data service at the integration boundary. This
//! module keeps the onboard/orchestrator representation deterministic and
//! makes the conversion explicit for a Yamcs REST/WebSocket adapter.

use super::DecodedPacket;
use serde::{Deserialize, Serialize};

pub const YAMCS_ADAPTER_SCHEMA: &str = "gauss-yamcs-packet-v1";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct YamcsPacket {
    pub schema: String,
    pub spacecraft_id: String,
    pub packet_name: String,
    pub apid: u16,
    pub sequence_number: u16,
    pub generation_time: String,
    pub reception_time: String,
    pub payload_hex: String,
    pub quality_flags: super::quality::PacketQualityFlags,
    pub uncertainty: super::quality::PacketUncertainty,
}

pub fn from_decoded(packet: &DecodedPacket, spacecraft_id: &str, packet_name: &str) -> YamcsPacket {
    YamcsPacket {
        schema: YAMCS_ADAPTER_SCHEMA.to_string(),
        spacecraft_id: spacecraft_id.to_string(),
        packet_name: packet_name.to_string(),
        apid: packet.apid,
        sequence_number: packet.seq_count,
        generation_time: packet.timestamp.clone(),
        reception_time: packet.timestamp.clone(),
        payload_hex: packet.payload_hex.clone(),
        quality_flags: packet.quality_flags.clone(),
        uncertainty: packet.uncertainty.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::telemetry::quality::{PacketQualityFlags, PacketUncertainty};

    #[test]
    fn conversion_is_replayable_and_preserves_quality() {
        let packet = DecodedPacket {
            timestamp: "2026-08-19T00:00:00Z".to_string(),
            apid: 900,
            seq_count: 4,
            payload_hex: "3f800000".to_string(),
            payload: vec![0x3f, 0x80, 0, 0],
            quality_flags: PacketQualityFlags::default(),
            uncertainty: PacketUncertainty::default(),
        };
        let mapped = from_decoded(&packet, "GAUSS-TEST-01", "GAUSS_MHD_HK");
        assert_eq!(mapped.schema, YAMCS_ADAPTER_SCHEMA);
        assert_eq!(mapped.sequence_number, 4);
        assert_eq!(mapped.quality_flags, packet.quality_flags);
        assert_eq!(mapped.uncertainty, packet.uncertainty);
    }
}
