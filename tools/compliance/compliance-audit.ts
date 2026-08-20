import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

type Status = "PASS" | "WARN" | "FAIL" | "SKIP";
type Enforcement = "blocking" | "advisory";

type SourceDefinition = {
  id: string;
  authority: string;
  framework: string;
  version: string;
  url: string;
  markers: string[];
  last_verified: string;
  deferred_statuses?: number[];
};

type CheckDefinition = {
  type: "file_exists" | "file_contains" | "file_not_contains" | "package_script" | "workflow_contains";
  path?: string;
  pattern?: string;
  script?: string;
};

type RequirementDefinition = {
  id: string;
  title: string;
  sources: string[];
  enforcement: Enforcement;
  checks: CheckDefinition[];
};

type Manifest = {
  schema_version: number;
  scope: string;
  assumptions: string[];
  sources: SourceDefinition[];
  requirements: RequirementDefinition[];
};

type SourceResult = {
  id: string;
  authority: string;
  framework: string;
  version: string;
  url: string;
  status: Status;
  detail: string;
  fetched_at: string | null;
  content_sha256: string | null;
  matched_markers: string[];
};

type CheckResult = CheckDefinition & {
  status: Status;
  detail: string;
};

type RequirementResult = RequirementDefinition & {
  status: Status;
  checks: CheckResult[];
};

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const manifestPath = path.join(root, "compliance/requirements.json");
const defaultJsonPath = path.join(root, "reports/compliance/requirements.latest.json");
const defaultMarkdownPath = path.join(root, "reports/compliance/requirements.latest.md");

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  return value && !value.startsWith("--") ? value : undefined;
}

function hasArg(flag: string): boolean {
  return process.argv.includes(flag);
}

function readManifest(): Manifest {
  return JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;
}

function repoPath(relativePath: string): string {
  return path.join(root, relativePath);
}

function resolveOutput(value: string | undefined, fallback: string): string {
  return path.resolve(value || fallback);
}

function checkFile(check: CheckDefinition): CheckResult {
  if (check.type === "package_script") {
    const packageJson = JSON.parse(readFileSync(repoPath("package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };
    const present = Boolean(check.script && packageJson.scripts?.[check.script]);
    return {
      ...check,
      status: present ? "PASS" : "FAIL",
      detail: present ? `npm script ${check.script} is present` : `npm script ${check.script || ""} is missing`,
    };
  }

  if (!check.path) {
    return { ...check, status: "FAIL", detail: "check path is missing" };
  }

  const fullPath = repoPath(check.path);
  if (check.type === "file_exists") {
    const present = existsSync(fullPath);
    return {
      ...check,
      status: present ? "PASS" : "FAIL",
      detail: present ? `${check.path} exists` : `${check.path} is missing`,
    };
  }

  if (!existsSync(fullPath)) {
    return { ...check, status: "FAIL", detail: `${check.path} is missing` };
  }

  const text = readFileSync(fullPath, "utf8");
  if (!check.pattern) {
    return { ...check, status: "FAIL", detail: `pattern missing for ${check.path}` };
  }

  let matches = false;
  try {
    matches = new RegExp(check.pattern, "m").test(text);
  } catch (error) {
    return {
      ...check,
      status: "FAIL",
      detail: `invalid regex: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const shouldMatch = check.type !== "file_not_contains";
  const passed = shouldMatch ? matches : !matches;
  return {
    ...check,
    status: passed ? "PASS" : "FAIL",
    detail: passed
      ? `${check.path} satisfies pattern`
      : `${check.path} does not satisfy pattern ${check.pattern}`,
  };
}

async function fetchSource(source: SourceDefinition, timeoutMs: number, online: boolean): Promise<SourceResult> {
  if (!online) {
    return {
      id: source.id,
      authority: source.authority,
      framework: source.framework,
      version: source.version,
      url: source.url,
      status: "SKIP",
      detail: "offline mode; pinned source metadata retained (run --online for freshness)",
      fetched_at: null,
      content_sha256: null,
      matched_markers: [],
    };
  }

  const fetchedAt = new Date().toISOString();
  try {
    const response = await fetch(source.url, {
      headers: { "user-agent": "Project-Gauss-Compliance-Audit/1.0" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const body = await response.text();
    const matchedMarkers = source.markers.filter((marker) => body.includes(marker));
    const digest = createHash("sha256").update(body).digest("hex");
    const deferred = source.deferred_statuses?.includes(response.status) ?? false;
    const ok = response.ok && matchedMarkers.length === source.markers.length;
    return {
      id: source.id,
      authority: source.authority,
      framework: source.framework,
      version: source.version,
      url: source.url,
      status: ok ? "PASS" : deferred ? "WARN" : "FAIL",
      detail: ok
        ? `HTTP ${response.status}; all ${source.markers.length} version/content markers matched`
        : deferred
          ? `HTTP ${response.status}; official endpoint deferred automated content verification`
        : `HTTP ${response.status}; matched ${matchedMarkers.length}/${source.markers.length} markers`,
      fetched_at: fetchedAt,
      content_sha256: digest,
      matched_markers: matchedMarkers,
    };
  } catch (error) {
    return {
      id: source.id,
      authority: source.authority,
      framework: source.framework,
      version: source.version,
      url: source.url,
      status: "FAIL",
      detail: error instanceof Error ? error.message : String(error),
      fetched_at: fetchedAt,
      content_sha256: null,
      matched_markers: [],
    };
  }
}

function validateManifest(manifest: Manifest): string[] {
  const errors: string[] = [];
  if (manifest.schema_version !== 1) errors.push("schema_version must be 1");
  const sourceIds = new Set<string>();
  for (const source of manifest.sources) {
    if (sourceIds.has(source.id)) errors.push(`duplicate source id: ${source.id}`);
    sourceIds.add(source.id);
    if (!source.url.startsWith("https://")) errors.push(`source ${source.id} must use https`);
    if (!source.markers.length) errors.push(`source ${source.id} has no markers`);
  }
  const requirementIds = new Set<string>();
  for (const requirement of manifest.requirements) {
    if (requirementIds.has(requirement.id)) errors.push(`duplicate requirement id: ${requirement.id}`);
    requirementIds.add(requirement.id);
    for (const sourceId of requirement.sources) {
      if (!sourceIds.has(sourceId)) errors.push(`${requirement.id} references unknown source ${sourceId}`);
    }
    if (requirement.checks.length === 0) errors.push(`${requirement.id} has no executable checks`);
  }
  return errors;
}

function buildMarkdown(
  manifest: Manifest,
  generatedAt: string,
  online: boolean,
  sourceResults: SourceResult[],
  requirementResults: RequirementResult[],
  totals: { pass: number; warn: number; fail: number; skip: number },
): string {
  const sourceRows = sourceResults
    .map((source) => `| ${source.id} | ${source.authority} | ${source.version} | ${source.status} | ${source.detail} |`)
    .join("\n");
  const requirementRows = requirementResults
    .map((requirement) => {
      const failed = requirement.checks.filter((check) => check.status === "FAIL").length;
      return `| ${requirement.id} | ${requirement.enforcement} | ${requirement.status} | ${failed}/${requirement.checks.length} checks failed | ${requirement.title} |`;
    })
    .join("\n");
  const failures = requirementResults.flatMap((requirement) =>
    requirement.checks
      .filter((check) => check.status === "FAIL")
      .map((check) => `- ${requirement.id}: ${check.detail}`),
  );

  return `# Compliance CI Report

Generated: ${generatedAt}

Online source verification: ${online ? "enabled" : "disabled"}

Summary: ${totals.pass} pass, ${totals.warn} warn, ${totals.fail} fail, ${totals.skip} skipped

## Source freshness

| Source | Authority | Version | Status | Detail |
| --- | --- | --- | --- | --- |
${sourceRows}

## Requirement alignment

| ID | Enforcement | Status | Failed checks | Requirement |
| --- | --- | --- | --- | --- |
${requirementRows}

## Blocking failures

${failures.length > 0 ? failures.join("\n") : "- None"}

This report is technical evidence only. See [docs/COMPLIANCE_ALIGNMENT.md](../../docs/COMPLIANCE_ALIGNMENT.md) for scope, assumptions, and organizational gaps.
`;
}

async function main(): Promise<void> {
  const manifest = readManifest();
  const manifestErrors = validateManifest(manifest);
  const online = hasArg("--online");
  const strict = hasArg("--strict");
  const failOnWarn = hasArg("--fail-on-warn");
  const timeoutMs = Number(argValue("--timeout-ms") || 12_000);
  const generatedAt = new Date().toISOString();

  const sourceResults = await Promise.all(
    manifest.sources.map((source) => fetchSource(source, timeoutMs, online)),
  );
  const requirementResults: RequirementResult[] = manifest.requirements.map((requirement) => {
    const checks = requirement.checks.map(checkFile);
    const failed = checks.some((check) => check.status === "FAIL");
    const status: Status = failed
      ? requirement.enforcement === "blocking"
        ? "FAIL"
        : "WARN"
      : requirement.enforcement === "advisory"
        ? "WARN"
        : "PASS";
    return { ...requirement, status, checks };
  });

  const sourceFailures = sourceResults.filter((source) => source.status === "FAIL").length;
  const pass =
    sourceResults.filter((source) => source.status === "PASS").length +
    requirementResults.filter((requirement) => requirement.status === "PASS").length;
  const warn =
    sourceResults.filter((source) => source.status === "WARN").length +
    requirementResults.filter((requirement) => requirement.status === "WARN").length;
  const fail =
    manifestErrors.length +
    sourceFailures +
    requirementResults.filter((requirement) => requirement.status === "FAIL").length;
  const skip = sourceResults.filter((source) => source.status === "SKIP").length;
  const totals = { pass, warn, fail, skip };
  const payload = {
    schema_version: 1,
    generated_at: generatedAt,
    scope: manifest.scope,
    assumptions: manifest.assumptions,
    online,
    strict,
    fail_on_warn: failOnWarn,
    manifest_errors: manifestErrors,
    sources: sourceResults,
    requirements: requirementResults,
    totals,
  };

  const jsonPath = resolveOutput(argValue("--json-out"), defaultJsonPath);
  const markdownPath = resolveOutput(argValue("--markdown-out"), defaultMarkdownPath);
  mkdirSync(path.dirname(jsonPath), { recursive: true });
  mkdirSync(path.dirname(markdownPath), { recursive: true });
  writeFileSync(jsonPath, `${JSON.stringify(payload, null, 2)}\n`);
  writeFileSync(markdownPath, buildMarkdown(manifest, generatedAt, online, sourceResults, requirementResults, totals));

  console.log("Gauss compliance alignment audit");
  console.log(`Sources: ${manifest.sources.length} (${online ? "online" : "offline pinned metadata"})`);
  console.log(`Requirements: ${manifest.requirements.length}`);
  console.log(`Summary: ${pass} pass, ${warn} warn, ${fail} fail, ${skip} skipped`);
  console.log(`Wrote ${path.relative(root, jsonPath)}`);
  console.log(`Wrote ${path.relative(root, markdownPath)}`);

  const shouldFail = fail > 0 || (failOnWarn && warn > 0) || (strict && sourceFailures > 0);
  if (shouldFail) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
