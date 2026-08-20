//! Physics validation for canonical space-weather packets.
//! Bounds aligned with backend/physics/mhd-nowcast.ts (speed 250–2000 km/s, density 0.01–1000, Bz ±100 nT).

use serde_json::Value;

use crate::telemetry::MappedCanonicalPacket;

/// Bounds for solar wind speed (km/s).
const SPEED_MIN: f64 = 250.0;
const SPEED_MAX: f64 = 2000.0;

/// Bounds for density (cm⁻³).
const DENSITY_MIN: f64 = 0.01;
const DENSITY_MAX: f64 = 1000.0;

/// Bounds for Bz (nT).
const BZ_MIN: f64 = -100.0;
const BZ_MAX: f64 = 100.0;

/// Result of physics validation: adjusted packets and counts.
pub struct PhysicsValidationResult {
    pub packets: Vec<MappedCanonicalPacket>,
    pub adjusted_count: usize,
    pub rejected_count: usize,
}

fn clamp_value(v: f64, min_v: f64, max_v: f64) -> f64 {
    if v.is_nan() || v.is_infinite() {
        return min_v;
    }
    if v < min_v {
        min_v
    } else if v > max_v {
        max_v
    } else {
        v
    }
}

/// Validate and optionally clamp canonical_point fields. Drops packets that cannot be normalized.
pub fn validate_and_clamp(
    packets: Vec<MappedCanonicalPacket>,
    clamp: bool,
) -> PhysicsValidationResult {
    let mut out = Vec::with_capacity(packets.len());
    let mut adjusted_count = 0usize;
    let mut rejected_count = 0usize;

    for mut pkt in packets {
        let (speed_opt, density_opt, bz_opt) = match pkt.canonical_point.as_object_mut() {
            Some(canonical) => (
                canonical
                    .get("solarWind")
                    .and_then(|v| v.get("speed"))
                    .and_then(|v| v.as_f64()),
                canonical
                    .get("solarWind")
                    .and_then(|v| v.get("density"))
                    .and_then(|v| v.as_f64()),
                canonical
                    .get("magneticField")
                    .and_then(|v| v.get("z"))
                    .and_then(|v| v.as_f64()),
            ),
            None => {
                rejected_count += 1;
                continue;
            }
        };

        let mut speed = speed_opt.unwrap_or(400.0);
        let mut density = density_opt.unwrap_or(5.0);
        let mut bz = bz_opt.unwrap_or(0.0);

        let oob = !(SPEED_MIN..=SPEED_MAX).contains(&speed)
            || !(DENSITY_MIN..=DENSITY_MAX).contains(&density)
            || !(BZ_MIN..=BZ_MAX).contains(&bz)
            || !speed.is_finite()
            || !density.is_finite()
            || !bz.is_finite();

        if !clamp && oob {
            rejected_count += 1;
            continue;
        }

        let orig_speed = speed;
        let orig_density = density;
        let orig_bz = bz;

        speed = clamp_value(speed, SPEED_MIN, SPEED_MAX);
        density = clamp_value(density, DENSITY_MIN, DENSITY_MAX);
        bz = clamp_value(bz, BZ_MIN, BZ_MAX);

        if clamp && (speed != orig_speed || density != orig_density || bz != orig_bz) {
            adjusted_count += 1;
        }

        if let Some(sw) = pkt
            .canonical_point
            .get_mut("solarWind")
            .and_then(Value::as_object_mut)
        {
            sw.insert("speed".to_string(), Value::from(speed));
            sw.insert("density".to_string(), Value::from(density));
        }
        if let Some(mf) = pkt
            .canonical_point
            .get_mut("magneticField")
            .and_then(Value::as_object_mut)
        {
            mf.insert("z".to_string(), Value::from(bz));
        }

        if oob && clamp {
            if let Some(q) = pkt.quality_flags.as_object_mut() {
                q.insert("physics_out_of_range".to_string(), Value::from(true));
            }
        }

        out.push(pkt);
    }

    PhysicsValidationResult {
        packets: out,
        adjusted_count,
        rejected_count,
    }
}

/// Compute mean and population standard deviation for a slice of f64 (returns (mean, sigma); sigma 0 if len < 2).
fn mean_sigma(values: &[f64]) -> (f64, f64) {
    let n = values.len();
    if n == 0 {
        return (0.0, 0.0);
    }
    let sum: f64 = values.iter().sum();
    let mean = sum / (n as f64);
    if n < 2 {
        return (mean, 0.0);
    }
    let var = values
        .iter()
        .map(|x| {
            let d = x - mean;
            d * d
        })
        .sum::<f64>()
        / (n as f64);
    let sigma = var.sqrt();
    (mean, sigma)
}

/// Apply 3-sigma filter: drop or flag packets whose speed, density, or Bz is beyond 3 sigma from batch mean.
/// Uses a rolling window of at most SIGMA_WINDOW packets for stats. Returns (filtered_packets, flagged_count).
pub fn apply_sigma_filter(
    packets: Vec<MappedCanonicalPacket>,
    reject_beyond_sigma: bool,
    window_max: usize,
) -> (Vec<MappedCanonicalPacket>, usize) {
    if packets.is_empty() {
        return (packets, 0);
    }
    let window_max = window_max.max(4);
    let window = packets.len().min(window_max);
    let mut speed_vals = Vec::with_capacity(window);
    let mut density_vals = Vec::with_capacity(window);
    let mut bz_vals = Vec::with_capacity(window);
    for p in packets.iter().take(window) {
        let sw = p.canonical_point.get("solarWind");
        let mf = p.canonical_point.get("magneticField");
        speed_vals.push(
            sw.and_then(|o| o.get("speed"))
                .and_then(|v| v.as_f64())
                .unwrap_or(400.0),
        );
        density_vals.push(
            sw.and_then(|o| o.get("density"))
                .and_then(|v| v.as_f64())
                .unwrap_or(5.0),
        );
        bz_vals.push(
            mf.and_then(|o| o.get("z"))
                .and_then(|v| v.as_f64())
                .unwrap_or(0.0),
        );
    }

    let (speed_mean, speed_sigma) = mean_sigma(&speed_vals);
    let (density_mean, density_sigma) = mean_sigma(&density_vals);
    let (bz_mean, bz_sigma) = mean_sigma(&bz_vals);

    let sigma_min = 1e-6;
    let speed_sigma = speed_sigma.max(sigma_min);
    let density_sigma = density_sigma.max(sigma_min);
    let bz_sigma = bz_sigma.max(sigma_min);

    let mut out = Vec::with_capacity(packets.len());
    let mut flagged = 0usize;
    for mut pkt in packets {
        let sw = pkt.canonical_point.get("solarWind");
        let mf = pkt.canonical_point.get("magneticField");
        let speed = sw
            .and_then(|o| o.get("speed"))
            .and_then(|v| v.as_f64())
            .unwrap_or(400.0);
        let density = sw
            .and_then(|o| o.get("density"))
            .and_then(|v| v.as_f64())
            .unwrap_or(5.0);
        let bz = mf
            .and_then(|o| o.get("z"))
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0);

        let speed_oob = (speed - speed_mean).abs() > 3.0 * speed_sigma;
        let density_oob = (density - density_mean).abs() > 3.0 * density_sigma;
        let bz_oob = (bz - bz_mean).abs() > 3.0 * bz_sigma;
        let anomaly = speed_oob || density_oob || bz_oob;

        if anomaly {
            flagged += 1;
            if reject_beyond_sigma {
                continue;
            }
            if let Some(q) = pkt.quality_flags.as_object_mut() {
                q.insert("sigma_flagged".to_string(), Value::from(true));
            }
        }
        out.push(pkt);
    }
    (out, flagged)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn mk_packet(speed: f64, density: f64, bz: f64) -> MappedCanonicalPacket {
        MappedCanonicalPacket {
            timestamp: "2025-01-01T00:00:00Z".to_string(),
            apid: 0,
            seq_count: 0,
            payload_hex: String::new(),
            canonical_point: json!({
                "timestamp": "2025-01-01T00:00:00Z",
                "solarWind": { "speed": speed, "density": density },
                "magneticField": { "z": bz }
            }),
            quality_flags: json!({}),
            uncertainty: json!({}),
        }
    }

    #[test]
    fn in_bounds_passthrough() {
        let p = mk_packet(400.0, 5.0, -5.0);
        let r = validate_and_clamp(vec![p], true);
        assert_eq!(r.packets.len(), 1);
        assert_eq!(r.adjusted_count, 0);
        assert_eq!(r.rejected_count, 0);
    }

    #[test]
    fn clamp_out_of_range() {
        let p = mk_packet(5000.0, 0.001, -200.0);
        let r = validate_and_clamp(vec![p], true);
        assert_eq!(r.packets.len(), 1);
        assert_eq!(r.adjusted_count, 1);
        assert_eq!(r.rejected_count, 0);
        let cp = &r.packets[0].canonical_point;
        assert_eq!(cp["solarWind"]["speed"].as_f64().unwrap(), SPEED_MAX);
        assert_eq!(cp["solarWind"]["density"].as_f64().unwrap(), DENSITY_MIN);
        assert_eq!(cp["magneticField"]["z"].as_f64().unwrap(), BZ_MIN);
    }

    #[test]
    fn reject_when_no_clamp() {
        let p = mk_packet(5000.0, 5.0, 5.0);
        let r = validate_and_clamp(vec![p], false);
        assert_eq!(r.packets.len(), 0);
        assert_eq!(r.rejected_count, 1);
    }

    #[test]
    fn sigma_filter_drops_outlier() {
        let in_bounds: Vec<_> = (0..10)
            .map(|i| mk_packet(400.0 + f64::from(i), 5.0, 0.0))
            .collect();
        let mut packets = in_bounds.clone();
        packets.push(mk_packet(5000.0, 5.0, 0.0)); // 3-sigma outlier in speed
        let (filtered, flagged) = apply_sigma_filter(packets, true, 64);
        assert_eq!(filtered.len(), 10);
        assert_eq!(flagged, 1);
    }
}
