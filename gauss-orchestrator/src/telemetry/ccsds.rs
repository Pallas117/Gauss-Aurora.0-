use chrono::Utc;
use std::path::Path;

use crate::telemetry::{
    decoder_registry::DecoderFormat, quality, CcsdsPrimaryHeader, DecodeBatch, DecodeError,
    DecodedPacket,
};

fn to_hex_upper(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        out.push_str(&format!("{:02X}", b));
    }
    out
}

fn crc16_ccitt(bytes: &[u8]) -> u16 {
    let mut crc: u16 = 0xFFFF;
    for byte in bytes {
        crc ^= (*byte as u16) << 8;
        for _ in 0..8 {
            if (crc & 0x8000) != 0 {
                crc = (crc << 1) ^ 0x1021;
            } else {
                crc <<= 1;
            }
        }
    }
    crc
}

pub fn parse_primary_header(raw: &[u8]) -> Option<CcsdsPrimaryHeader> {
    if raw.len() < 6 {
        return None;
    }

    let word1 = u16::from_be_bytes([raw[0], raw[1]]);
    let word2 = u16::from_be_bytes([raw[2], raw[3]]);
    let word3 = u16::from_be_bytes([raw[4], raw[5]]);

    Some(CcsdsPrimaryHeader {
        version: ((word1 >> 13) & 0x07) as u8,
        packet_type: ((word1 >> 12) & 0x01) as u8,
        sec_header_flag: ((word1 >> 11) & 0x01) == 1,
        apid: word1 & 0x07FF,
        seq_flags: ((word2 >> 14) & 0x03) as u8,
        seq_count: word2 & 0x3FFF,
        data_length: word3,
    })
}

pub fn decode_stream(
    source_file: &Path,
    format: DecoderFormat,
    raw_stream: &[u8],
    packet_max_bytes: usize,
    crc_enabled: bool,
) -> DecodeBatch {
    let mut packets = Vec::new();
    let mut errors = Vec::new();
    let file = source_file.display().to_string();
    let mut offset = 0usize;

    while offset < raw_stream.len() {
        let remaining = raw_stream.len() - offset;
        if remaining < 6 {
            errors.push(DecodeError {
                code: "invalid_length".to_string(),
                reason: "remaining bytes smaller than CCSDS primary header".to_string(),
                file: file.clone(),
                offset,
            });
            break;
        }

        let header = match parse_primary_header(&raw_stream[offset..offset + 6]) {
            Some(parsed) => parsed,
            None => {
                errors.push(DecodeError {
                    code: "invalid_header".to_string(),
                    reason: "failed to parse CCSDS primary header".to_string(),
                    file: file.clone(),
                    offset,
                });
                break;
            }
        };

        let total_len = 6usize + header.data_length as usize + 1usize;
        if total_len > packet_max_bytes {
            errors.push(DecodeError {
                code: "packet_too_large".to_string(),
                reason: format!(
                    "packet length {} exceeds configured max {}",
                    total_len, packet_max_bytes
                ),
                file: file.clone(),
                offset,
            });
            if offset + total_len <= raw_stream.len() {
                offset += total_len;
            } else {
                break;
            }
            continue;
        }
        if offset + total_len > raw_stream.len() {
            errors.push(DecodeError {
                code: "invalid_length".to_string(),
                reason: "packet length exceeds file boundaries".to_string(),
                file: file.clone(),
                offset,
            });
            break;
        }

        let packet_bytes = &raw_stream[offset..offset + total_len];
        let mut payload = packet_bytes[6..].to_vec();
        let mut quality_flags = quality::PacketQualityFlags::default();

        if crc_enabled {
            quality_flags.crc_checked = true;
            if payload.len() < 2 {
                errors.push(DecodeError {
                    code: "crc_mismatch".to_string(),
                    reason: "crc enabled but payload does not include crc trailer".to_string(),
                    file: file.clone(),
                    offset,
                });
                offset += total_len;
                continue;
            }

            let split = payload.len() - 2;
            let expected_crc = u16::from_be_bytes([payload[split], payload[split + 1]]);
            let computed_crc = crc16_ccitt(&packet_bytes[..packet_bytes.len() - 2]);
            if expected_crc != computed_crc {
                quality_flags.crc_valid = Some(false);
                errors.push(DecodeError {
                    code: "crc_mismatch".to_string(),
                    reason: format!(
                        "crc mismatch expected=0x{:04X} computed=0x{:04X}",
                        expected_crc, computed_crc
                    ),
                    file: file.clone(),
                    offset,
                });
                offset += total_len;
                continue;
            }

            quality_flags.crc_valid = Some(true);
            payload.truncate(split);
        }

        packets.push(DecodedPacket {
            timestamp: Utc::now().to_rfc3339(),
            apid: header.apid,
            seq_count: header.seq_count,
            payload_hex: to_hex_upper(&payload),
            payload,
            quality_flags,
            uncertainty: quality::PacketUncertainty::default(),
        });

        offset += total_len;
    }

    DecodeBatch {
        packets,
        errors,
        format,
    }
}
