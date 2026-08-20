#include "gauss_mhd_app.h"

#include <math.h>
#include <stddef.h>

static const float kFieldRadii[GAUSS_MHD_MAX_FIELDS] = {
    2.0f, 3.0f, 4.0f, 5.0f, 6.0f, 7.0f, 8.0f, 9.0f,
    10.0f, 11.0f, 12.0f, 13.0f, 14.0f, 15.0f, 16.0f, 17.0f};

static float clamp_float(float value, float low, float high) {
    if (value < low) return low;
    if (value > high) return high;
    return value;
}

static float safe_pressure(float speed, float density) {
    return clamp_float(1.6726e-6f * density * speed * speed, 0.0f, 1000.0f);
}

static int finite_sample(const GaussMhdSample_t *sample) {
    return sample != NULL && isfinite(sample->solar_wind_speed_km_s) &&
           isfinite(sample->solar_wind_density_cm3) && isfinite(sample->bz_nt) &&
           isfinite(sample->dynamic_pressure_npa) && isfinite(sample->ram_pressure_npa) &&
           isfinite(sample->magnetopause_re);
}

void GAUSS_MHD_AppInit(GaussMhdAppState_t *state) {
    if (state == NULL) return;
    state->step = 0u;
    state->sequence = 0u;
    state->initialized = 1u;
    state->faulted = 0u;
    state->corrected_words = 0u;
    state->rejected_samples = 0u;
}

GaussMhdStatus_t GAUSS_MHD_ProcessTelemetry(
    GaussMhdAppState_t *state,
    const GaussMhdSample_t *sample,
    GaussMhdTelemetry_t *output) {
    if (state == NULL || sample == NULL || output == NULL || state->initialized == 0u) {
        return GAUSS_MHD_INVALID_ARGUMENT;
    }
    if (!finite_sample(sample)) {
        state->rejected_samples++;
        output->quality_mask = 0u;
        return GAUSS_MHD_NONFINITE;
    }
    if (sample->solar_wind_speed_km_s < 0.0f || sample->solar_wind_speed_km_s > 2000.0f ||
        sample->solar_wind_density_cm3 < 0.0f || sample->solar_wind_density_cm3 > 1.0e5f ||
        sample->bz_nt < -5000.0f || sample->bz_nt > 5000.0f ||
        sample->magnetopause_re < 1.0f || sample->magnetopause_re > 100.0f) {
        state->rejected_samples++;
        output->quality_mask = 0u;
        return GAUSS_MHD_OUT_OF_BOUNDS;
    }

    output->step = state->step;
    output->field_count = GAUSS_MHD_MAX_FIELDS;
    output->quality_mask = sample->quality_mask;
    output->reserved = 0u;
    for (uint16_t i = 0u; i < GAUSS_MHD_MAX_FIELDS; ++i) {
        const float radius = kFieldRadii[i];
        const float tail = -radius * (1.0f + 0.02f * fabsf(sample->bz_nt));
        GaussMhdFieldSample_t *field = &output->field[i];
        field->radius_re = radius;
        field->x_re = tail;
        field->y_re = 0.05f * radius;
        field->z_re = 0.02f * sample->bz_nt;
        field->pressure_npa = clamp_float(safe_pressure(
            sample->solar_wind_speed_km_s, sample->solar_wind_density_cm3) /
            (1.0f + 0.03f * radius), 0.0f, 1000.0f);
        field->bz_nt = clamp_float(sample->bz_nt * expf(-0.05f * radius), -5000.0f, 5000.0f);
        field->quality_mask = sample->quality_mask;
        field->reserved[0] = 0u;
        field->reserved[1] = 0u;
        field->reserved[2] = 0u;
    }
    if (!GAUSS_MHD_IsBounded(output)) {
        state->faulted = 1u;
        state->rejected_samples++;
        output->quality_mask = 0u;
        return GAUSS_MHD_OUT_OF_BOUNDS;
    }
    state->sequence = sample->sequence;
    return GAUSS_MHD_OK;
}

GaussMhdStatus_t GAUSS_MHD_AppMainStep(
    GaussMhdAppState_t *state,
    const GaussMhdSample_t *sample,
    GaussMhdTelemetry_t *output) {
    if (state == NULL || state->step >= GAUSS_MHD_MAX_STEPS) {
        return GAUSS_MHD_OUT_OF_BOUNDS;
    }
    const GaussMhdStatus_t status = GAUSS_MHD_ProcessTelemetry(state, sample, output);
    if (status == GAUSS_MHD_OK) state->step++;
    return status;
}

int GAUSS_MHD_IsBounded(const GaussMhdTelemetry_t *telemetry) {
    if (telemetry == NULL || telemetry->field_count != GAUSS_MHD_MAX_FIELDS) return 0;
    for (uint16_t i = 0u; i < telemetry->field_count; ++i) {
        const GaussMhdFieldSample_t *field = &telemetry->field[i];
        if (!isfinite(field->radius_re) || !isfinite(field->x_re) || !isfinite(field->y_re) ||
            !isfinite(field->z_re) || !isfinite(field->pressure_npa) || !isfinite(field->bz_nt) ||
            field->radius_re < 2.0f || field->radius_re > 17.0f ||
            field->pressure_npa < 0.0f || field->pressure_npa > 1000.0f ||
            field->bz_nt < -5000.0f || field->bz_nt > 5000.0f) {
            return 0;
        }
    }
    return 1;
}
