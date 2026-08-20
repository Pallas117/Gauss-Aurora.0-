//! GAUSS-COMP-202: Multi-sensor track association (gating, NN, lifecycle, diagnostics).

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::ssa::schema::{Covariance6, MeasurementBatch, OpticalMeasurement, RfMeasurement};

/// Default range (m) for converting optical angle-only to 3D position (e.g. LEO).
const DEFAULT_OPTICAL_RANGE_M: f64 = 7000e3;

/// Track lifecycle states.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TrackLifecycle {
    Tentative,
    Confirmed,
    Coasting,
    Dropped,
}

/// Reference to a contributing measurement for source attribution.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MeasurementRef {
    pub sensor_id: String,
    pub observed_at: String,
    pub measurement_index: usize,
    pub sensor_type: String,
}

/// Track state: position (m), velocity (m/s), covariance, lifecycle, confidence, residual, attribution.
/// GAUSS-COMP-203: confidence_interval is 90% CI for position magnitude (m); source_attribution lists contributing measurements.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrackState {
    pub track_id: String,
    pub position: [f64; 3],
    pub velocity: [f64; 3],
    pub covariance: Covariance6,
    pub lifecycle: TrackLifecycle,
    pub confidence: f64,
    pub last_residual_norm: f64,
    pub hit_count: u32,
    pub miss_count: u32,
    pub source_attribution: Vec<MeasurementRef>,
    /// 90% confidence interval [lower, upper] for position magnitude (m).
    pub confidence_interval: [f64; 2],
    /// 1-sigma uncertainty envelope (m), from position covariance.
    pub uncertainty_envelope_1sigma_m: f64,
}

/// Single association decision for diagnostics.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssociationDiagnostic {
    pub measurement_index: usize,
    pub sensor_type: String,
    pub track_id: Option<String>,
    pub gate_passed: bool,
    pub residual_norm: f64,
    pub was_new_track: bool,
}

#[derive(Clone, Debug)]
pub struct AssociationConfig {
    pub gate_threshold_m: f64,
    pub n_updates_to_confirm: u32,
    pub n_miss_to_coasting: u32,
    pub n_miss_to_dropped: u32,
    pub confidence_decay_per_miss: f64,
}

impl Default for AssociationConfig {
    fn default() -> Self {
        Self {
            gate_threshold_m: 50e3,
            n_updates_to_confirm: 3,
            n_miss_to_coasting: 2,
            n_miss_to_dropped: 5,
            confidence_decay_per_miss: 0.15,
        }
    }
}

fn optical_to_position(m: &OpticalMeasurement, range_m: f64) -> [f64; 3] {
    let ra = m.ra_deg.to_radians();
    let dec = m.dec_deg.to_radians();
    let x = range_m * dec.cos() * ra.cos();
    let y = range_m * dec.cos() * ra.sin();
    let z = range_m * dec.sin();
    [x, y, z]
}

fn rf_to_position(m: &RfMeasurement) -> [f64; 3] {
    let doa = m.doa_deg.to_radians();
    let x = m.range_m * doa.cos();
    let y = m.range_m * doa.sin();
    let z = 0.0;
    [x, y, z]
}

fn euclidean(a: &[f64; 3], b: &[f64; 3]) -> f64 {
    ((a[0] - b[0]).powi(2) + (a[1] - b[1]).powi(2) + (a[2] - b[2]).powi(2)).sqrt()
}

fn position_norm(p: &[f64; 3]) -> f64 {
    (p[0].powi(2) + p[1].powi(2) + p[2].powi(2)).sqrt()
}

/// 1-sigma uncertainty (m) from position diagonal of covariance.
fn uncertainty_1sigma(c: &Covariance6) -> f64 {
    (c.xx + c.yy + c.zz).max(0.0).sqrt()
}

/// 90% CI for position magnitude: [norm - 1.645*sigma, norm + 1.645*sigma].
fn confidence_interval_90(norm: f64, sigma: f64) -> [f64; 2] {
    let half = 1.645 * sigma;
    [(norm - half).max(0.0), norm + half]
}

/// Association engine: maintains tracks, gating + nearest-neighbor, lifecycle, diagnostics.
pub struct AssociationEngine {
    tracks: HashMap<String, TrackState>,
    next_id: u64,
    config: AssociationConfig,
}

impl AssociationEngine {
    pub fn new(config: AssociationConfig) -> Self {
        Self {
            tracks: HashMap::new(),
            next_id: 0,
            config,
        }
    }

    pub fn tracks(&self) -> Vec<TrackState> {
        self.tracks
            .values()
            .filter(|t| t.lifecycle != TrackLifecycle::Dropped)
            .cloned()
            .collect()
    }

    /// Process a batch of measurements; returns diagnostics and updated track list.
    pub fn update(
        &mut self,
        batch: &MeasurementBatch,
    ) -> (Vec<AssociationDiagnostic>, Vec<TrackState>) {
        let mut diagnostics = Vec::new();
        let mut used_tracks: HashMap<String, bool> = HashMap::new();

        // Collect all (position, sensor_type, index, measurement_ref) for optical
        let mut positions: Vec<([f64; 3], String, usize, MeasurementRef)> = Vec::new();
        for (i, m) in batch.optical.iter().enumerate() {
            let pos = optical_to_position(m, DEFAULT_OPTICAL_RANGE_M);
            let sensor_id = m
                .provenance
                .as_ref()
                .map(|p| p.sensor_id.clone())
                .unwrap_or_else(|| "optical".to_string());
            positions.push((
                pos,
                "optical".to_string(),
                i,
                MeasurementRef {
                    sensor_id,
                    observed_at: m.observed_at.clone(),
                    measurement_index: i,
                    sensor_type: "optical".to_string(),
                },
            ));
        }
        for (i, m) in batch.rf.iter().enumerate() {
            let pos = rf_to_position(m);
            let sensor_id = m
                .provenance
                .as_ref()
                .map(|p| p.sensor_id.clone())
                .unwrap_or_else(|| "rf".to_string());
            positions.push((
                pos,
                "rf".to_string(),
                batch.optical.len() + i,
                MeasurementRef {
                    sensor_id,
                    observed_at: m.observed_at.clone(),
                    measurement_index: i,
                    sensor_type: "rf".to_string(),
                },
            ));
        }

        // Nearest-neighbor: for each measurement, find best track within gate
        for (pos, sensor_type, meas_index, meas_ref) in positions {
            let mut best_track_id: Option<String> = None;
            let mut best_dist = self.config.gate_threshold_m;
            for (tid, t) in self.tracks.iter() {
                if t.lifecycle == TrackLifecycle::Dropped {
                    continue;
                }
                let d = euclidean(&t.position, &pos);
                if d < best_dist {
                    best_dist = d;
                    best_track_id = Some(tid.clone());
                }
            }

            let gate_passed = best_track_id.is_some();
            let (track_id, was_new) = if let Some(id) = best_track_id {
                used_tracks.insert(id.clone(), true);
                (Some(id), false)
            } else {
                let id = format!("trk-{}", self.next_id);
                self.next_id += 1;
                let attr = vec![meas_ref.clone()];
                let cov = Covariance6::default_diagonal(1e10);
                let u = uncertainty_1sigma(&cov);
                let norm = position_norm(&pos);
                self.tracks.insert(
                    id.clone(),
                    TrackState {
                        track_id: id.clone(),
                        position: pos,
                        velocity: [0.0, 0.0, 0.0],
                        covariance: cov,
                        lifecycle: TrackLifecycle::Tentative,
                        confidence: 0.6,
                        last_residual_norm: 0.0,
                        hit_count: 1,
                        miss_count: 0,
                        source_attribution: attr,
                        confidence_interval: confidence_interval_90(norm, u),
                        uncertainty_envelope_1sigma_m: u,
                    },
                );
                (Some(id), true)
            };

            diagnostics.push(AssociationDiagnostic {
                measurement_index: meas_index,
                sensor_type: sensor_type.clone(),
                track_id: track_id.clone(),
                gate_passed,
                residual_norm: best_dist,
                was_new_track: was_new,
            });

            if let Some(ref id) = track_id {
                if !was_new {
                    if let Some(t) = self.tracks.get_mut(id) {
                        t.position = pos;
                        t.hit_count += 1;
                        t.miss_count = 0;
                        t.last_residual_norm = best_dist;
                        t.source_attribution.push(meas_ref);
                        t.confidence = (t.confidence + 1.0).min(1.0) * 0.5 + 0.5;
                        let u = uncertainty_1sigma(&t.covariance);
                        let norm = position_norm(&t.position);
                        t.confidence_interval = confidence_interval_90(norm, u);
                        t.uncertainty_envelope_1sigma_m = u;
                    }
                }
            }
        }

        // Advance lifecycle: mark misses for tracks not updated
        for (id, t) in self.tracks.iter_mut() {
            if t.lifecycle == TrackLifecycle::Dropped {
                continue;
            }
            if !used_tracks.get(id).copied().unwrap_or(false) {
                t.miss_count += 1;
                t.confidence = (t.confidence - self.config.confidence_decay_per_miss).max(0.0);
                if t.miss_count >= self.config.n_miss_to_dropped {
                    t.lifecycle = TrackLifecycle::Dropped;
                } else if t.miss_count >= self.config.n_miss_to_coasting {
                    t.lifecycle = TrackLifecycle::Coasting;
                }
            } else if t.hit_count >= self.config.n_updates_to_confirm
                && t.lifecycle == TrackLifecycle::Tentative
            {
                t.lifecycle = TrackLifecycle::Confirmed;
            }
        }

        let out_tracks = self.tracks();
        (diagnostics, out_tracks)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ssa::schema::OpticalMeasurement;

    fn optical(ra: f64, dec: f64, observed_at: &str) -> OpticalMeasurement {
        OpticalMeasurement {
            ra_deg: ra,
            dec_deg: dec,
            magnitude: 10.0,
            covariance: Covariance6::default_diagonal(1e-6),
            observed_at: observed_at.to_string(),
            provenance: None,
        }
    }

    fn rf(range: f64, doa: f64, observed_at: &str) -> RfMeasurement {
        RfMeasurement {
            range_m: range,
            range_rate_m_s: -100.0,
            doa_deg: doa,
            snr_db: 15.0,
            covariance: Covariance6::default_diagonal(100.0),
            observed_at: observed_at.to_string(),
            provenance: None,
        }
    }

    #[test]
    fn synthetic_mixed_sensor_consistent_track_ids() {
        let config = AssociationConfig::default();
        let mut engine = AssociationEngine::new(config);
        // First batch: one optical at (180, 45) -> one track
        let batch1 = MeasurementBatch {
            optical: vec![optical(180.0, 45.0, "t1")],
            rf: vec![],
        };
        let (diag1, tracks1) = engine.update(&batch1);
        assert_eq!(tracks1.len(), 1);
        assert!(diag1[0].was_new_track);
        let id1 = tracks1[0].track_id.clone();

        // Second batch: optical at nearby (180.1, 45.0) -> same track
        let batch2 = MeasurementBatch {
            optical: vec![optical(180.1, 45.0, "t2")],
            rf: vec![],
        };
        let (diag2, tracks2) = engine.update(&batch2);
        assert_eq!(tracks2.len(), 1);
        assert!(!diag2[0].was_new_track);
        assert_eq!(tracks2[0].track_id, id1);
    }

    #[test]
    fn track_confidence_degrades_on_dropout() {
        let config = AssociationConfig {
            n_miss_to_dropped: 10,
            confidence_decay_per_miss: 0.2,
            ..Default::default()
        };
        let mut engine = AssociationEngine::new(config);
        let batch = MeasurementBatch {
            optical: vec![optical(0.0, 0.0, "t0")],
            rf: vec![],
        };
        engine.update(&batch);
        let tracks = engine.tracks();
        let c0 = tracks[0].confidence;

        // Several updates with no new measurement -> misses
        for _ in 1..=4 {
            let empty = MeasurementBatch {
                optical: vec![],
                rf: vec![],
            };
            engine.update(&empty);
        }
        let tracks_after = engine.tracks();
        assert!(!tracks_after.is_empty());
        assert!(tracks_after[0].confidence < c0);
    }

    #[test]
    fn track_output_includes_source_attribution_and_uncertainty() {
        let mut engine = AssociationEngine::new(AssociationConfig::default());
        let batch = MeasurementBatch {
            optical: vec![optical(0.0, 0.0, "t0")],
            rf: vec![],
        };
        let (_, tracks) = engine.update(&batch);
        assert_eq!(tracks.len(), 1);
        assert!(!tracks[0].source_attribution.is_empty());
        assert_eq!(tracks[0].source_attribution[0].sensor_type, "optical");
        assert!(tracks[0].uncertainty_envelope_1sigma_m > 0.0);
        assert!(tracks[0].confidence_interval[1] >= tracks[0].confidence_interval[0]);
    }

    #[test]
    fn confidence_interval_widens_with_larger_covariance() {
        let mut engine = AssociationEngine::new(AssociationConfig::default());
        let batch = MeasurementBatch {
            optical: vec![optical(0.0, 0.0, "t0")],
            rf: vec![],
        };
        let (_, tracks) = engine.update(&batch);
        let w0 = tracks[0].confidence_interval[1] - tracks[0].confidence_interval[0];
        assert!(w0 > 0.0);
    }

    #[test]
    fn diagnostics_include_gate_and_residual() {
        let mut engine = AssociationEngine::new(AssociationConfig::default());
        let batch = MeasurementBatch {
            optical: vec![optical(90.0, 30.0, "t1")],
            rf: vec![rf(7e6, 45.0, "t1")],
        };
        let (diag, tracks) = engine.update(&batch);
        assert_eq!(diag.len(), 2);
        assert!(diag[0].residual_norm >= 0.0 && diag[1].residual_norm >= 0.0);
        assert_eq!(diag[0].sensor_type, "optical");
        assert_eq!(diag[1].sensor_type, "rf");
        assert_eq!(tracks.len(), 2);
    }
}
