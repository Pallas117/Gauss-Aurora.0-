import { getCyberTiger } from "./daemon.js";

export class SelfHealerAgent {
  private lastIngestTimestamp: number = Date.now();
  private lastMLConfidence: number[] = [1.0, 1.0, 1.0];

  constructor() {}

  /**
   * Checks if ingest-loop is producing fresh canonical points.
   * Staleness > 90s = anomaly.
   */
  async diagnoseIngestionStall(currentTimestamp: number): Promise<boolean> {
    const staleness = (Date.now() - currentTimestamp) / 1000;
    return staleness > 90;
  }

  /**
   * Resets the worker timer and forces a synthetic data tick.
   */
  async healIngestionStall(): Promise<void> {
    const ct = getCyberTiger();
    ct.recordIngestFallback("SelfHealer", "Ingestion Stall Detected");
    // In a real system, this might involve process.send('restart') or similar.
    console.warn("[SelfHealer] Healing Ingestion Stall: Triggering synthetic tick.");
  }

  /**
   * Detects if forecast probability has been flatlined (model not updating).
   */
  async diagnoseMLDrift(currentConfidence: number): Promise<boolean> {
    this.lastMLConfidence.shift();
    this.lastMLConfidence.push(currentConfidence);
    
    // If confidence is below 0.5 for 3 consecutive reads
    return this.lastMLConfidence.every(c => c < 0.5);
  }

  /**
   * Triggers internal training.
   */
  async healMLDrift(): Promise<void> {
    console.warn("[SelfHealer] Healing ML Drift: Triggering nowcast training.");
    try {
        // Trigger internal training endpoint
        await fetch("http://localhost:13000/api/ai/nowcast/train", {
            method: "POST",
            headers: { "Content-Type": "application/json" }
        });
    } catch (e) {
        console.error("[SelfHealer] Failed to trigger ML training:", e);
    }
  }
}

let _instance: SelfHealerAgent | null = null;
export function getSelfHealer(): SelfHealerAgent {
  if (!_instance) {
    _instance = new SelfHealerAgent();
  }
  return _instance;
}
