import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  runLocalModelWireupCycle,
  writeLocalModelWireupReport,
} from "../learning/local-model-wireup-cycle.js";

function argValue(flag: string): string | null {
  const index = process.argv.indexOf(flag);
  if (index === -1) return null;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) return null;
  return value;
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

async function main(): Promise<void> {
  const jsonOut = argValue("--json-out") ?? "reports/progress/local-model-wireup.latest.json";
  const explicitModelSelfAssessment = hasFlag("--allow-model");
  const report = await runLocalModelWireupCycle({
    explicitModelSelfAssessment,
  });
  const absoluteOut = writeLocalModelWireupReport(report, jsonOut);

  console.log(
    JSON.stringify(
      {
        verdict: report.verdict,
        mode: report.mode,
        selectedHypothesisId: report.selectedHypothesisId,
        memoryLevel: report.memory.level,
        configuredEndpointOk: report.probes.configured?.ok ?? false,
        jsonOut: absoluteOut,
        recommendedActions: report.recommendedActions,
      },
      null,
      2,
    ),
  );
}

const isMain = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;

if (isMain) {
  void main();
}
