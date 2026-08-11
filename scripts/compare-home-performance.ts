import "fake-indexeddb/auto";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { runHomeDataBenchmark } from "../tests/support/homeDataBenchmark";
import { stopChildProcess } from "./processLifecycle";
import { assertCleanAppTree } from "./performanceEvidenceGuard";
import { analyzeStartupSource, type StartupSourceMetrics } from "./startupDependencyMetrics";

const baselineRef = "3e20260";
const projectRoot = process.cwd();
const shortTempRoot = "C:\\Temp";
const appStatus = execFileSync("git", ["status", "--porcelain", "--untracked-files=all", "--", "app"], { cwd: projectRoot, encoding: "utf8" });
assertCleanAppTree(appStatus);

const vinextCli = join(projectRoot, "node_modules/vinext/dist/cli.js");
function parseDefaultExport(path: string) {
  return JSON.parse(readFileSync(path, "utf8").trim().replace(/^export default\s+/, "").replace(/;$/, ""));
}
function normalize(file: string) { return file.replaceAll("\\", "/").replace(/^\//, ""); }
function sizes(root: string, current = root, output: Record<string, number> = {}) {
  for (const name of readdirSync(current)) {
    const path = join(current, name); const item = statSync(path);
    if (item.isDirectory()) sizes(root, path, output);
    else output[normalize(relative(root, path))] = item.size;
  }
  return output;
}
function buildMetrics(root: string) {
  const client = parseDefaultExport(join(root, "dist/server/vinext-client-assets.js"));
  const rsc = parseDefaultExport(join(root, "dist/server/__vite_rsc_assets_manifest.js"));
  const allSizes = sizes(join(root, "dist/client"));
  const homeChunk = (client.dynamicPreloads["app/PhraseBankApp.tsx"] as string[]).map(normalize)
    .find((file) => basename(file).startsWith("PhraseBankApp-"));
  if (!homeChunk || allSizes[homeChunk] === undefined) throw new Error("Missing PhraseBankApp build asset");
  const reference = Object.values(rsc.clientReferenceDeps as Record<string, { js?: string[] }>)
    .find(({ js = [] }) => js.map(normalize).includes(homeChunk));
  if (!reference) throw new Error("Missing PhraseBankApp client reference");
  const bootstrap = (rsc.bootstrapScriptContent as string | undefined)?.match(/import\(["']\/([^"']+\.js)["']\)/)?.[1];
  const initial = [...new Set([...(reference.js ?? []), ...(client.appBootstrapPreinitModules ?? []), ...(bootstrap ? [bootstrap] : [])].map(normalize))];
  for (const file of initial) if (allSizes[file] === undefined) throw new Error(`Missing initial asset ${file}`);
  return { homeChunkBytes: allSizes[homeChunk], initialJavaScriptBytes: initial.reduce((sum, file) => sum + allSizes[file], 0) };
}
async function htmlBytes(root: string, port: number) {
  let server: ChildProcess | undefined;
  try {
    server = spawn(process.execPath, [vinextCli, "start", "--port", String(port)], { cwd: root, stdio: "ignore" });
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/`);
        if (response.ok) return new Uint8Array(await response.arrayBuffer()).byteLength;
      } catch { /* server is still starting */ }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`Production server on ${port} did not become ready`);
  } finally {
    if (server) await stopChildProcess(server);
  }
}
async function measureBuild(root: string, port: number) {
  execFileSync(process.execPath, [vinextCli, "build"], { cwd: root, stdio: "ignore" });
  return { ...buildMetrics(root), htmlBytes: await htmlBytes(root, port) };
}

interface ComparisonReport {
  generatedByRunner: true;
  command: string;
  baseline: {
    sha: string; sourceTree: string; build: Awaited<ReturnType<typeof measureBuild>>;
    startupSource: StartupSourceMetrics & { note: string };
    homeDataBenchmark: { available: false; reason: string };
  };
  current: {
    sha: string; sourceTree: string; build: Awaited<ReturnType<typeof measureBuild>>;
    startupSource: StartupSourceMetrics;
    homeDataBenchmark: Awaited<ReturnType<typeof runHomeDataBenchmark>>;
  };
  cleanup: {
    tempRoot: string; dependencyJunctionRemoved: boolean; tempDirectoryRemoved: boolean;
    verifiedResidueCount?: number; worktreeRegistrationCreated?: boolean;
  };
}

mkdirSync(shortTempRoot, { recursive: true });
const preexistingTempDirectories = readdirSync(shortTempRoot).filter((name) => name.startsWith("phb-"));
if (preexistingTempDirectories.length) throw new Error(`Refusing to run with pre-existing comparison directories: ${preexistingTempDirectories.join(", ")}`);
const temp = mkdtempSync(join(shortTempRoot, "phb-"));
const baselineRoot = join(temp, "src");
const archive = join(temp, "baseline.tar");
let dependencyLinkCreated = false;
let report: ComparisonReport | undefined;
let runError: unknown;
let cleanupError: unknown;
try {
  mkdirSync(baselineRoot);
  const baselineSha = execFileSync("git", ["rev-parse", baselineRef], { cwd: projectRoot, encoding: "utf8" }).trim();
  const baselineSourceTree = execFileSync("git", ["rev-parse", `${baselineSha}:app`], { cwd: projectRoot, encoding: "utf8" }).trim();
  execFileSync("git", ["archive", "--format=tar", `--output=${archive}`, baselineSha], { cwd: projectRoot });
  execFileSync("tar", ["-xf", archive, "-C", baselineRoot]);
  unlinkSync(archive);
  symlinkSync(join(projectRoot, "node_modules"), join(baselineRoot, "node_modules"), "junction");
  dependencyLinkCreated = true;
  const baselineBuild = await measureBuild(baselineRoot, 4281);
  const currentBuild = await measureBuild(projectRoot, 4282);
  const currentBenchmark = await runHomeDataBenchmark();
  const currentSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: projectRoot, encoding: "utf8" }).trim();
  const currentSourceTree = execFileSync("git", ["rev-parse", "HEAD:app"], { cwd: projectRoot, encoding: "utf8" }).trim();
  report = {
    generatedByRunner: true,
    command: "npm run benchmark:home-before-after",
    baseline: {
      sha: baselineSha, sourceTree: baselineSourceTree, build: baselineBuild,
      startupSource: { ...analyzeStartupSource(baselineRoot), note: "Counted only exportSnapshot call sites inside startup refresh/loadHomeData functions reachable through the eager startup dependency graph; inline Settings export actions are excluded." },
      homeDataBenchmark: { available: false, reason: "Baseline predates the production loadHomeData benchmark boundary and its repository API/fixture contract is not equivalent, so bounded rows and service-ready duration are unavailable." },
    },
    current: { sha: currentSha, sourceTree: currentSourceTree, build: currentBuild, startupSource: analyzeStartupSource(projectRoot), homeDataBenchmark: currentBenchmark },
    cleanup: { tempRoot: shortTempRoot, dependencyJunctionRemoved: true, tempDirectoryRemoved: true },
  };
} catch (error) {
  runError = error;
} finally {
  try {
    const link = join(baselineRoot, "node_modules");
    if (dependencyLinkCreated && existsSync(link)) {
      if (!lstatSync(link).isSymbolicLink()) cleanupError = new Error(`Refusing to remove non-link dependency path: ${link}`);
      else unlinkSync(link);
    }
    const resolvedPrefix = `${shortTempRoot}\\phb-`;
    if (!temp.startsWith(resolvedPrefix)) cleanupError = new Error(`Refusing to clean unexpected temp path: ${temp}`);
    if (!cleanupError) {
      rmSync(temp, { recursive: true });
      if (existsSync(temp)) cleanupError = new Error(`Temporary comparison directory was not removed: ${temp}`);
    }
  } catch (error) {
    cleanupError = error;
  }
}
if (cleanupError) throw cleanupError;
if (runError) throw runError;
if (!report) throw new Error("Comparison completed without a report");
const verifiedResidueCount = readdirSync(shortTempRoot).filter((name) => name.startsWith("phb-")).length;
const worktreeList = execFileSync("git", ["worktree", "list", "--porcelain"], { cwd: projectRoot, encoding: "utf8" });
report.cleanup.verifiedResidueCount = verifiedResidueCount;
report.cleanup.worktreeRegistrationCreated = worktreeList.replaceAll("/", "\\").toLowerCase().includes(temp.toLowerCase());
if (verifiedResidueCount !== 0) throw new Error(`Comparison left ${verifiedResidueCount} phb-* temporary directories`);
if (report.cleanup.worktreeRegistrationCreated) throw new Error(`Comparison left a Git worktree registration for ${temp}`);
if (process.argv.includes("--write")) {
  const metricsPath = join(projectRoot, "docs/audits/home-heatmap-performance/metrics.json");
  const metrics = JSON.parse(readFileSync(metricsPath, "utf8"));
  metrics.beforeAfter = report;
  metrics.build.before = { sha: report.baseline.sha, ...report.baseline.build };
  metrics.build.current = { ...metrics.build.current, ...report.current.build };
  metrics.homeDataBenchmark = { ...metrics.homeDataBenchmark, ...report.current.homeDataBenchmark };
  const pendingPath = `${metricsPath}.pending`;
  writeFileSync(pendingPath, `${JSON.stringify(metrics, null, 2)}\n`, "utf8");
  renameSync(pendingPath, metricsPath);
}
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
