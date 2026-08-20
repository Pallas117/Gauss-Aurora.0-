# Deterministic MHD boundary fixture

This is a bounded C++17 SIL/cFS seam for validating the data contract and front-end rendering. It is not a flight-certified MHD solver and does not issue commands.

```sh
cmake -S services/mhd-deterministic-cpp -B /tmp/gauss-mhd-build
cmake --build /tmp/gauss-mhd-build
ctest --test-dir /tmp/gauss-mhd-build --output-on-failure
/tmp/gauss-mhd-build/gauss-mhd-fixture --steps 4
```

The output is deterministic `gauss-mhd-fixture-v1` JSON with fixed-size field-line samples. Inputs and outputs are clamped so invalid numeric values cannot expand the state or produce non-finite geometry.
