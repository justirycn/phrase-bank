import { execFile as nodeExecFile } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { assertContentVersion } from "./content-agent/qwenCheckpoint";
import {
  assertSafeReleasePaths,
  loadApprovedRelease,
  runApprovedRelease,
  type ReleaseCommandExecutor,
} from "./content-agent/approvedRelease";
import { publishCandidate } from "./content-agent/publisher";

export interface ApprovedReleaseArguments { version: string }

type ExecFileResult = { stdout: string; stderr: string };
type ExecFileLike = (program: string, args: readonly string[], options: { encoding: "utf8"; windowsHide: true }) => Promise<ExecFileResult>;

interface CommandExecutorOptions {
  execFile?: ExecFileLike;
  npmExecPath?: string;
  nodeExecPath?: string;
}

interface OutputSnapshot { path: string; existed: boolean; contents?: Buffer }

interface ApprovedPublishSnapshot {
  candidatePath: string;
  reportPath: string;
  cleanup(): Promise<void>;
}

export function parseApprovedReleaseArguments(args: string[]): ApprovedReleaseArguments {
  if (args.length !== 2 || args[0] !== "--version" || !args[1]) throw new Error("Exactly --version YYYY.MM.N is required");
  return { version: assertContentVersion(args[1]) };
}

export function createReleaseCommandExecutor(options: CommandExecutorOptions = {}): ReleaseCommandExecutor {
  const execFile = options.execFile ?? (promisify(nodeExecFile) as unknown as ExecFileLike);
  return async (...command: string[]) => {
    const [program, ...args] = command;
    if (!program) throw new Error("Release command is empty");
    if (program === "npm") {
      const npmCli = Object.hasOwn(options, "npmExecPath") ? options.npmExecPath : process.env.npm_execpath;
      if (!npmCli) throw new Error("Cannot locate npm CLI; run through npm run content:release:approved");
      return (await execFile(options.nodeExecPath ?? process.execPath, [npmCli, ...args], { encoding: "utf8", windowsHide: true })).stdout;
    }
    return (await execFile(program, args, { encoding: "utf8", windowsHide: true })).stdout;
  };
}

export async function createApprovedPublishSnapshot(options: { directory: string; candidateRaw: string; report: unknown }): Promise<ApprovedPublishSnapshot> {
  const root = await mkdtemp(join(options.directory, ".approved-publish-snapshot-"));
  const candidatePath = join(root, "candidate.json");
  const reportPath = join(root, "report.json");
  try {
    await writeFile(candidatePath, options.candidateRaw, { encoding: "utf8", flag: "wx" });
    await writeFile(reportPath, `${JSON.stringify(options.report)}\n`, { encoding: "utf8", flag: "wx" });
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
  let cleanup: Promise<void> | undefined;
  return { candidatePath, reportPath, cleanup: () => cleanup ??= rm(root, { recursive: true, force: true }) };
}

async function snapshotOutputs(paths: readonly string[]): Promise<OutputSnapshot[]> {
  return Promise.all(paths.map(async (path) => {
    try {
      const metadata = await lstat(path);
      if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error("Release output is not a safe regular file");
      return { path, existed: true, contents: await readFile(path) };
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return { path, existed: false };
      throw error;
    }
  }));
}

async function restoreOutputs(snapshots: readonly OutputSnapshot[]): Promise<void> {
  for (const snapshot of snapshots) {
    if (snapshot.existed) {
      await mkdir(dirname(snapshot.path), { recursive: true });
      await writeFile(snapshot.path, snapshot.contents!);
    } else {
      try { await unlink(snapshot.path); }
      catch (error) { if (!(typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT")) throw error; }
    }
  }
}

export async function runApprovedReleaseCli(
  args = process.argv.slice(2),
  dependencies: { repositoryRoot?: string; execute?: ReleaseCommandExecutor } = {},
): Promise<void> {
  const { version } = parseApprovedReleaseArguments(args);
  const repositoryRoot = resolve(dependencies.repositoryRoot ?? process.cwd());
  const candidatePath = resolve(repositoryRoot, `.content-agent/candidate-${version}.json`);
  const reportPath = resolve(repositoryRoot, `.content-agent/report-${version}.json`);
  const reviewPath = resolve(repositoryRoot, `.content-agent/review-${version}.json`);
  const publicDir = resolve(repositoryRoot, "public/content");
  const destination = resolve(publicDir, `system-content-${version}.json`);
  const versionModulePath = resolve(repositoryRoot, "app/domain/bundledSystemContent.ts");
  await assertSafeReleasePaths(repositoryRoot, [
    { path: candidatePath, kind: "file" },
    { path: reportPath, kind: "file" },
    { path: reviewPath, kind: "file" },
    { path: destination, kind: "output" },
    { path: versionModulePath, kind: "output" },
  ]);
  const snapshots = await snapshotOutputs([destination, versionModulePath]);
  let loaded: Awaited<ReturnType<typeof loadApprovedRelease>> | undefined;
  let approvedSnapshot: ApprovedPublishSnapshot | undefined;
  try {
    await runApprovedRelease({
      version,
      repositoryRoot,
      execute: dependencies.execute ?? createReleaseCommandExecutor(),
      validate: async () => {
        loaded = await loadApprovedRelease({ version, candidatePath, reportPath, reviewPath });
        approvedSnapshot = await createApprovedPublishSnapshot({ directory: dirname(candidatePath), candidateRaw: loaded.candidateRaw, report: loaded.report });
      },
      publish: async () => {
        if (!loaded || !approvedSnapshot) throw new Error("Approval validation must complete before publishing");
        await assertSafeReleasePaths(repositoryRoot, [{ path: destination, kind: "output" }, { path: versionModulePath, kind: "output" }]);
        await publishCandidate({ version, candidatePath: approvedSnapshot.candidatePath, reportPath: approvedSnapshot.reportPath, publicDir, versionModulePath });
      },
      rollback: () => restoreOutputs(snapshots),
    });
  } finally {
    await approvedSnapshot?.cleanup();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await runApprovedReleaseCli();
