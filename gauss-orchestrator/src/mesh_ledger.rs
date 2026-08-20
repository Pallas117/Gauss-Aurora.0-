//! Dependency-light mesh ledger primitives.
//!
//! This is deliberately a control/provenance ledger, not a telemetry database
//! or a public cryptocurrency chain.  Payloads remain encrypted and off-chain;
//! envelopes carry only their content identifier and bounded metadata.  The
//! signature fields are detached values produced by the deployment's approved
//! identity/PQC boundary.  This crate validates presence and chain structure,
//! while cryptographic verification remains at that boundary until a vetted
//! ML-DSA/hybrid implementation is selected.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};

pub const MESH_PROTOCOL: &str = "gauss-mesh-v1";
pub const MAX_EVENTS_PER_BLOCK: usize = 256;
pub const MAX_METADATA_BYTES: usize = 16 * 1024;
/// Keep the in-process provenance window finite. Export/checkpoint before
/// rotating to a new ledger; do not silently discard history needed for replay.
pub const MAX_BLOCKS: usize = 256;
pub const MAX_TRACKED_EVENTS: usize = 32_768;
pub const MAX_LEDGER_METADATA_BYTES: usize = 8 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct MeshEnvelope {
    pub protocol: String,
    pub node_id: String,
    pub device_id: String,
    pub sequence: u64,
    pub observed_at_ms: i64,
    pub topic: String,
    pub payload_cid: String,
    pub payload_bytes: u64,
    pub previous_event_hash: String,
    pub signature_scheme: String,
    pub signature: String,
}

impl MeshEnvelope {
    /// Build an envelope without retaining the payload bytes.
    #[allow(clippy::too_many_arguments)]
    pub fn from_payload(
        node_id: impl Into<String>,
        device_id: impl Into<String>,
        sequence: u64,
        observed_at_ms: i64,
        topic: impl Into<String>,
        payload: &[u8],
        previous_event_hash: impl Into<String>,
        signature_scheme: impl Into<String>,
        signature: impl Into<String>,
    ) -> Self {
        Self {
            protocol: MESH_PROTOCOL.to_string(),
            node_id: node_id.into(),
            device_id: device_id.into(),
            sequence,
            observed_at_ms,
            topic: topic.into(),
            payload_cid: content_id(payload),
            payload_bytes: payload.len() as u64,
            previous_event_hash: previous_event_hash.into(),
            signature_scheme: signature_scheme.into(),
            signature: signature.into(),
        }
    }

    pub fn event_hash(&self) -> String {
        sha256_hex(self.canonical().as_bytes())
    }

    pub fn canonical(&self) -> String {
        format!(
            "{}|{}|{}|{}|{}|{}|{}|{}|{}|{}|{}",
            self.protocol,
            self.node_id,
            self.device_id,
            self.sequence,
            self.observed_at_ms,
            self.topic,
            self.payload_cid,
            self.payload_bytes,
            self.previous_event_hash,
            self.signature_scheme,
            self.signature,
        )
    }

    pub fn validate_shape(&self) -> Result<(), String> {
        if self.protocol != MESH_PROTOCOL {
            return Err(format!("unsupported mesh protocol: {}", self.protocol));
        }
        if self.node_id.trim().is_empty() || self.device_id.trim().is_empty() {
            return Err("node_id and device_id are required".to_string());
        }
        if self.topic.trim().is_empty() {
            return Err("topic is required".to_string());
        }
        if self.payload_cid.len() != 71
            || !self.payload_cid.starts_with("sha256:")
            || !self.payload_cid[7..]
                .chars()
                .all(|character| character.is_ascii_hexdigit())
        {
            return Err("payload_cid must be a sha256:<64-hex> content identifier".to_string());
        }
        if self.signature_scheme.trim().is_empty() || self.signature.trim().is_empty() {
            return Err("detached signature and signature_scheme are required".to_string());
        }
        if self.canonical().len() > MAX_METADATA_BYTES {
            return Err("mesh envelope metadata exceeds bounded size".to_string());
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct MeshBlock {
    pub protocol: String,
    pub height: u64,
    pub validator_id: String,
    pub parent_hash: String,
    pub events: Vec<MeshEnvelope>,
    pub merkle_root: String,
    pub block_hash: String,
}

impl MeshBlock {
    fn new(
        height: u64,
        validator_id: String,
        parent_hash: String,
        events: Vec<MeshEnvelope>,
    ) -> Self {
        let merkle_root = merkle_root(&events);
        let block_hash = sha256_hex(
            format!(
                "{}|{}|{}|{}|{}",
                MESH_PROTOCOL, height, validator_id, parent_hash, merkle_root
            )
            .as_bytes(),
        );
        Self {
            protocol: MESH_PROTOCOL.to_string(),
            height,
            validator_id,
            parent_hash,
            events,
            merkle_root,
            block_hash,
        }
    }

    fn verify_hash(&self) -> bool {
        self.block_hash
            == sha256_hex(
                format!(
                    "{}|{}|{}|{}|{}",
                    self.protocol,
                    self.height,
                    self.validator_id,
                    self.parent_hash,
                    self.merkle_root
                )
                .as_bytes(),
            )
            && self.merkle_root == merkle_root(&self.events)
    }
}

#[derive(Debug, Clone, Default)]
pub struct MeshLedger {
    blocks: Vec<MeshBlock>,
    seen_events: BTreeSet<String>,
    last_sequences: BTreeMap<(String, String), u64>,
    last_event_hashes: BTreeMap<(String, String), String>,
    retained_event_count: usize,
    retained_metadata_bytes: usize,
}

impl MeshLedger {
    pub fn new(genesis_hash: impl Into<String>, validator_id: impl Into<String>) -> Self {
        let genesis = MeshBlock::new(0, validator_id.into(), genesis_hash.into(), Vec::new());
        Self {
            blocks: vec![genesis],
            seen_events: BTreeSet::new(),
            last_sequences: BTreeMap::new(),
            last_event_hashes: BTreeMap::new(),
            retained_event_count: 0,
            retained_metadata_bytes: 0,
        }
    }

    pub fn append_event(&mut self, event: MeshEnvelope) -> Result<&MeshBlock, String> {
        self.append_block(vec![event])
    }

    pub fn append_block(&mut self, events: Vec<MeshEnvelope>) -> Result<&MeshBlock, String> {
        if events.is_empty() {
            return Err("mesh block must contain at least one event".to_string());
        }
        if events.len() > MAX_EVENTS_PER_BLOCK {
            return Err("mesh block exceeds MAX_EVENTS_PER_BLOCK".to_string());
        }
        if self.blocks.len() >= MAX_BLOCKS {
            return Err("mesh ledger reached its bounded in-memory block capacity; checkpoint and rotate before appending".to_string());
        }

        let mut batch_sequences = BTreeMap::<(String, String), u64>::new();
        let mut batch_hashes = BTreeMap::<(String, String), String>::new();
        let mut incoming_metadata_bytes = 0usize;
        for event in &events {
            event.validate_shape()?;
            incoming_metadata_bytes =
                incoming_metadata_bytes.saturating_add(event.canonical().len());
            let hash = event.event_hash();
            if self.seen_events.contains(&hash) {
                return Err(format!("duplicate mesh event: {hash}"));
            }
            let key = (event.node_id.clone(), event.device_id.clone());
            let previous_sequence = batch_sequences
                .get(&key)
                .or_else(|| self.last_sequences.get(&key));
            if let Some(previous) = previous_sequence {
                if event.sequence <= *previous {
                    return Err(format!(
                        "non-monotonic sequence for {}/{}: {} <= {}",
                        key.0, key.1, event.sequence, previous
                    ));
                }
            }
            let previous_hash = batch_hashes
                .get(&key)
                .or_else(|| self.last_event_hashes.get(&key));
            if let Some(previous_hash) = previous_hash {
                if event.previous_event_hash != *previous_hash {
                    return Err(format!("broken event parent for {}/{}", key.0, key.1));
                }
            }
            batch_sequences.insert(key.clone(), event.sequence);
            batch_hashes.insert(key, hash);
        }
        if self.retained_event_count.saturating_add(events.len()) > MAX_TRACKED_EVENTS {
            return Err("mesh ledger reached its bounded event capacity; checkpoint and rotate before appending".to_string());
        }
        if self
            .retained_metadata_bytes
            .saturating_add(incoming_metadata_bytes)
            > MAX_LEDGER_METADATA_BYTES
        {
            return Err("mesh ledger reached its bounded metadata capacity; checkpoint and rotate before appending".to_string());
        }

        let parent_hash = self
            .blocks
            .last()
            .map(|block| block.block_hash.clone())
            .unwrap_or_else(|| "0".repeat(64));
        let validator_id = self
            .blocks
            .first()
            .map(|block| block.validator_id.clone())
            .unwrap_or_else(|| "unknown".to_string());
        let block = MeshBlock::new(self.blocks.len() as u64, validator_id, parent_hash, events);
        for event in &block.events {
            self.seen_events.insert(event.event_hash());
            let key = (event.node_id.clone(), event.device_id.clone());
            self.last_sequences.insert(key.clone(), event.sequence);
            self.last_event_hashes.insert(key, event.event_hash());
        }
        self.blocks.push(block);
        self.retained_event_count = self.retained_event_count.saturating_add(
            self.blocks
                .last()
                .map(|value| value.events.len())
                .unwrap_or(0),
        );
        self.retained_metadata_bytes = self
            .retained_metadata_bytes
            .saturating_add(incoming_metadata_bytes);
        Ok(self
            .blocks
            .last()
            .expect("mesh ledger contains appended block"))
    }

    pub fn verify(&self) -> Result<(), String> {
        if self.blocks.is_empty() {
            return Err("mesh ledger has no genesis block".to_string());
        }
        let mut seen_events = BTreeSet::new();
        let mut sequences = BTreeMap::<(String, String), u64>::new();
        let mut event_hashes = BTreeMap::<(String, String), String>::new();
        for (index, block) in self.blocks.iter().enumerate() {
            if block.height != index as u64 || !block.verify_hash() {
                return Err(format!("invalid mesh block at height {}", index));
            }
            if index > 0 && block.parent_hash != self.blocks[index - 1].block_hash {
                return Err(format!("mesh fork or broken parent at height {}", index));
            }
            for event in &block.events {
                event.validate_shape()?;
                let hash = event.event_hash();
                if !seen_events.insert(hash.clone()) {
                    return Err(format!("duplicate event during replay: {hash}"));
                }
                let key = (event.node_id.clone(), event.device_id.clone());
                if let Some(previous) = sequences.insert(key.clone(), event.sequence) {
                    if event.sequence <= previous {
                        return Err(format!(
                            "non-monotonic replay sequence for {}/{}",
                            key.0, key.1
                        ));
                    }
                }
                if let Some(previous_hash) = event_hashes.insert(key.clone(), event.event_hash()) {
                    if event.previous_event_hash != previous_hash {
                        return Err(format!(
                            "broken event parent during replay for {}/{}",
                            key.0, key.1
                        ));
                    }
                }
            }
        }
        Ok(())
    }

    pub fn tip(&self) -> Option<&MeshBlock> {
        self.blocks.last()
    }

    pub fn blocks(&self) -> &[MeshBlock] {
        &self.blocks
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct MeshCheckpoint {
    pub height: u64,
    pub block_hash: String,
    pub signatures: BTreeMap<String, String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ValidatorSet {
    validators: BTreeSet<String>,
    quorum: usize,
}

impl ValidatorSet {
    pub fn new<I, S>(validators: I) -> Result<Self, String>
    where
        I: IntoIterator<Item = S>,
        S: Into<String>,
    {
        let validators = validators
            .into_iter()
            .map(Into::into)
            .filter(|value| !value.trim().is_empty())
            .collect::<BTreeSet<_>>();
        if validators.len() < 3 {
            return Err("permissioned mesh requires at least three validators".to_string());
        }
        let quorum = (validators.len() * 2) / 3 + 1;
        Ok(Self { validators, quorum })
    }

    pub fn quorum(&self) -> usize {
        self.quorum
    }

    pub fn validate_checkpoint(&self, checkpoint: &MeshCheckpoint) -> Result<(), String> {
        if checkpoint.block_hash.len() != 64 {
            return Err("checkpoint block_hash must be a 64-character SHA-256 hash".to_string());
        }
        if checkpoint.signatures.len() < self.quorum {
            return Err(format!(
                "checkpoint has {} signatures; quorum is {}",
                checkpoint.signatures.len(),
                self.quorum
            ));
        }
        if checkpoint
            .signatures
            .keys()
            .any(|validator| !self.validators.contains(validator))
        {
            return Err("checkpoint contains a signature from an unknown validator".to_string());
        }
        if checkpoint
            .signatures
            .values()
            .any(|signature| signature.trim().is_empty())
        {
            return Err("checkpoint signatures must be non-empty detached values".to_string());
        }
        Ok(())
    }
}

pub fn content_id(payload: &[u8]) -> String {
    format!("sha256:{}", sha256_hex(payload))
}

fn merkle_root(events: &[MeshEnvelope]) -> String {
    if events.is_empty() {
        return sha256_hex(b"gauss-mesh-empty");
    }
    let mut level = events
        .iter()
        .map(MeshEnvelope::event_hash)
        .collect::<Vec<_>>();
    while level.len() > 1 {
        let mut next = Vec::with_capacity(level.len().div_ceil(2));
        for pair in level.chunks(2) {
            let right = pair.get(1).unwrap_or(&pair[0]);
            next.push(sha256_hex(format!("{}:{}", pair[0], right).as_bytes()));
        }
        level = next;
    }
    level.pop().expect("non-empty merkle level")
}

pub fn sha256_hex(input: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(input);
    format!("{:x}", hasher.finalize())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn event(node: &str, device: &str, sequence: u64, payload: &[u8]) -> MeshEnvelope {
        MeshEnvelope::from_payload(
            node,
            device,
            sequence,
            1_700_000_000_000 + sequence as i64,
            "telemetry/health",
            payload,
            "",
            "hybrid-pqc-v1",
            format!("detached-signature-{sequence}"),
        )
    }

    #[test]
    fn content_id_is_stable_without_retaining_payload() {
        assert_eq!(
            content_id(b"health:nominal"),
            "sha256:75d4e6219163e414c41f4ec3a41082ffa674f8776762c4f4d6d325befa22834e"
        );
    }

    #[test]
    fn ledger_batches_events_and_replays_deterministically() {
        let mut ledger = MeshLedger::new("genesis", "validator-a");
        let first = event("validator-a", "device-1", 1, b"a");
        let mut second = event("validator-a", "device-1", 2, b"b");
        second.previous_event_hash = first.event_hash();
        ledger.append_block(vec![first, second]).unwrap();
        assert!(ledger.verify().is_ok());
        assert_eq!(ledger.tip().unwrap().height, 1);
        assert_eq!(ledger.tip().unwrap().events.len(), 2);
    }

    #[test]
    fn duplicate_and_replayed_sequences_are_rejected() {
        let mut ledger = MeshLedger::new("genesis", "validator-a");
        let first = event("validator-a", "device-1", 1, b"a");
        ledger.append_event(first.clone()).unwrap();
        assert!(ledger.append_event(first).is_err());
        assert!(ledger
            .append_event(event("validator-a", "device-1", 1, b"different"))
            .is_err());
    }

    #[test]
    fn tampering_and_forks_are_detected() {
        let mut ledger = MeshLedger::new("genesis", "validator-a");
        ledger
            .append_event(event("validator-a", "device-1", 1, b"a"))
            .unwrap();
        ledger.blocks[1].events[0].topic = "tampered".to_string();
        assert!(ledger.verify().is_err());
    }

    #[test]
    fn broken_event_parent_is_rejected() {
        let mut ledger = MeshLedger::new("genesis", "validator-a");
        ledger
            .append_event(event("validator-a", "device-1", 1, b"a"))
            .unwrap();
        assert!(ledger
            .append_event(event("validator-a", "device-1", 2, b"b"))
            .is_err());
    }

    #[test]
    fn ledger_rejects_growth_before_in_process_capacity_is_exceeded() {
        let mut ledger = MeshLedger::new("genesis", "validator-a");
        let mut previous_hash = String::new();
        for sequence in 1..MAX_BLOCKS {
            let mut next = event("validator-a", "device-1", sequence as u64, b"bounded");
            next.previous_event_hash = previous_hash;
            previous_hash = next.event_hash();
            ledger
                .append_event(next)
                .expect("capacity should allow the configured window");
        }

        let mut overflow = event("validator-a", "device-1", MAX_BLOCKS as u64, b"overflow");
        overflow.previous_event_hash = previous_hash;
        let error = ledger
            .append_event(overflow)
            .expect_err("ledger must fail closed at capacity");
        assert!(error.contains("bounded in-memory block capacity"));
        assert_eq!(ledger.blocks.len(), MAX_BLOCKS);
        assert!(ledger.verify().is_ok());
    }

    #[test]
    fn validator_set_enforces_permissioned_quorum() {
        let validators = ValidatorSet::new(["validator-a", "validator-b", "validator-c"]).unwrap();
        assert_eq!(validators.quorum(), 3);
        let checkpoint = MeshCheckpoint {
            height: 2,
            block_hash: "a".repeat(64),
            signatures: BTreeMap::from([
                ("validator-a".to_string(), "sig-a".to_string()),
                ("validator-b".to_string(), "sig-b".to_string()),
                ("validator-c".to_string(), "sig-c".to_string()),
            ]),
        };
        assert!(validators.validate_checkpoint(&checkpoint).is_ok());
    }
}
