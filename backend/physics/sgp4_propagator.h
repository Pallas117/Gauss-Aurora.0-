#pragma once
#include <string>
#include <vector>
#include <ctime>

namespace gauss::physics {

struct TLE {
    std::string norad_id;
    std::string name;
    std::string line1;   // TLE line 1 (69 chars)
    std::string line2;   // TLE line 2 (69 chars)
    double epoch_jd;     // Julian date of epoch
};

struct StateVector {
    double x_km, y_km, z_km;         // ECI position (km)
    double vx_kms, vy_kms, vz_kms;  // ECI velocity (km/s)
    double lat_deg, lon_deg, alt_km; // Geodetic position
    double time_unix;
};

struct ConjunctionEvent {
    std::string primary_norad;
    std::string secondary_norad;
    double tca_unix;           // Time of Closest Approach (Unix)
    double miss_distance_km;
    double probability;        // Pc (collision probability, Foster method)
    double relative_velocity_kms;
    bool   requires_action;    // true if Pc > 1e-5
};

struct PassWindow {
    std::string ground_station_id;
    double aos_unix;   // Acquisition of Signal
    double los_unix;   // Loss of Signal
    double max_el_deg; // Max elevation during pass
    double duration_s;
};

class SGP4Propagator {
public:
    // Propagate TLE to given time
    // Returns ECI state vector and geodetic position
    static StateVector propagate(const TLE& tle, double time_unix);

    // Calculate all passes over a ground station in a time window
    static std::vector<PassWindow> calc_passes(
        const TLE& tle,
        double lat_deg, double lon_deg, double alt_m,
        double start_unix, double end_unix,
        double min_elevation_deg = 5.0
    );

    // Screen two TLEs for conjunction in a time window
    // Returns events where miss distance < threshold_km
    static std::vector<ConjunctionEvent> screen_conjunction(
        const TLE& primary,
        const TLE& secondary,
        double start_unix, double end_unix,
        double threshold_km = 1.0
    );

    // Batch conjunction screen: primary vs many secondaries
    // This is the SDA-scale operation
    static std::vector<ConjunctionEvent> screen_catalog(
        const TLE& primary,
        const std::vector<TLE>& catalog,
        double start_unix, double end_unix,
        double threshold_km = 5.0,
        int n_threads = 4
    );
};

// Generate CCSDS 508.0-B-1 CDM (Conjunction Data Message)
// Returns CDM as KVN-format string ready for SDA submission
std::string generate_cdm(
    const ConjunctionEvent& event,
    const StateVector& primary_state,
    const StateVector& secondary_state,
    const std::string& originator = "GAUSS-AURORA"
);

} // namespace gauss::physics
