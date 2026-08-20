#include "gauss_mhd_fixture.hpp"

#include <cstdlib>
#include <cstdio>
#include <cstring>
#include <string_view>

namespace {

gauss::mhd::Input input_for(std::uint32_t sample) {
  return {
      2.0F + static_cast<float>(sample % 5U) * 0.2F,
      -4.0F - static_cast<float>(sample % 3U),
      5.0F + static_cast<float>(sample % 4U),
      sample,
  };
}

bool same_frame(const gauss::mhd::Frame& left, const gauss::mhd::Frame& right) {
  return std::memcmp(&left, &right, sizeof(left)) == 0;
}

int self_test() {
  const auto first = gauss::mhd::step(input_for(7U));
  const auto second = gauss::mhd::step(input_for(7U));
  if (!same_frame(first, second) || !gauss::mhd::is_finite_and_bounded(first)) {
    std::fprintf(stderr, "gauss-mhd-fixture self-test failed\n");
    return 1;
  }
  std::printf("gauss-mhd-fixture self-test: PASS schema=%s\n", gauss::mhd::kSchema);
  return 0;
}

std::uint32_t bounded_steps(int argc, char** argv) {
  for (int index = 1; index + 1 < argc; ++index) {
    if (std::string_view(argv[index]) == "--steps") {
      const int parsed = std::atoi(argv[index + 1]);
      if (parsed > 0 && parsed <= 64) return static_cast<std::uint32_t>(parsed);
    }
  }
  return 8U;
}

void emit_frame(const gauss::mhd::Frame& frame, bool last) {
  std::printf(
      "{\"sampleIndex\":%u,\"pressureNormalized\":%.6f,\"standOffRe\":%.6f,"
      "\"tailLengthRe\":%.6f,\"reconnection\":%.6f,\"beltIntensity\":%.6f,"
      "\"fieldLineRadiiRe\":[",
      frame.sample_index, frame.pressure_normalized, frame.stand_off_re,
      frame.tail_length_re, frame.reconnection, frame.belt_intensity);
  for (std::size_t index = 0; index < gauss::mhd::kFieldLineSamples; ++index) {
    std::printf("%.6f%s", frame.field_line_radii_re[index], index + 1 == gauss::mhd::kFieldLineSamples ? "" : ",");
  }
  std::printf("]}%s\n", last ? "" : ",");
}

}  // namespace

int main(int argc, char** argv) {
  for (int index = 1; index < argc; ++index) {
    if (std::string_view(argv[index]) == "--self-test") return self_test();
  }

  const auto steps = bounded_steps(argc, argv);
  std::printf("{\"schema\":\"%s\",\"units\":{\"distance\":\"Re\",\"pressure\":\"nPa\"},\"frames\":[\n", gauss::mhd::kSchema);
  for (std::uint32_t index = 0; index < steps; ++index) {
    emit_frame(gauss::mhd::step(input_for(index)), index + 1 == steps);
  }
  std::printf("]}\n");
  return 0;
}
