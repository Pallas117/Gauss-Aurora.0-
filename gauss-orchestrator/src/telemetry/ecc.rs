//! Small, bounded SEC-DED Hamming(72,64) codec for protected model/data words.
//!
//! This is a software integrity layer for tests, checkpoint records, and
//! scrubbed buffers. It is not a replacement for a qualified ECC memory
//! controller or a radiation test campaign.

const PARITY_POSITIONS: [u8; 7] = [1, 2, 4, 8, 16, 32, 64];
const MAX_HAMMING_POSITION: u8 = 71;
const OVERALL_PARITY_POSITION: u8 = 72;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DecodeStatus {
    Clean,
    CorrectedSingleBit { position: u8 },
    DetectedDoubleBit,
    Uncorrectable,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DecodeResult {
    pub status: DecodeStatus,
    pub data: Option<u64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FaultInjectionReport {
    pub single_bit_cases: u32,
    pub corrected_single_bit: u32,
    pub double_bit_cases: u32,
    pub detected_double_bit: u32,
}

fn is_parity_position(position: u8) -> bool {
    PARITY_POSITIONS.contains(&position)
}

fn get_bit(codeword: u128, position: u8) -> bool {
    ((codeword >> u32::from(position - 1)) & 1) != 0
}

fn set_bit(codeword: &mut u128, position: u8, value: bool) {
    let mask = 1u128 << u32::from(position - 1);
    if value {
        *codeword |= mask;
    } else {
        *codeword &= !mask;
    }
}

fn hamming_syndrome(codeword: u128) -> u8 {
    let mut syndrome = 0u8;
    for parity_position in PARITY_POSITIONS {
        let mut parity = false;
        for position in 1..=MAX_HAMMING_POSITION {
            if position & parity_position != 0 {
                parity ^= get_bit(codeword, position);
            }
        }
        if parity {
            syndrome |= parity_position;
        }
    }
    syndrome
}

fn overall_parity(codeword: u128) -> bool {
    let mut parity = false;
    for position in 1..=OVERALL_PARITY_POSITION {
        parity ^= get_bit(codeword, position);
    }
    parity
}

/// Encode one 64-bit word into a 72-bit SEC-DED codeword held in `u128`.
pub fn encode(data: u64) -> u128 {
    let mut codeword = 0u128;
    let mut data_index = 0u8;
    for position in 1..=MAX_HAMMING_POSITION {
        if !is_parity_position(position) {
            set_bit(&mut codeword, position, ((data >> data_index) & 1) != 0);
            data_index += 1;
        }
    }
    for parity_position in PARITY_POSITIONS {
        let mut parity = false;
        for position in 1..=MAX_HAMMING_POSITION {
            if position & parity_position != 0 {
                parity ^= get_bit(codeword, position);
            }
        }
        set_bit(&mut codeword, parity_position, parity);
    }
    let overall = overall_parity(codeword);
    set_bit(&mut codeword, OVERALL_PARITY_POSITION, overall);
    codeword
}

/// Decode and correct a codeword. Double-bit errors are detected and rejected.
pub fn decode(mut codeword: u128) -> DecodeResult {
    let syndrome = hamming_syndrome(codeword);
    let overall_error = overall_parity(codeword);
    let status = match (overall_error, syndrome) {
        (false, 0) => DecodeStatus::Clean,
        (true, 0) => {
            let current = get_bit(codeword, OVERALL_PARITY_POSITION);
            set_bit(&mut codeword, OVERALL_PARITY_POSITION, !current);
            DecodeStatus::CorrectedSingleBit {
                position: OVERALL_PARITY_POSITION,
            }
        }
        (true, position) if position <= MAX_HAMMING_POSITION => {
            let current = get_bit(codeword, position);
            set_bit(&mut codeword, position, !current);
            DecodeStatus::CorrectedSingleBit { position }
        }
        (false, position) if position != 0 => DecodeStatus::DetectedDoubleBit,
        _ => DecodeStatus::Uncorrectable,
    };

    let data = match status {
        DecodeStatus::DetectedDoubleBit | DecodeStatus::Uncorrectable => None,
        DecodeStatus::Clean | DecodeStatus::CorrectedSingleBit { .. } => {
            let mut value = 0u64;
            let mut data_index = 0u8;
            for position in 1..=MAX_HAMMING_POSITION {
                if !is_parity_position(position) {
                    if get_bit(codeword, position) {
                        value |= 1u64 << data_index;
                    }
                    data_index += 1;
                }
            }
            Some(value)
        }
    };
    DecodeResult { status, data }
}

pub fn flip_bit(codeword: u128, position: u8) -> Option<u128> {
    if position == 0 || position > OVERALL_PARITY_POSITION {
        return None;
    }
    Some(codeword ^ (1u128 << u32::from(position - 1)))
}

pub fn fault_injection_report(data: u64) -> FaultInjectionReport {
    let clean = encode(data);
    let mut report = FaultInjectionReport {
        single_bit_cases: 0,
        corrected_single_bit: 0,
        double_bit_cases: 0,
        detected_double_bit: 0,
    };
    for first in 1..=OVERALL_PARITY_POSITION {
        report.single_bit_cases += 1;
        if let Some(faulted) = flip_bit(clean, first) {
            let result = decode(faulted);
            if matches!(result.status, DecodeStatus::CorrectedSingleBit { .. })
                && result.data == Some(data)
            {
                report.corrected_single_bit += 1;
            }
        }
        for second in (first + 1)..=OVERALL_PARITY_POSITION {
            report.double_bit_cases += 1;
            if let Some(one) = flip_bit(clean, first) {
                if let Some(two) = flip_bit(one, second) {
                    if matches!(decode(two).status, DecodeStatus::DetectedDoubleBit) {
                        report.detected_double_bit += 1;
                    }
                }
            }
        }
    }
    report
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip_preserves_data() {
        let data = 0x0123_4567_89ab_cdefu64;
        let result = decode(encode(data));
        assert_eq!(result.status, DecodeStatus::Clean);
        assert_eq!(result.data, Some(data));
    }

    #[test]
    fn all_single_bit_faults_are_corrected() {
        let report = fault_injection_report(0xfeed_face_cafe_beefu64);
        assert_eq!(report.single_bit_cases, 72);
        assert_eq!(report.corrected_single_bit, 72);
    }

    #[test]
    fn all_double_bit_faults_are_detected() {
        let report = fault_injection_report(0xfeed_face_cafe_beefu64);
        assert_eq!(report.double_bit_cases, 2_556);
        assert_eq!(report.detected_double_bit, 2_556);
    }
}
