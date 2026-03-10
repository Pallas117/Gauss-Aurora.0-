import { randomUUID } from "node:crypto";

export const CONJUNCTION_FORMATS = ["cdm_kvn", "cdm_json", "omm_json", "oem_json", "ocm_json"] as const;
export type ConjunctionFormat = (typeof CONJUNCTION_FORMATS)[number];

export const ALLOWED_CONJUNCTION_PURPOSES = [
  "collision_avoidance",
  "debris_mitigation",
  "operator_safety",
  "safety_research",
  "education",
] as const;

const BLOCKED_PURPOSE_PATTERNS: RegExp[] = [
  /weapon/i,
  /kinetic\s*strike/i,
  /target(ing)?/i,
  /offensive/i,
  /warfare/i,
  /assassinat(e|ion)/i,
  /disable\s+satellite/i,
];

export interface ConjunctionObjectDescriptor {
  name: string | null;
  objectId: string | null;
}

export interface ConjunctionRecord {
  id: string;
  ingestedAt: string;
  format: ConjunctionFormat;
  purpose: (typeof ALLOWED_CONJUNCTION_PURPOSES)[number];
  source: string | null;
  tca: string | null;
  missDistanceM: number | null;
  relativeSpeedMS: number | null;
  probabilityOfCollision: number | null;
  primary: ConjunctionObjectDescriptor;
  secondary: ConjunctionObjectDescriptor;
  warnings: string[];
  rawExcerpt: string;
}

export interface ConjunctionIngestInput {
  format: unknown;
  content: unknown;
  purpose: unknown;
  source?: unknown;
}

export interface ConjunctionPurposeDecision {
  allowed: boolean;
  code: "allow" | "missing_purpose" | "unknown_purpose" | "blocked_keyword";
  reason: string;
  normalizedPurpose: (typeof ALLOWED_CONJUNCTION_PURPOSES)[number] | null;
}

export class ConjunctionInteropError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "ConjunctionInteropError";
    this.code = code;
    this.status = status;
  }
}

function normalizeTrimmed(value: unknown, maxLen = 240): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLen);
}

function normalizeFormat(value: unknown): ConjunctionFormat | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (CONJUNCTION_FORMATS.includes(normalized as ConjunctionFormat)) {
    return normalized as ConjunctionFormat;
  }
  return null;
}

function normalizePurpose(value: unknown): (typeof ALLOWED_CONJUNCTION_PURPOSES)[number] | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (ALLOWED_CONJUNCTION_PURPOSES.includes(normalized as (typeof ALLOWED_CONJUNCTION_PURPOSES)[number])) {
    return normalized as (typeof ALLOWED_CONJUNCTION_PURPOSES)[number];
  }
  return null;
}

function readPath(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function parseIso(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const ts = Date.parse(value);
  if (!Number.isFinite(ts)) return null;
  return new Date(ts).toISOString();
}

function parseNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    const compact = value.replace(/[,\s]/g, "").trim();
    if (!compact) return null;
    const n = Number(compact);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function keyValuePairs(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of content.split(/\r?\n/)) {
    const idx = line.indexOf("=");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim().toUpperCase();
    const value = line.slice(idx + 1).trim();
    if (key) out[key] = value;
  }
  return out;
}

function valueFromCandidates(
  obj: Record<string, unknown>,
  candidates: readonly string[],
): unknown {
  for (const key of candidates) {
    const direct = obj[key];
    if (direct !== undefined) return direct;
    const nested = readPath(obj, key);
    if (nested !== undefined) return nested;
  }
  return undefined;
}

function parseJsonContent(content: unknown): Record<string, unknown> {
  if (typeof content === "string") {
    try {
      const parsed = JSON.parse(content) as unknown;
      if (!parsed || typeof parsed !== "object") {
        throw new ConjunctionInteropError("invalid_content", "JSON content must be an object.");
      }
      return parsed as Record<string, unknown>;
    } catch (error) {
      if (error instanceof ConjunctionInteropError) throw error;
      throw new ConjunctionInteropError("invalid_json", "Unable to parse JSON conjunction content.");
    }
  }
  if (content && typeof content === "object") {
    return content as Record<string, unknown>;
  }
  throw new ConjunctionInteropError("invalid_content", "JSON conjunction content must be object or JSON string.");
}

function parseCdmKvn(content: string): Pick<ConjunctionRecord, "tca" | "missDistanceM" | "relativeSpeedMS" | "probabilityOfCollision" | "primary" | "secondary"> {
  const kv = keyValuePairs(content);

  return {
    tca: parseIso(kv.TCA),
    missDistanceM: parseNumber(kv.MISS_DISTANCE ?? kv.MISS_DISTANCE_VALUE),
    relativeSpeedMS: parseNumber(kv.RELATIVE_SPEED),
    probabilityOfCollision: parseNumber(kv.COLLISION_PROBABILITY ?? kv.PC),
    primary: {
      name: normalizeTrimmed(kv.OBJECT1_NAME ?? kv.OBJECT1_OBJECT_NAME ?? kv.OBJECT1_OBJECT),
      objectId: normalizeTrimmed(kv.OBJECT1_ID ?? kv.OBJECT1_OBJECT_DESIGNATOR),
    },
    secondary: {
      name: normalizeTrimmed(kv.OBJECT2_NAME ?? kv.OBJECT2_OBJECT_NAME ?? kv.OBJECT2_OBJECT),
      objectId: normalizeTrimmed(kv.OBJECT2_ID ?? kv.OBJECT2_OBJECT_DESIGNATOR),
    },
  };
}

function parseJsonInterop(content: Record<string, unknown>): Pick<ConjunctionRecord, "tca" | "missDistanceM" | "relativeSpeedMS" | "probabilityOfCollision" | "primary" | "secondary"> {
  return {
    tca: parseIso(
      valueFromCandidates(content, ["tca", "TCA", "relative_metadata.tca", "relativeMetadata.tca", "event.time"]),
    ),
    missDistanceM: parseNumber(
      valueFromCandidates(content, [
        "missDistance",
        "MISS_DISTANCE",
        "relative_metadata.miss_distance_m",
        "relativeMetadata.missDistance",
        "metrics.miss_distance_m",
      ]),
    ),
    relativeSpeedMS: parseNumber(
      valueFromCandidates(content, [
        "relativeSpeed",
        "RELATIVE_SPEED",
        "relative_metadata.relative_speed_m_s",
        "relativeMetadata.relativeSpeed",
        "metrics.relative_speed_m_s",
      ]),
    ),
    probabilityOfCollision: parseNumber(
      valueFromCandidates(content, [
        "probabilityOfCollision",
        "collisionProbability",
        "COLLISION_PROBABILITY",
        "pc",
        "Pc",
      ]),
    ),
    primary: {
      name: normalizeTrimmed(valueFromCandidates(content, ["object1.name", "primary.name", "OBJECT1_NAME"])),
      objectId: normalizeTrimmed(
        valueFromCandidates(content, ["object1.id", "primary.id", "OBJECT1_ID", "OBJECT1_OBJECT_DESIGNATOR"]),
      ),
    },
    secondary: {
      name: normalizeTrimmed(valueFromCandidates(content, ["object2.name", "secondary.name", "OBJECT2_NAME"])),
      objectId: normalizeTrimmed(
        valueFromCandidates(content, ["object2.id", "secondary.id", "OBJECT2_ID", "OBJECT2_OBJECT_DESIGNATOR"]),
      ),
    },
  };
}

function buildRawExcerpt(content: unknown): string {
  if (typeof content === "string") {
    return content.slice(0, 1500);
  }
  try {
    return JSON.stringify(content).slice(0, 1500);
  } catch {
    return "[unserializable]";
  }
}

export function evaluateConjunctionPurpose(
  purposeRaw: unknown,
  notesRaw?: unknown,
): ConjunctionPurposeDecision {
  const purpose = normalizePurpose(purposeRaw);
  if (!purpose) {
    const normalizedText = `${normalizeTrimmed(purposeRaw, 600) ?? ""} ${normalizeTrimmed(notesRaw, 600) ?? ""}`.trim();
    if (!normalizedText) {
      return {
        allowed: false,
        code: "missing_purpose",
        reason: "Purpose is required and must be a safety-aligned value.",
        normalizedPurpose: null,
      };
    }
    if (BLOCKED_PURPOSE_PATTERNS.some((pattern) => pattern.test(normalizedText))) {
      return {
        allowed: false,
        code: "blocked_keyword",
        reason: "Purpose contains blocked offensive terms and is denied by ethics policy.",
        normalizedPurpose: null,
      };
    }
    return {
      allowed: false,
      code: "unknown_purpose",
      reason: `Purpose must be one of: ${ALLOWED_CONJUNCTION_PURPOSES.join(", ")}.`,
      normalizedPurpose: null,
    };
  }

  return {
    allowed: true,
    code: "allow",
    reason: "Purpose accepted by ethical-use policy.",
    normalizedPurpose: purpose,
  };
}

export function buildConjunctionRecord(input: ConjunctionIngestInput): ConjunctionRecord {
  const format = normalizeFormat(input.format);
  if (!format) {
    throw new ConjunctionInteropError(
      "invalid_format",
      `Unsupported format. Expected one of: ${CONJUNCTION_FORMATS.join(", ")}.`,
    );
  }

  const policy = evaluateConjunctionPurpose(input.purpose);
  if (!policy.allowed || !policy.normalizedPurpose) {
    throw new ConjunctionInteropError("purpose_blocked", policy.reason, 403);
  }

  const source = normalizeTrimmed(input.source, 160);
  const ingestedAt = new Date().toISOString();
  const warnings: string[] = [];

  let parsed: Pick<ConjunctionRecord, "tca" | "missDistanceM" | "relativeSpeedMS" | "probabilityOfCollision" | "primary" | "secondary">;

  if (format === "cdm_kvn") {
    if (typeof input.content !== "string") {
      throw new ConjunctionInteropError("invalid_content", "cdm_kvn content must be a text payload.");
    }
    parsed = parseCdmKvn(input.content);
  } else {
    const content = parseJsonContent(input.content);
    parsed = parseJsonInterop(content);
  }

  if (!parsed.tca) warnings.push("missing_or_invalid_tca");
  if (parsed.missDistanceM == null) warnings.push("missing_miss_distance");
  if (parsed.relativeSpeedMS == null) warnings.push("missing_relative_speed");
  if (!parsed.primary.objectId && !parsed.primary.name) warnings.push("missing_primary_object");
  if (!parsed.secondary.objectId && !parsed.secondary.name) warnings.push("missing_secondary_object");

  return {
    id: randomUUID(),
    ingestedAt,
    format,
    purpose: policy.normalizedPurpose,
    source,
    tca: parsed.tca,
    missDistanceM: parsed.missDistanceM,
    relativeSpeedMS: parsed.relativeSpeedMS,
    probabilityOfCollision: parsed.probabilityOfCollision,
    primary: parsed.primary,
    secondary: parsed.secondary,
    warnings,
    rawExcerpt: buildRawExcerpt(input.content),
  };
}
