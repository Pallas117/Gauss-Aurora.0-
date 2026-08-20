const META_REFLECTION_PATTERNS = [
  /\bokay\b/i,
  /\bi need to\b/i,
  /\blet me\b/i,
  /\bi should\b/i,
  /\bthe user\b/i,
  /\bwait\b/i,
  /\bputting it all together\b/i,
  /\bfirst, i\b/i,
  /\bi remember\b/i,
  /\bi'm not\b/i,
  /\bchain of thought\b/i,
  /\bthought process\b/i,
  /\breasoning\b/i,
];

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

export function stripReasoningArtifacts(raw: string): string {
  return raw
    .replace(/<think[\s\S]*?<\/think>/gi, " ")
    .replace(/<\/?think>/gi, " ")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^\s*(analysis|reasoning|thought process)\s*:\s*/gim, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function sanitizePublicModelText(
  raw: string,
  options?: {
    minLength?: number;
    maxLength?: number;
  },
): string | null {
  const minLength = options?.minLength ?? 8;
  const maxLength = options?.maxLength ?? 240;
  const stripped = stripReasoningArtifacts(raw);
  if (!stripped || stripped.length < minLength) {
    return null;
  }

  const normalized = stripped
    .replace(/^[\-*]\s*/, "")
    .replace(/\s+([,.;:!?])/g, "$1")
    .trim();

  if (!normalized || META_REFLECTION_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return null;
  }

  return truncate(normalized, maxLength);
}

export function sanitizeModelReflection(raw: string): string | null {
  const normalized = stripReasoningArtifacts(raw);
  if (!normalized) {
    return null;
  }

  const sentences = normalized
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  const filtered = sentences.filter(
    (sentence) => !META_REFLECTION_PATTERNS.some((pattern) => pattern.test(sentence)),
  );

  const picked = (filtered.length > 0 ? filtered : sentences)
    .filter((sentence) => sentence.length >= 40)
    .slice(0, 4);

  if (picked.length === 0) {
    return null;
  }

  return truncate(picked.join(" ").trim(), 900);
}
