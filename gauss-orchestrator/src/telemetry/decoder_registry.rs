use anyhow::{bail, Context};
use std::path::Path;

use crate::config::OrchestratorConfig;
use crate::telemetry::{ccsds, DecodeBatch, DecodeError};

/// Virtual path used when decoding from bytes (e.g. HTTP body) rather than a file.
pub const INLINE_DECODE_PATH: &str = "<inline>";

#[derive(Debug, Clone, Copy)]
pub enum DecoderFormat {
    CcsdsBin,
    CcsdsHex,
}

impl DecoderFormat {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::CcsdsBin => "ccsds-bin",
            Self::CcsdsHex => "ccsds-hex",
        }
    }
}

pub fn detect_format(path: &Path) -> Option<DecoderFormat> {
    let ext = path.extension()?.to_str()?.to_ascii_lowercase();
    match ext.as_str() {
        "bin" | "ccsds" => Some(DecoderFormat::CcsdsBin),
        "hex" => Some(DecoderFormat::CcsdsHex),
        _ => None,
    }
}

fn hex_nibble(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(10 + (byte - b'a')),
        b'A'..=b'F' => Some(10 + (byte - b'A')),
        _ => None,
    }
}

fn decode_hex_line(line: &str) -> anyhow::Result<Vec<u8>> {
    let mut compact = Vec::with_capacity(line.len());
    for b in line.bytes() {
        if b.is_ascii_hexdigit() {
            compact.push(b);
        }
    }
    if compact.is_empty() {
        return Ok(Vec::new());
    }
    if compact.len() % 2 != 0 {
        bail!("hex line has odd nibble count");
    }

    let mut out = Vec::with_capacity(compact.len() / 2);
    let mut i = 0usize;
    while i < compact.len() {
        let hi = hex_nibble(compact[i]).context("invalid high nibble in hex line")?;
        let lo = hex_nibble(compact[i + 1]).context("invalid low nibble in hex line")?;
        out.push((hi << 4) | lo);
        i += 2;
    }

    Ok(out)
}

/// Decode packet bytes with an explicit format (e.g. from HTTP body). Use `path` for error reporting only.
pub fn decode_packet_bytes(
    path: &Path,
    bytes: &[u8],
    format: DecoderFormat,
    config: &OrchestratorConfig,
) -> DecodeBatch {
    match format {
        DecoderFormat::CcsdsBin => ccsds::decode_stream(
            path,
            format,
            bytes,
            config.packet_max_bytes,
            config.packet_crc_enabled,
        ),
        DecoderFormat::CcsdsHex => {
            let mut aggregate_packets = Vec::new();
            let mut aggregate_errors = Vec::new();
            let text = String::from_utf8_lossy(bytes);
            for (line_idx, line) in text.lines().enumerate() {
                if line.trim().is_empty() {
                    continue;
                }
                match decode_hex_line(line) {
                    Ok(decoded_line) if !decoded_line.is_empty() => {
                        let mut batch = ccsds::decode_stream(
                            path,
                            format,
                            &decoded_line,
                            config.packet_max_bytes,
                            config.packet_crc_enabled,
                        );
                        aggregate_packets.append(&mut batch.packets);
                        aggregate_errors.append(&mut batch.errors);
                    }
                    Ok(_) => {}
                    Err(error) => {
                        aggregate_errors.push(DecodeError {
                            code: "invalid_hex".to_string(),
                            reason: format!("line {}: {}", line_idx + 1, error),
                            file: path.display().to_string(),
                            offset: line_idx,
                        });
                    }
                }
            }
            DecodeBatch {
                packets: aggregate_packets,
                errors: aggregate_errors,
                format,
            }
        }
    }
}

pub fn decode_packet_file(
    path: &Path,
    bytes: &[u8],
    config: &OrchestratorConfig,
) -> anyhow::Result<DecodeBatch> {
    let format = detect_format(path).with_context(|| {
        format!(
            "no packet decoder registered for extension: {}",
            path.extension()
                .and_then(|ext| ext.to_str())
                .unwrap_or("<none>")
        )
    })?;

    Ok(decode_packet_bytes(path, bytes, format, config))
}
