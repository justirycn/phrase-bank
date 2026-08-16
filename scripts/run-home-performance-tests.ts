import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const files = [
  "tests/deployment/homePerformance.test.ts",
  "tests/deployment/homeAuditArtifacts.test.ts",
  "tests/deployment/homeBeforeAfter.test.ts",
  "tests/support/homeBuildPerformance.test.ts",
  "tests/support/homeDataBenchmark.test.ts",
  "tests/support/processLifecycle.test.ts",
  "tests/support/performanceEvidenceGuard.test.ts",
  "tests/support/startupDependencyMetrics.test.ts",
  "tests/support/performanceGateIsolation.test.ts",
  "tests/support/gitEvidence.test.ts",
];
const vitestEntry = fileURLToPath(import.meta.resolve("vitest"));
const vitestCli = join(dirname(dirname(vitestEntry)), "vitest.mjs");
const result = spawnSync(process.execPath, [vitestCli, "run", ...files], {
  cwd: process.cwd(), stdio: "inherit", env: { ...process.env, HOME_PERFORMANCE_BUILD: "1" },
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
