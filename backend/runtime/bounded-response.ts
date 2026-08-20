/**
 * Read upstream response bodies without allowing an untrusted Content-Length
 * or stream to become an unbounded process-local allocation.
 */

export const DEFAULT_MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

function normalizeLimit(maxBytes: number): number {
  return Number.isFinite(maxBytes) && maxBytes > 0
    ? Math.floor(maxBytes)
    : DEFAULT_MAX_RESPONSE_BYTES;
}

export async function readResponseTextBounded(
  response: Response,
  maxBytes = DEFAULT_MAX_RESPONSE_BYTES,
): Promise<string | null> {
  const limit = normalizeLimit(maxBytes);
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > limit) {
    return null;
  }

  if (!response.body) {
    if (typeof response.text === "function") {
      try {
        const text = await response.text();
        return Buffer.byteLength(text, "utf8") <= limit ? text : null;
      } catch {
        return null;
      }
    }
    return "";
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let text = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;

      bytesRead += value.byteLength;
      if (bytesRead > limit) {
        await reader.cancel("response body exceeded memory budget");
        return null;
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return text;
  } finally {
    reader.releaseLock();
  }
}

export async function readResponseJsonBounded<T>(
  response: Response,
  maxBytes = DEFAULT_MAX_RESPONSE_BYTES,
): Promise<T | null> {
  // Unit-level fetch doubles often expose only json(). Native fetch Response
  // objects have a body stream, so production responses still take the strict
  // streaming path above. Keep this compatibility path size-checked after
  // parsing so tests cannot accidentally hide an oversized fixture.
  if (!response.body && typeof response.json === "function") {
    try {
      const parsed = await response.json() as T;
      const serialized = JSON.stringify(parsed);
      return Buffer.byteLength(serialized, "utf8") <= normalizeLimit(maxBytes)
        ? parsed
        : null;
    } catch {
      return null;
    }
  }
  const text = await readResponseTextBounded(response, maxBytes);
  if (text === null) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}
