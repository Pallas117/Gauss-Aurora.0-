#pragma once

#include <array>
#include <cstddef>
#include <cstdint>

namespace gauss::mhd {

inline constexpr const char* kSchema = "gauss-mhd-fixture-v1";
inline constexpr std::size_t kFieldLineSamples = 16;
inline constexpr float kEarthRadiusKm = 6371.0F;

struct Input {
  float dynamic_pressure_npa;
  float imf_bz_nt;
  float proton_density_cm3;
  std::uint32_t sample_index;
};

struct Frame {
  std::uint32_t sample_index;
  float pressure_normalized;
  float stand_off_re;
  float tail_length_re;
  float reconnection;
  float belt_intensity;
  std::array<float, kFieldLineSamples> field_line_radii_re;
};

// A bounded verification model, not a flight-certified MHD solver. It keeps
// the safety-path seam deterministic and cheap enough for SIL/cFS integration.
Frame step(const Input& input);

bool is_finite_and_bounded(const Frame& frame);

}  // namespace gauss::mhd
