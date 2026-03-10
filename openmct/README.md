# Gauss OpenMCT Dashboard

Minimal OpenMCT setup that displays Gauss space weather telemetry from the Feed/API.

## Usage

1. Start the backend (and stack: Kafka, Redis, InfluxDB, etc.) so `/api/feed/space-weather/latest` is available.
2. Open **http://localhost:3001/openmct/** (or your API origin + `/openmct/`).
3. In OpenMCT, go to **Create** → choose **Gauss Space Weather** (or browse the Gauss namespace). Add a **Telemetry** view or **Overlay Plot** to see speed, density, and Bz.

## Adding plots and timelines

- **Overlay Plot**: Create → Overlay Plot, then add the Gauss Space Weather object as a telemetry source; pick `speed`, `density`, or `bz` for the Y-axis.
- **Table**: Create → Table, add Gauss Space Weather to show tabular realtime values.
- **Timeline**: Use OpenMCT’s timeline view and add the space weather object for a time-based strip.

Telemetry is polled every 5 seconds from `/api/feed/space-weather/latest`. For cross-origin API, set `window.GAUSS_API_BASE` before the adapter loads (e.g. to `http://localhost:3001`).
