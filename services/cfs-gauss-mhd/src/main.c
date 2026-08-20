#include "gauss_mhd_app.h"

#include <stdio.h>
#include <string.h>

static int run_self_test(void) {
    GaussMhdAppState_t state;
    GaussMhdTelemetry_t telemetry;
    GaussMhdSample_t sample = {
        .solar_wind_speed_km_s = 420.0f,
        .solar_wind_density_cm3 = 6.0f,
        .bz_nt = -4.5f,
        .dynamic_pressure_npa = 1.7f,
        .ram_pressure_npa = 1.7f,
        .magnetopause_re = 10.0f,
        .quality_mask = 0x01u,
        .ecc_corrected = 0u,
        .sequence = 7u};
    (void)memset(&telemetry, 0, sizeof telemetry);
    GAUSS_MHD_AppInit(&state);
    if (GAUSS_MHD_AppMainStep(&state, &sample, &telemetry) != GAUSS_MHD_OK) return 1;
    if (state.step != 1u || !GAUSS_MHD_IsBounded(&telemetry)) return 2;
    sample.solar_wind_speed_km_s = 1.0e9f;
    if (GAUSS_MHD_AppMainStep(&state, &sample, &telemetry) != GAUSS_MHD_OUT_OF_BOUNDS) return 3;
    sample.solar_wind_speed_km_s = 420.0f;
    sample.bz_nt = 0.0f / 0.0f;
    if (GAUSS_MHD_AppMainStep(&state, &sample, &telemetry) != GAUSS_MHD_NONFINITE) return 4;
    return 0;
}

int main(int argc, char **argv) {
    if (argc == 2 && strcmp(argv[1], "--self-test") == 0) {
        const int result = run_self_test();
        if (result == 0) puts("gauss-cfs-mhd self-test: PASS");
        return result;
    }
    fprintf(stderr, "usage: %s --self-test\n", argv[0]);
    return 2;
}
