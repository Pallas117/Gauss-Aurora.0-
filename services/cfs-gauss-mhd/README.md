# Gauss cFS MHD application boundary

This is a small C11, fixed-memory software-in-the-loop boundary shaped for a
NASA cFS application. It is intentionally buildable without the cFS SDK so the
deterministic safety behavior can be tested on a developer machine.

It is not the cFS flight application yet. The target adapter still has to map:

- `GAUSS_MHD_AppInit` to the cFE application initialization path;
- `GAUSS_MHD_AppMainStep` to the cFE task loop and scheduler/message callback;
- `GaussMhdSample_t` to a cFE Software Bus telemetry message;
- `GaussMhdTelemetry_t` to a versioned cFS telemetry packet;
- rejected input and `faulted` state to EVS events and command inhibition.

Build and test the host SIL boundary:

```sh
cmake -S services/cfs-gauss-mhd -B /tmp/gauss-cfs-mhd-build
cmake --build /tmp/gauss-cfs-mhd-build
ctest --test-dir /tmp/gauss-cfs-mhd-build --output-on-failure
```

The production cFS adapter must be compiled against the selected cFS release
and verified with the mission target's message IDs, table/configuration rules,
watchdog behavior, and hardware-in-the-loop test evidence. This seam does not
claim cFS or radiation qualification by itself.
