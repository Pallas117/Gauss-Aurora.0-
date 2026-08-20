import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

type Check = {
  id: string;
  ok: boolean;
  detail: string;
};

type Handoff = {
  schema_version: 1;
  created_at: string;
  branch: string;
  from: string;
  to: string;
  summary: string;
  scope: string[];
  files_changed: string[];
  verification: string[];
  risks: string[];
  memory_update: string;
};

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const rolesDir = path.join(root, "agents/roles");
const operatorTasksDir = path.join(root, "agents/operator-tasks");
const operatorTaskSchemaPath = path.join(root, "agents/operator-task.schema.json");
const reportsContextDir = path.join(root, "reports/context");
const operatorTaskReportsDir = path.join(reportsContextDir, "operator-tasks");

const requiredScripts = [
  "develop:status",
  "develop:brief",
  "develop:cleanup",
  "develop:cleanup:apply",
  "develop:cleanup:all",
  "develop:exit",
  "develop:verify",
  "develop:interoperability",
  "develop:skills:check",
  "develop:tasks",
  "develop:task",
  "compliance:check",
  "compliance:check:online",
  "develop:handoff",
  "develop:skills:install",
  "debt:check",
  "audit:mission-targets",
  "audit:space-bridge",
  "audit:product-packages",
  "quality:rust",
  "quality:check",
  "check:llm",
  "memory:audit",
  "orchestrator:clean",
];

const requiredOperatorTaskFields = [
  "task_id",
  "name",
  "domain",
  "stage",
  "primary_role",
  "skill",
  "approval",
];

const requiredOperatorTaskHeadings = [
  "## Purpose",
  "## Inputs",
  "## Procedure",
  "## Outputs",
  "## Guardrails",
  "## Verification",
];

const requiredHandoffFields = [
  "schema_version",
  "created_at",
  "branch",
  "from",
  "to",
  "summary",
  "scope",
  "files_changed",
  "verification",
  "risks",
  "memory_update",
];

function runGit(args: string[]): string {
  try {
    return execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trimEnd();
  } catch {
    return "";
  }
}

function gitBranch(): string {
  return runGit(["branch", "--show-current"]).trim() || "unknown";
}

function changedFiles(): string[] {
  const status = runGit(["status", "--porcelain=v1", "-uall"]);

  return status
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => {
      const rawPath = line.startsWith("?? ") ? line.slice(3) : line.slice(3);
      const renameSeparator = " -> ";
      const renameIndex = rawPath.indexOf(renameSeparator);
      return renameIndex >= 0 ? rawPath.slice(renameIndex + renameSeparator.length) : rawPath;
    })
    .sort((a, b) => a.localeCompare(b));
}

function listRoles(): string[] {
  if (!existsSync(rolesDir)) {
    return [];
  }

  return readdirSync(rolesDir)
    .filter((entry) => entry.endsWith(".md"))
    .map((entry) => entry.replace(/\.md$/, ""))
    .sort((a, b) => a.localeCompare(b));
}

function listOperatorTaskFiles(): string[] {
  if (!existsSync(operatorTasksDir)) {
    return [];
  }

  return readdirSync(operatorTasksDir)
    .filter((entry) => entry.endsWith(".md") && entry !== "README.md")
    .sort((a, b) => a.localeCompare(b));
}

function parseFrontmatter(text: string): Record<string, string> | undefined {
  const match = text.match(/^---\n([\s\S]*?)\n---/);
  if (!match) {
    return undefined;
  }

  const fields: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const separator = line.indexOf(":");
    if (separator < 0) {
      continue;
    }

    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, "");
    if (key) {
      fields[key] = value;
    }
  }

  return fields;
}

function operatorTaskMetadata(file: string): Record<string, string> | undefined {
  const fullPath = path.join(operatorTasksDir, file);
  return parseFrontmatter(readFileSync(fullPath, "utf8"));
}

function fileExists(relativePath: string): boolean {
  return existsSync(path.join(root, relativePath));
}

function readText(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), "utf8");
}

function commandRecommendations(files: string[]): string[] {
  const commands = new Set<string>();
  commands.add("npm run develop:verify");

  const touches = (prefix: string) => files.some((file) => file === prefix || file.startsWith(prefix));
  const hasDisposableCaptures = files.some(
    (file) => file.startsWith(".playwright-cli/") || file.startsWith(".playwright-mcp/"),
  );

  if (files.length === 0) {
    commands.add("npm run lint");
    return [...commands];
  }

  if (hasDisposableCaptures) {
    commands.add("npm run develop:cleanup");
  }

  if (touches("src/") || files.some((file) => file === "index.html" || file === "vite.config.ts")) {
    commands.add("npm run lint");
    commands.add("npm run build");
    commands.add("npm run test:unit:ui");
  }

  if (touches("backend/")) {
    commands.add("npm run lint");
    commands.add("npm test");
    commands.add("npm run test:backend:granular");
  }

  if (touches("gauss-orchestrator/") || touches("gauss orchestrator/")) {
    commands.add("npm run test:orchestrator");
  }

  if (touches("ml/")) {
    commands.add("pytest -q tests/unit");
  }

  if (touches("supabase/")) {
    commands.add("npm run test:supabase-rls");
  }

  if (
    touches("agents/") ||
    touches("skills/") ||
    touches("development/") ||
    touches("tools/development/") ||
    touches("config/development-interoperability.json") ||
    files.some((file) => file === "AGENTS.md" || file === "package.json")
  ) {
    commands.add("npm run develop:skills:check");
    commands.add("npm run develop:interoperability");
  }

  if (touches("agents/operator-tasks/") || touches("agents/operator-task.schema.json")) {
    commands.add("npm run develop:tasks");
  }

  if (
    touches("compliance/") ||
    touches(".github/workflows/") ||
    files.some((file) => file === "docs/COMPLIANCE_ALIGNMENT.md")
  ) {
    commands.add("npm run compliance:check");
  }

  if (files.some((file) => file.endsWith(".md") || file.endsWith(".json"))) {
    commands.add("npm run develop:brief");
  }

  return [...commands];
}

function statusPayload() {
  const files = changedFiles();
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    branch: gitBranch(),
    changedFiles: files,
    roles: listRoles(),
    recommendedVerification: commandRecommendations(files),
    memoryFiles: [
      "development/memory/README.md",
      "development/memory/CURRENT.md",
      "development/memory/DECISIONS.md",
      "development/memory/BACKLOG.md",
    ].filter(fileExists),
    operatorTasks: listOperatorTaskFiles().map((file) => `agents/operator-tasks/${file}`),
  };
}

function printStatus(): void {
  const payload = statusPayload();

  console.log("Gauss development status");
  console.log(`Branch: ${payload.branch}`);
  console.log(`Working-tree files: ${payload.changedFiles.length}`);

  if (payload.changedFiles.length > 0) {
    console.log("\nChanged files:");
    payload.changedFiles.forEach((file) => console.log(`- ${file}`));
  }

  console.log("\nRecommended verification:");
  payload.recommendedVerification.forEach((command) => console.log(`- ${command}`));

  console.log("\nDurable memory:");
  payload.memoryFiles.forEach((file) => console.log(`- ${file}`));
}

function markdownList(items: string[], emptyText: string): string {
  if (items.length === 0) {
    return `- ${emptyText}`;
  }

  return items.map((item) => `- ${item}`).join("\n");
}

function writeBrief(): void {
  const payload = statusPayload();
  mkdirSync(reportsContextDir, { recursive: true });

  const jsonPath = path.join(reportsContextDir, "continuous-development.latest.json");
  const markdownPath = path.join(reportsContextDir, "continuous-development.latest.md");

  const json = {
    ...payload,
    architecture: {
      activeWebEntry: ["src/main.tsx", "src/App.jsx", "src/Cybertiger.tsx"],
      domains: ["src", "backend", "gauss-orchestrator", "ml", "supabase"],
      durableMemoryRoot: "development/memory",
      handoffSchema: "agents/handoff.schema.json",
      operatorTaskCatalog: "agents/operator-tasks/README.md",
      operatorTaskSchema: "agents/operator-task.schema.json",
      operatorTaskReports: "reports/context/operator-tasks/",
      complianceManifest: "compliance/requirements.json",
      complianceReports: "reports/compliance/",
    },
  };

  writeFileSync(jsonPath, `${JSON.stringify(json, null, 2)}\n`);

  const markdown = `# Gauss Continuous Development Capsule

Generated: ${payload.generatedAt}

Branch: ${payload.branch}

## Working-tree scope

${markdownList(payload.changedFiles, "No working-tree changes detected.")}

## Recommended verification

${markdownList(payload.recommendedVerification, "No additional checks selected.")}

## Durable memory

${markdownList(payload.memoryFiles, "No durable memory files detected.")}

## Satellite operator task catalog

${markdownList(payload.operatorTasks, "No operator task briefs detected.")}

## Active architecture map

- Web entry: \`src/main.tsx\` -> \`src/App.jsx\` -> \`src/Cybertiger.tsx\`
- Service boundaries: \`src/\`, \`backend/\`, \`gauss-orchestrator/\`, \`ml/\`, \`supabase/\`
- Handoff schema: \`agents/handoff.schema.json\`
- Operator task schema: \`agents/operator-task.schema.json\`
- Generated operator packets: \`reports/context/operator-tasks/\`
- Compliance manifest: \`compliance/requirements.json\`
- Generated compliance evidence: \`reports/compliance/\`

Generated capsules are handoff aids. Update \`development/memory/\` directly for durable facts.
`;

  writeFileSync(markdownPath, markdown);

  console.log(`Wrote ${path.relative(root, jsonPath)}`);
  console.log(`Wrote ${path.relative(root, markdownPath)}`);
}

function parseFlag(name: string): string | undefined {
  const flag = `--${name}`;
  const index = process.argv.indexOf(flag);

  if (index < 0) {
    return undefined;
  }

  const value = process.argv[index + 1];
  return value && !value.startsWith("--") ? value : undefined;
}

function splitList(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean);
}

function assertRole(role: string, label: string): void {
  const roles = listRoles();
  if (!roles.includes(role)) {
    throw new Error(`${label} must be one of: ${roles.join(", ")}`);
  }
}

function writeHandoff(): void {
  const from = parseFlag("from");
  const to = parseFlag("to");
  const summary = parseFlag("summary");

  if (!from || !to || !summary) {
    throw new Error("handoff requires --from, --to, and --summary");
  }

  assertRole(from, "--from");
  assertRole(to, "--to");

  const files = changedFiles();
  const createdAt = new Date().toISOString();
  const handoff: Handoff = {
    schema_version: 1,
    created_at: createdAt,
    branch: gitBranch(),
    from,
    to,
    summary,
    scope: splitList(parseFlag("scope")),
    files_changed: files,
    verification: splitList(parseFlag("verification")),
    risks: splitList(parseFlag("risks")),
    memory_update:
      parseFlag("memory-update") ||
      "Review development/memory/ before continuing; no durable memory update was supplied.",
  };

  if (handoff.scope.length === 0) {
    handoff.scope = files.length > 0 ? files : ["No working-tree files detected."];
  }

  const outDir = path.join(reportsContextDir, "handoffs");
  mkdirSync(outDir, { recursive: true });

  const stamp = createdAt.replace(/[:.]/g, "-");
  const filename = `${stamp}-${from}-to-${to}.json`;
  const outPath = path.join(outDir, filename);

  writeFileSync(outPath, `${JSON.stringify(handoff, null, 2)}\n`);
  console.log(`Wrote ${path.relative(root, outPath)}`);
}

function writeOperatorTaskPacket(): void {
  const templateId = parseFlag("task");
  const satelliteId = parseFlag("satellite");
  const objective = parseFlag("objective");

  if (!templateId || !satelliteId || !objective) {
    throw new Error("task requires --task, --satellite, and --objective");
  }

  const taskFiles = listOperatorTaskFiles();
  const taskFile = `${templateId}.md`;
  if (!taskFiles.includes(taskFile)) {
    throw new Error(`--task must match an operator brief: ${taskFiles.join(", ")}`);
  }

  const metadata = operatorTaskMetadata(taskFile);
  if (!metadata) {
    throw new Error(`operator brief ${templateId} has no readable frontmatter`);
  }

  const priorities = new Set(["informational", "advisory", "urgent", "critical"]);
  const modes = new Set(["observe", "diagnose", "plan", "authorize", "execute", "handoff"]);
  const states = new Set(["open", "in_progress", "blocked", "complete", "escalated"]);
  const priority = parseFlag("priority") || "advisory";
  const stageToMode: Record<string, string> = {
    observe: "observe",
    diagnose: "diagnose",
    plan: "plan",
    authorize: "authorize",
    handoff: "handoff",
  };
  const mode = parseFlag("mode") || stageToMode[metadata.stage] || "observe";
  const state = parseFlag("state") || "open";

  if (!priorities.has(priority)) {
    throw new Error(`--priority must be one of: ${[...priorities].join(", ")}`);
  }
  if (!modes.has(mode)) {
    throw new Error(`--mode must be one of: ${[...modes].join(", ")}`);
  }
  if (!states.has(state)) {
    throw new Error(`--state must be one of: ${[...states].join(", ")}`);
  }

  const createdAt = new Date().toISOString();
  const packetId = `${templateId}-${Date.now()}`;
  const packet = {
    schema_version: 1,
    task_id: packetId,
    template_id: templateId,
    created_at: createdAt,
    satellite_id: satelliteId,
    objective,
    priority,
    mode,
    primary_role: metadata.primary_role,
    supporting_roles: [],
    inputs: [],
    constraints: ["No irreversible action without explicit human authorization."],
    evidence: [],
    approval: {
      status: "pending",
      approver: null,
      expires_at: null,
    },
    outputs: [],
    state,
    memory_update: "Populate evidence, outputs, and the next owner before handoff.",
  };

  mkdirSync(operatorTaskReportsDir, { recursive: true });
  const outPath = path.join(operatorTaskReportsDir, `${packetId}.json`);
  writeFileSync(outPath, `${JSON.stringify(packet, null, 2)}\n`);
  console.log(`Wrote ${path.relative(root, outPath)}`);
  console.log("Packet is pending and non-executable until an operator records approval.");
}

function packageScriptsCheck(): Check[] {
  try {
    const packageJson = JSON.parse(readText("package.json")) as { scripts?: Record<string, unknown> };
    const scripts = packageJson.scripts || {};
    return requiredScripts.map((script) => ({
      id: `package:${script}`,
      ok: typeof scripts[script] === "string",
      detail: typeof scripts[script] === "string" ? "script is present" : "script is missing",
    }));
  } catch (error) {
    return [
      {
        id: "package:parse",
        ok: false,
        detail: error instanceof Error ? error.message : "failed to parse package.json",
      },
    ];
  }
}

function markdownStructureCheck(relativePath: string, headings: string[]): Check[] {
  const fullPath = path.join(root, relativePath);
  if (!existsSync(fullPath)) {
    return [{ id: `memory:${relativePath}`, ok: false, detail: "file is missing" }];
  }

  const text = readFileSync(fullPath, "utf8");
  return headings.map((heading) => ({
    id: `memory:${relativePath}:${heading}`,
    ok: text.includes(heading),
    detail: text.includes(heading) ? "heading is present" : "heading is missing",
  }));
}

function handoffSchemaCheck(): Check[] {
  const relativePath = "agents/handoff.schema.json";
  if (!fileExists(relativePath)) {
    return [{ id: "handoff:schema", ok: false, detail: "schema is missing" }];
  }

  try {
    const schema = JSON.parse(readText(relativePath)) as { required?: string[] };
    const required = new Set(schema.required || []);
    return requiredHandoffFields.map((field) => ({
      id: `handoff:field:${field}`,
      ok: required.has(field),
      detail: required.has(field) ? "required by schema" : "missing from schema.required",
    }));
  } catch (error) {
    return [
      {
        id: "handoff:schema:parse",
        ok: false,
        detail: error instanceof Error ? error.message : "failed to parse schema",
      },
    ];
  }
}

function roleChecks(): Check[] {
  const roles = listRoles();
  const checks: Check[] = [
    {
      id: "roles:minimum",
      ok: roles.length >= 4,
      detail: `${roles.length} role files detected`,
    },
  ];

  for (const role of roles) {
    const relativePath = `agents/roles/${role}.md`;
    const text = readText(relativePath);
    checks.push(
      {
        id: `role:${role}:receive`,
        ok: text.includes("## Receive"),
        detail: text.includes("## Receive") ? "receive contract present" : "receive contract missing",
      },
      {
        id: `role:${role}:produce`,
        ok: text.includes("## Produce"),
        detail: text.includes("## Produce") ? "produce contract present" : "produce contract missing",
      },
      {
        id: `role:${role}:guardrails`,
        ok: text.includes("## Guardrails"),
        detail: text.includes("## Guardrails") ? "guardrails present" : "guardrails missing",
      },
    );
  }

  return checks;
}

function skillChecks(): Check[] {
  const skillsDir = path.join(root, "skills");
  if (!existsSync(skillsDir)) {
    return [{ id: "skills:root", ok: false, detail: "skills directory is missing" }];
  }

  const skillNames = readdirSync(skillsDir)
    .filter((entry) => statSync(path.join(skillsDir, entry)).isDirectory())
    .sort((a, b) => a.localeCompare(b));

  const checks: Check[] = [];

  for (const skillName of skillNames) {
    const skillPath = path.join(skillsDir, skillName, "SKILL.md");
    const agentPath = path.join(skillsDir, skillName, "agents/openai.yaml");
    const hasSkill = existsSync(skillPath);
    const text = hasSkill ? readFileSync(skillPath, "utf8") : "";
    const frontmatter = text.match(/^---\n([\s\S]*?)\n---/);

    checks.push(
      {
        id: `skill:${skillName}:skill-md`,
        ok: hasSkill,
        detail: hasSkill ? "SKILL.md present" : "SKILL.md missing",
      },
      {
        id: `skill:${skillName}:frontmatter`,
        ok: Boolean(frontmatter),
        detail: frontmatter ? "frontmatter present" : "frontmatter missing",
      },
      {
        id: `skill:${skillName}:name`,
        ok: Boolean(frontmatter?.[1].includes(`name: ${skillName}`)),
        detail: frontmatter?.[1].includes(`name: ${skillName}`)
          ? "name matches directory"
          : "name does not match directory",
      },
      {
        id: `skill:${skillName}:description`,
        ok: Boolean(frontmatter?.[1].includes("description:")),
        detail: frontmatter?.[1].includes("description:")
          ? "description present"
          : "description missing",
      },
      {
        id: `skill:${skillName}:todos`,
        ok: !text.includes("TODO"),
        detail: !text.includes("TODO") ? "no TODO placeholders" : "TODO placeholder found",
      },
      {
        id: `skill:${skillName}:agent`,
        ok: existsSync(agentPath),
        detail: existsSync(agentPath) ? "agent metadata present" : "agent metadata missing",
      },
    );
  }

  return checks;
}

function operatorTaskChecks(): Check[] {
  const checks: Check[] = [];

  checks.push({
    id: "operator-tasks:directory",
    ok: existsSync(operatorTasksDir),
    detail: existsSync(operatorTasksDir) ? "task catalog directory present" : "task catalog directory missing",
  });

  const catalogPath = path.join(operatorTasksDir, "README.md");
  const catalogText = existsSync(catalogPath) ? readFileSync(catalogPath, "utf8") : "";
  for (const heading of ["# Satellite Operator Task Catalog", "## Task Contract", "## Catalog", "## Lifecycle"]) {
    checks.push({
      id: `operator-tasks:catalog:${heading}`,
      ok: catalogText.includes(heading),
      detail: catalogText.includes(heading) ? "catalog section present" : "catalog section missing",
    });
  }

  if (!existsSync(operatorTaskSchemaPath)) {
    checks.push({
      id: "operator-tasks:schema",
      ok: false,
      detail: "operator task schema missing",
    });
  } else {
    try {
      const schema = JSON.parse(readFileSync(operatorTaskSchemaPath, "utf8")) as {
        required?: string[];
      };
      const required = new Set(schema.required || []);
      checks.push({
        id: "operator-tasks:schema",
        ok: required.has("task_id") && required.has("satellite_id") && required.has("approval"),
        detail:
          required.has("task_id") && required.has("satellite_id") && required.has("approval")
            ? "schema includes identity, satellite, and approval fields"
            : "schema is missing required operator fields",
      });
    } catch (error) {
      checks.push({
        id: "operator-tasks:schema",
        ok: false,
        detail: error instanceof Error ? error.message : "failed to parse operator task schema",
      });
    }
  }

  const taskFiles = listOperatorTaskFiles();
  checks.push({
    id: "operator-tasks:minimum",
    ok: taskFiles.length >= 1,
    detail: `${taskFiles.length} operator task brief(s) detected`,
  });

  const ids = new Set<string>();
  for (const file of taskFiles) {
    const text = readFileSync(path.join(operatorTasksDir, file), "utf8");
    const metadata = parseFrontmatter(text);
    const taskName = file.replace(/\.md$/, "");

    checks.push({
      id: `operator-task:${taskName}:frontmatter`,
      ok: Boolean(metadata),
      detail: metadata ? "frontmatter present" : "frontmatter missing",
    });

    for (const field of requiredOperatorTaskFields) {
      const present = Boolean(metadata?.[field]);
      checks.push({
        id: `operator-task:${taskName}:${field}`,
        ok: present,
        detail: present ? "metadata field present" : "metadata field missing",
      });
    }

    const taskId = metadata?.task_id;
    const matchingFilename = taskId === taskName;
    checks.push({
      id: `operator-task:${taskName}:filename`,
      ok: matchingFilename,
      detail: matchingFilename ? "task_id matches filename" : "task_id does not match filename",
    });

    const duplicate = taskId ? ids.has(taskId) : false;
    if (taskId) {
      ids.add(taskId);
    }
    checks.push({
      id: `operator-task:${taskName}:unique`,
      ok: !duplicate,
      detail: duplicate ? "duplicate task_id" : "task_id is unique",
    });

    const role = metadata?.primary_role;
    const rolePath = role ? path.join(rolesDir, `${role}.md`) : "";
    checks.push({
      id: `operator-task:${taskName}:role`,
      ok: Boolean(role && existsSync(rolePath)),
      detail: role && existsSync(rolePath) ? `role ${role} exists` : "primary role is missing",
    });

    const skill = metadata?.skill;
    const skillPath = skill ? path.join(root, "skills", skill, "SKILL.md") : "";
    checks.push({
      id: `operator-task:${taskName}:skill`,
      ok: Boolean(skill && existsSync(skillPath)),
      detail: skill && existsSync(skillPath) ? `skill ${skill} exists` : "skill reference is missing",
    });

    for (const heading of requiredOperatorTaskHeadings) {
      checks.push({
        id: `operator-task:${taskName}:${heading}`,
        ok: text.includes(heading),
        detail: text.includes(heading) ? "task section present" : "task section missing",
      });
    }

    checks.push({
      id: `operator-task:${taskName}:todos`,
      ok: !text.includes("TODO"),
      detail: !text.includes("TODO") ? "no TODO placeholders" : "TODO placeholder found",
    });
  }

  return checks;
}

function printOperatorTasks(): void {
  const taskFiles = listOperatorTaskFiles();
  console.log("Gauss satellite operator tasks");
  if (taskFiles.length === 0) {
    console.log("No operator task briefs detected.");
    return;
  }

  for (const file of taskFiles) {
    const metadata = operatorTaskMetadata(file);
    const taskId = metadata?.task_id || file.replace(/\.md$/, "");
    const stage = metadata?.stage || "unknown";
    const role = metadata?.primary_role || "unassigned";
    const skill = metadata?.skill || "unassigned";
    console.log(`- ${taskId} [${stage}] role=${role} skill=${skill}`);
  }
}

function handoffArtifactChecks(): Check[] {
  const handoffsDir = path.join(reportsContextDir, "handoffs");
  if (!existsSync(handoffsDir)) {
    return [{ id: "handoffs:directory", ok: true, detail: "no handoffs written yet" }];
  }

  const handoffs = readdirSync(handoffsDir).filter((entry) => entry.endsWith(".json"));
  const checks: Check[] = [
    {
      id: "handoffs:readable",
      ok: true,
      detail: `${handoffs.length} handoff artifact(s) detected`,
    },
  ];

  for (const handoff of handoffs) {
    try {
      const parsed = JSON.parse(readFileSync(path.join(handoffsDir, handoff), "utf8")) as Record<
        string,
        unknown
      >;
      for (const field of requiredHandoffFields) {
        checks.push({
          id: `handoff:${handoff}:${field}`,
          ok: Object.prototype.hasOwnProperty.call(parsed, field),
          detail: Object.prototype.hasOwnProperty.call(parsed, field)
            ? "field present"
            : "field missing",
        });
      }
    } catch (error) {
      checks.push({
        id: `handoff:${handoff}:parse`,
        ok: false,
        detail: error instanceof Error ? error.message : "failed to parse handoff",
      });
    }
  }

  return checks;
}

function structuralChecks(): Check[] {
  return [
    ...packageScriptsCheck(),
    ...markdownStructureCheck("development/memory/README.md", [
      "# Gauss Development Memory",
      "## File Contract",
      "## Update Rules",
    ]),
    ...markdownStructureCheck("development/memory/CURRENT.md", [
      "# Current System Memory",
      "## Start Context",
      "## Runtime Map",
      "## Resource Constraints",
    ]),
    ...markdownStructureCheck("development/memory/DECISIONS.md", [
      "# Durable Development Decisions",
      "## Decision Log",
    ]),
    ...markdownStructureCheck("development/memory/BACKLOG.md", [
      "# Evidence-Backed Improvement Backlog",
      "## Active Candidates",
    ]),
    ...handoffSchemaCheck(),
    ...roleChecks(),
    ...skillChecks(),
    ...operatorTaskChecks(),
    ...handoffArtifactChecks(),
  ];
}

function printChecks(checks: Check[]): void {
  let failed = 0;

  for (const check of checks) {
    const marker = check.ok ? "PASS" : "FAIL";
    console.log(`${marker} ${check.id} - ${check.detail}`);
    if (!check.ok) {
      failed += 1;
    }
  }

  console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
  if (failed > 0) {
    process.exitCode = 1;
  }
}

function usage(): void {
  console.log(`Usage: npm run develop:<command>

Commands:
  status          Print working-tree scope and recommended verification.
  brief           Write reports/context/continuous-development.latest.{md,json}.
  cleanup         Report disposable browser captures (dry run by default).
  exit            Apply bounded cleanup, refresh the capsule, and print scope.
  verify          Validate the development control plane.
  skills          Validate project skill sources.
  tasks           Validate and list satellite operator task briefs.
  task            Write a pending operator packet from a task brief.
  handoff         Write a JSON handoff artifact.

Handoff flags:
  --from <role> --to <role> --summary <text>
  [--scope "item;item"] [--verification "cmd;cmd"] [--risks "risk;risk"]
  [--memory-update <text>]

Task flags:
  --task <task-id> --satellite <satellite-id> --objective <text>
  [--priority informational|advisory|urgent|critical]
  [--mode observe|diagnose|plan|authorize|execute|handoff]
  [--state open|in_progress|blocked|complete|escalated]
`);
}

function main(): void {
  const command = process.argv[2] || "status";

  try {
    switch (command) {
      case "status":
        printStatus();
        break;
      case "brief":
        writeBrief();
        break;
      case "verify":
        printChecks(structuralChecks());
        break;
      case "skills":
        printChecks(skillChecks());
        break;
      case "tasks":
        printOperatorTasks();
        printChecks(operatorTaskChecks());
        break;
      case "task":
        writeOperatorTaskPacket();
        break;
      case "handoff":
        writeHandoff();
        break;
      case "help":
      case "--help":
      case "-h":
        usage();
        break;
      default:
        usage();
        process.exitCode = 1;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

main();
