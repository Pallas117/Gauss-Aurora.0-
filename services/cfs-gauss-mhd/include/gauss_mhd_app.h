#ifndef GAUSS_MHD_APP_H
#define GAUSS_MHD_APP_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/*
 * cFS-shaped, host-buildable application boundary.
 *
 * The production adapter maps these lifecycle and message functions to
 * cFE/CFS APIs. This library intentionally has no cFS dependency so its
 * deterministic behavior can be tested in a small software-in-the-loop build.
 */
#define GAUSS_MHD_APP_NAME "GAUSS_MHD"
#define GAUSS_MHD_SCHEMA "gauss-mhd-fixture-v1"
#define GAUSS_MHD_MAX_FIELDS 16u
#define GAUSS_MHD_MAX_STEPS 64u

typedef enum {
    GAUSS_MHD_OK = 0,
    GAUSS_MHD_INVALID_ARGUMENT = 1,
    GAUSS_MHD_OUT_OF_BOUNDS = 2,
    GAUSS_MHD_NONFINITE = 3,
    GAUSS_MHD_ECC_UNCORRECTABLE = 4
} GaussMhdStatus_t;

typedef struct {
    float solar_wind_speed_km_s;
    float solar_wind_density_cm3;
    float bz_nt;
    float dynamic_pressure_npa;
    float ram_pressure_npa;
    float magnetopause_re;
    uint8_t quality_mask;
    uint8_t ecc_corrected;
    uint16_t sequence;
} GaussMhdSample_t;

typedef struct {
    float radius_re;
    float x_re;
    float y_re;
    float z_re;
    float pressure_npa;
    float bz_nt;
    uint8_t quality_mask;
    uint8_t reserved[3];
} GaussMhdFieldSample_t;

typedef struct {
    uint32_t step;
    uint16_t field_count;
    uint8_t quality_mask;
    uint8_t reserved;
    GaussMhdFieldSample_t field[GAUSS_MHD_MAX_FIELDS];
} GaussMhdTelemetry_t;

typedef struct {
    uint32_t step;
    uint16_t sequence;
    uint8_t initialized;
    uint8_t faulted;
    uint32_t corrected_words;
    uint32_t rejected_samples;
} GaussMhdAppState_t;

void GAUSS_MHD_AppInit(GaussMhdAppState_t *state);
GaussMhdStatus_t GAUSS_MHD_ProcessTelemetry(
    GaussMhdAppState_t *state,
    const GaussMhdSample_t *sample,
    GaussMhdTelemetry_t *output);
GaussMhdStatus_t GAUSS_MHD_AppMainStep(
    GaussMhdAppState_t *state,
    const GaussMhdSample_t *sample,
    GaussMhdTelemetry_t *output);
int GAUSS_MHD_IsBounded(const GaussMhdTelemetry_t *telemetry);

#ifdef __cplusplus
}
#endif

#endif
