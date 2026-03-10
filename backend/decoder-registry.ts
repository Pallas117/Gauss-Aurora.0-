/**
 * Decoder registry (GAUSS-COMP-001): unified telemetry decode abstraction.
 * Selects implementation by source/type: ccsds -> orchestrator decode API; csv -> stub (existing CSV path unchanged).
 */

export interface NormalizedPacket {
  timestamp: string;
  apid: number;
  seq_count?: number;
  payload_hex?: string;
  payload?: Buffer;
  quality_flags?: Record<string, unknown>;
  uncertainty?: Record<string, unknown>;
  canonical_point?: Record<string, unknown>;
}

export interface DecodeResult {
  packets: NormalizedPacket[];
  errors: string[];
}

export type DecoderFn = (raw: Buffer | string) => Promise<DecodeResult>;

const DECODE_API_BIND_ENV = "ORCHESTRATOR_DECODE_API_BIND";

function getDecodeApiUrl(): string | null {
  const bind = (process.env[DECODE_API_BIND_ENV] ?? "").trim();
  if (!bind) return null;
  const base = bind.includes("://") ? bind : `http://${bind}`;
  return `${base.replace(/\/$/, "")}/telemetry/decode`;
}

/** Normalize raw input to Buffer; returns null and error message if invalid. */
function toBuffer(raw: Buffer | string): { body: Buffer; error?: string } {
  if (Buffer.isBuffer(raw)) {
    return { body: raw };
  }
  if (typeof raw === "string") {
    try {
      return { body: Buffer.from(raw, "utf8") };
    } catch {
      return { body: Buffer.alloc(0), error: "Invalid raw input: string could not be converted to buffer." };
    }
  }
  return { body: Buffer.alloc(0), error: "Invalid raw input: expected Buffer or string." };
}

/** CCSDS decoder: delegates to orchestrator decode API when configured. */
async function decodeCcsds(raw: Buffer | string): Promise<DecodeResult> {
  const url = getDecodeApiUrl();
  if (!url) {
    return {
      packets: [],
      errors: ["Orchestrator decode not configured (set ORCHESTRATOR_DECODE_API_BIND to enable)."],
    };
  }

  const { body, error: inputError } = toBuffer(raw);
  if (inputError) return { packets: [], errors: [inputError] };

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body,
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      const text = await response.text();
      return {
        packets: [],
        errors: [`Orchestrator decode failed: ${response.status} ${response.statusText}${text ? ` - ${text.slice(0, 200)}` : ""}`],
      };
    }

    const data = (await response.json()) as {
      packets?: Array<{
        timestamp?: string;
        apid?: number;
        seq_count?: number;
        payload_hex?: string;
        canonical_point?: Record<string, unknown>;
        quality_flags?: Record<string, unknown>;
        uncertainty?: Record<string, unknown>;
      }>;
      errors?: Array<{ code?: string; reason?: string }>;
    };

    const packets: NormalizedPacket[] = (data.packets ?? []).map((p) => ({
      timestamp: p.timestamp ?? "",
      apid: p.apid ?? 0,
      seq_count: p.seq_count,
      payload_hex: p.payload_hex,
      quality_flags: p.quality_flags,
      uncertainty: p.uncertainty,
      canonical_point: p.canonical_point,
    }));

    const errors: string[] = (data.errors ?? []).map(
      (e) => `${e.code ?? "error"}: ${e.reason ?? ""}`.trim() || "Unknown decode error",
    );

    return { packets, errors };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      packets: [],
      errors: [`Orchestrator decode not configured or failed: ${message}`],
    };
  }
}

/** CSV decoder stub: existing CSV parsers/feeds remain separate; registry does not implement CSV decode. */
async function decodeCsv(_raw: Buffer | string): Promise<DecodeResult> {
  return {
    packets: [],
    errors: ["CSV decode not implemented in registry; use existing CSV ingest path."],
  };
}

const SOURCE_ALIASES: Record<string, string> = {
  ccsds: "ccsds",
  "ccsds-orchestrator": "ccsds",
  "ccsds-bin": "ccsds",
  "ccsds-hex": "ccsds",
  csv: "csv",
};

/**
 * Return the decoder for the given source/type, or null if unknown.
 * Source/type are normalized (e.g. ccsds-orchestrator -> ccsds).
 */
export function getDecoder(source: string, type?: string): DecoderFn | null {
  const key = (type ?? source ?? "").toLowerCase().trim() || "ccsds";
  const normalized = SOURCE_ALIASES[key] ?? key;
  if (normalized === "ccsds") return decodeCcsds;
  if (normalized === "csv") return decodeCsv;
  return null;
}

/**
 * Decode raw packet bytes using the registry. Selects decoder by options.source (and options.type).
 * Defaults to ccsds (orchestrator) when no source given. Malformed input is isolated: returns empty packets and error.
 */
export async function decode(
  raw: Buffer | string,
  options?: { source?: string; type?: string },
): Promise<DecodeResult> {
  const source = (options?.source ?? "ccsds").trim() || "ccsds";
  const type = options?.type?.trim();
  const decoder = getDecoder(source, type);
  if (!decoder) {
    return {
      packets: [],
      errors: [`No decoder registered for source/type: ${source}${type ? ` / ${type}` : ""}`],
    };
  }
  return decoder(raw);
}
