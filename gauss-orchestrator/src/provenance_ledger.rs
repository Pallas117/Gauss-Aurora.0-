use sha2::{Digest, Sha256};
use std::time::{SystemTime, UNIX_EPOCH};

/// Immutable local-first provenance record for one reasoning event.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MissionBlock {
    pub timestamp_ms: u128,
    pub reasoning_hash: String,
    pub prev_hash: String,
    pub block_hash: String,
}

impl MissionBlock {
    pub fn new(reasoning: &str, prev_hash: impl Into<String>) -> Self {
        let timestamp_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis();

        Self::new_with_timestamp(reasoning, prev_hash, timestamp_ms)
    }

    fn new_with_timestamp(
        reasoning: &str,
        prev_hash: impl Into<String>,
        timestamp_ms: u128,
    ) -> Self {
        let prev_hash = prev_hash.into();
        let reasoning_hash = sha256_hex(reasoning.as_bytes());

        let canonical = format!("{}:{}:{}", timestamp_ms, prev_hash, reasoning_hash);
        let block_hash = sha256_hex(canonical.as_bytes());

        Self {
            timestamp_ms,
            reasoning_hash,
            prev_hash,
            block_hash,
        }
    }
}

/// In-memory chain. Useful for local audit and replay validation.
#[derive(Debug, Default, Clone)]
pub struct MissionLedger {
    pub blocks: Vec<MissionBlock>,
}

impl MissionLedger {
    pub fn new(genesis_prev_hash: impl Into<String>) -> Self {
        let genesis_prev_hash = genesis_prev_hash.into();
        let genesis = MissionBlock::new_with_timestamp("GENESIS", genesis_prev_hash, 0);
        Self {
            blocks: vec![genesis],
        }
    }

    pub fn append(&mut self, reasoning: &str) -> &MissionBlock {
        let prev_hash = self
            .blocks
            .last()
            .map(|b| b.block_hash.clone())
            .unwrap_or_else(|| "0".repeat(64));

        let block = MissionBlock::new(reasoning, prev_hash);
        self.blocks.push(block);
        self.blocks.last().expect("ledger contains appended block")
    }

    pub fn verify_chain(&self) -> bool {
        if self.blocks.is_empty() {
            return true;
        }

        for (index, block) in self.blocks.iter().enumerate() {
            let recalculated = sha256_hex(
                format!(
                    "{}:{}:{}",
                    block.timestamp_ms, block.prev_hash, block.reasoning_hash
                )
                .as_bytes(),
            );

            if block.block_hash != recalculated {
                return false;
            }

            if index > 0 {
                let previous = &self.blocks[index - 1];
                if block.prev_hash != previous.block_hash {
                    return false;
                }
            }
        }

        true
    }
}

pub fn sha256_hex(input: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(input);
    format!("{:x}", hasher.finalize())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hashes_reasoning_deterministically() {
        let input = "Detected flux spike; initiating magnetic shielding.";
        let expected =
            "bb2be3634acb77223cdcc1fb3e51c95fd129bbd1c2a2d5e01e119048cc0f685f".to_string();
        assert_eq!(sha256_hex(input.as_bytes()), expected);
    }

    #[test]
    fn ledger_links_blocks_and_verifies() {
        let mut ledger = MissionLedger::new("0".repeat(32));
        ledger.append("event-a");
        ledger.append("event-b");

        assert!(ledger.verify_chain());
        assert_eq!(ledger.blocks.len(), 3);
        assert_eq!(ledger.blocks[2].prev_hash, ledger.blocks[1].block_hash);
    }

    #[test]
    fn verification_fails_on_tamper() {
        let mut ledger = MissionLedger::new("0".repeat(32));
        ledger.append("event-a");
        ledger.append("event-b");

        ledger.blocks[1].reasoning_hash = "tampered".to_string();
        assert!(!ledger.verify_chain());
    }
}
