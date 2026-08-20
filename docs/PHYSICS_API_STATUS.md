# Physics API status

## Historical scenarios

The replay contract is available at:

- `GET /api/physics/scenarios`
- `GET /api/physics/scenarios/:id`

The seven scenario records expose event context, Kp, duration, affected systems, provenance, and an explicit TID status. A `null` TID value means that a spacecraft-specific dose was not directly observed; it must not be inferred from Kp alone.

## Naoukin Eq. 4 BER model

The cited survey defines Eq. 4 as:

```text
BER = particle_flux × SEE_cross_section × sensitive_bit_count
```

The requested endpoint inputs (`total_ionising_dose_krad`, `temperature_C`, `frequency_hz`) do not identify those three quantities, and the paper does not supply a mapping or published reference cases for a TID/temperature/frequency model. Therefore Gauss must not emit a BER or a ±5% confidence interval from those inputs until the calibration dataset and parameter mapping are provided.

Required additions before S2-03 can be accepted:

1. Particle-flux-to-TID conversion and energy spectrum assumptions.
2. SEE cross-section calibration for the target component or technology.
3. Sensitive-bit population and operating-frequency relationship.
4. Published reference cases with expected BER values and uncertainty bounds.

Until then, radiation monitoring reports exposure screening and evidence state; it does not represent BER or component failure probability.
