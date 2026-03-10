/**
 * Decoder status state: in-memory samples with time-window and hard length cap
 * for memory safety (8GB M1). Used by server routes.
 */

import { basename } from "node:path";
import type { PacketDecoderStatus } from "./types.js";

const MAX_DECODER_SAMPLES = 1000;
const DECODER_WINDOW_MS = 5 * 60 * 1000;

export type DecoderEventSample = {
  tsMs: number;
  accepted: number;
  rejected: number;
};

const decoderSamples: DecoderEventSample[] = [];
let decoderLastDecodeAt: string | null = null;
let decoderLastError: string | null = null;

function parseEnvBool(name: string, fallback = false): boolean {
  const raw = (process.env[name] ?? "").trim().toLowerCase();
  if (!raw) return fallback;
  return !["0", "false", "off", "no", "disabled"].includes(raw);
}

function configuredDecoderDictionaryId(): string | null {
  const explicit = (process.env.ORCHESTRATOR_PACKET_DICTIONARY_ID ?? "").trim();
  if (explicit) return explicit;
  const xtcePath = (process.env.ORCHESTRATOR_XTCE_PATH ?? "").trim();
  if (!xtcePath) return null;
  return basename(xtcePath);
}

function compactDecoderSamples(nowMs: number): void {
  const windowStart = nowMs - DECODER_WINDOW_MS;
  let firstValid = 0;
  while (firstValid < decoderSamples.length && decoderSamples[firstValid]!.tsMs < windowStart) {
    firstValid += 1;
  }
  if (firstValid > 0) {
    decoderSamples.splice(0, firstValid);
  }
  if (decoderSamples.length > MAX_DECODER_SAMPLES) {
    decoderSamples.splice(0, decoderSamples.length - MAX_DECODER_SAMPLES);
  }
}

export function recordDecoderResult(
  acceptedCount: number,
  rejectedCount: number,
  lastError: string | null,
): void {
  const nowMs = Date.now();
  decoderSamples.push({
    tsMs: nowMs,
    accepted: acceptedCount,
    rejected: rejectedCount,
  });
  compactDecoderSamples(nowMs);
  decoderLastDecodeAt = new Date(nowMs).toISOString();
  if (lastError) {
    decoderLastError = lastError;
  }
}

export function buildDecoderStatus(): PacketDecoderStatus {
  const nowMs = Date.now();
  compactDecoderSamples(nowMs);

  const aggregate = decoderSamples.reduce(
    (acc, sample) => {
      acc.accepted += sample.accepted;
      acc.rejected += sample.rejected;
      return acc;
    },
    { accepted: 0, rejected: 0 },
  );
  const total = aggregate.accepted + aggregate.rejected;
  const errorRate = total > 0 ? aggregate.rejected / total : 0;

  return {
    enabled: parseEnvBool("ORCHESTRATOR_DECODE_ENABLED", false),
    dictionary_id: configuredDecoderDictionaryId(),
    last_decode_at: decoderLastDecodeAt,
    decode_error_rate_5m: Number(errorRate.toFixed(4)),
    last_error: decoderLastError,
  };
}

/** For unit tests: current number of samples (after compact). */
export function getDecoderSamplesLength(): number {
  compactDecoderSamples(Date.now());
  return decoderSamples.length;
}
