#include "gauss_mhd_fixture.hpp"

#include <algorithm>
#include <cmath>

namespace gauss::mhd {
namespace {

float clamp(float value, float low, float high) {
  return std::min(high, std::max(low, value));
}

float finite_or(float value, float fallback) {
  return std::isfinite(value) ? value : fallback;
}

}  // namespace

Frame step(const Input& input) {
  const float pressure = clamp(finite_or(input.dynamic_pressure_npa, 2.0F), 0.05F, 100.0F);
  const float bz = clamp(finite_or(input.imf_bz_nt, 0.0F), -100.0F, 100.0F);
  const float density = clamp(finite_or(input.proton_density_cm3, 5.0F), 0.0F, 1000.0F);
  const float pressure_normalized = clamp(pressure / 10.0F, 0.0F, 1.0F);

  // Shue-like pressure scaling is used only as a stable visual/contract
  // baseline. The production physics model remains an explicit replacement.
  const float stand_off = clamp(10.2F * std::pow(pressure, -1.0F / 6.0F), 5.0F, 15.0F);
  const float reconnection = clamp(-bz / 15.0F, 0.0F, 1.0F);
  const float belt_intensity = clamp(0.15F + density / 100.0F + reconnection * 0.35F, 0.0F, 1.0F);
  const float tail_length = clamp(24.0F + pressure_normalized * 18.0F + reconnection * 18.0F, 20.0F, 64.0F);

  Frame frame{
      input.sample_index,
      pressure_normalized,
      stand_off,
      tail_length,
      reconnection,
      belt_intensity,
      {},
  };

  for (std::size_t index = 0; index < kFieldLineSamples; ++index) {
    const float phase = static_cast<float>(index) / static_cast<float>(kFieldLineSamples - 1);
    const float latitude = -1.57079632679F + phase * 3.14159265359F;
    const float dayside_factor = 0.72F + 0.28F * std::cos(latitude) * std::cos(latitude);
    frame.field_line_radii_re[index] = clamp(stand_off * dayside_factor, 3.5F, 15.0F);
  }

  return frame;
}

bool is_finite_and_bounded(const Frame& frame) {
  if (frame.pressure_normalized < 0.0F || frame.pressure_normalized > 1.0F ||
      frame.stand_off_re < 5.0F || frame.stand_off_re > 15.0F ||
      frame.tail_length_re < 20.0F || frame.tail_length_re > 64.0F ||
      frame.reconnection < 0.0F || frame.reconnection > 1.0F ||
      frame.belt_intensity < 0.0F || frame.belt_intensity > 1.0F) {
    return false;
  }
  for (const float radius : frame.field_line_radii_re) {
    if (!std::isfinite(radius) || radius < 3.5F || radius > 15.0F) return false;
  }
  return true;
}

}  // namespace gauss::mhd
