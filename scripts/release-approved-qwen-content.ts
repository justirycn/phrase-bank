import { execFile as nodeExecFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, mkdtemp, open, readFile, realpath, rename, rm, unlink, writeFile } from "node:fs/promises";
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
type ExecFileLike = (program: string, args: readonly string[], options: { encoding: "utf8"; windowsHide: true; maxBuffer: number }) => Promise<ExecFileResult>;

interface CommandExecutorOptions {
  execFile?: ExecFileLike;
  npmExecPath?: string;
  nodeExecPath?: string;
}

interface OutputSnapshot { path: string; existed: boolean; contents?: Buffer }

interface ApprovedPublishSnapshot {
  candidatePath: string;
  reportPath: string;
  hooksPath: string;
  cleanup(): Promise<void>;
}

export function parseApprovedReleaseArguments(args: string[]): ApprovedReleaseArguments {
  if (args.length !== 2 || args[0] !== "--version" || !args[1]) throw new Error("Exactly --version YYYY.MM.N is required");
  return { version: assertContentVersion(args[1]) };
}

export function createReleaseCommandExecutor(options: CommandExecutorOptions = {}): ReleaseCommandExecutor {
  const execFile = options.execFile ?? (promisify(nodeExecFile) as unknown as ExecFileLike);
  const executionOptions = { encoding: "utf8" as const, windowsHide: true as const, maxBuffer: 32 * 1024 * 1024 };
  return async (...command: string[]) => {
    const [program, ...args] = command;
    if (!program) throw new Error("Release command is empty");
    if (program === "npm") {
      const npmCli = Object.hasOwn(options, "npmExecPath") ? options.npmExecPath : process.env.npm_execpath;
      if (!npmCli) throw new Error("Cannot locate npm CLI; run through npm run content:release:approved");
      return (await execFile(options.nodeExecPath ?? process.execPath, [npmCli, ...args], executionOptions)).stdout;
    }
    return (await execFile(program, args, executionOptions)).stdout;
  };
}

export async function createApprovedPublishSnapshot(options: { directory: string; candidateRaw: string; report: unknown }): Promise<ApprovedPublishSnapshot> {
  const root = await mkdtemp(join(options.directory, ".approved-publish-snapshot-"));
  const candidatePath = join(root, "candidate.json");
  const reportPath = join(root, "report.json");
  const hooksPath = join(root, "disabled-hooks");
  try {
    await mkdir(hooksPath);
    await writeFile(candidatePath, options.candidateRaw, { encoding: "utf8", flag: "wx" });
    await writeFile(reportPath, `${JSON.stringify(options.report)}\n`, { encoding: "utf8", flag: "wx" });
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
  let cleanup: Promise<void> | undefined;
  return { candidatePath, reportPath, hooksPath, cleanup: () => cleanup ??= rm(root, { recursive: true, force: true }) };
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

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function gitBlobOid(bytes: Buffer): string {
  return createHash("sha1").update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest("hex");
}

async function validateOwnedOutputs(repositoryRoot: string, owned: ReadonlyMap<string, string>): Promise<void> {
  await assertSafeReleasePaths(repositoryRoot, [...owned.keys()].map((path) => ({ path, kind: "output" as const })));
  for (const [path, expectedHash] of owned) {
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error("Refusing cleanup of a non-regular release output");
    if (sha256(await readFile(path)) !== expectedHash) throw new Error("Refusing cleanup because a release output drifted");
  }
}

async function restoreOutputs(repositoryRoot: string, snapshots: readonly OutputSnapshot[], owned: Map<string, string>): Promise<void> {
  await validateOwnedOutputs(repositoryRoot, owned);
  for (const snapshot of snapshots) {
    await validateOwnedOutputs(repositoryRoot, owned);
    if (snapshot.existed) {
      const temporary = join(dirname(snapshot.path), `.approved-release-restore-${randomUUID()}.tmp`);
      let handle: Awaited<ReturnType<typeof open>> | undefined;
      try {
        handle = await open(temporary, "wx", 0o600);
        await handle.writeFile(snapshot.contents!);
        await handle.sync();
        await handle.close();
        handle = undefined;
        await validateOwnedOutputs(repositoryRoot, owned);
        await rename(temporary, snapshot.path);
      } finally {
        await handle?.close().catch(() => undefined);
        await rm(temporary, { force: true });
      }
    } else {
      await validateOwnedOutputs(repositoryRoot, owned);
      await unlink(snapshot.path);
    }
    owned.delete(snapshot.path);
  }
}

export async function runApprovedReleaseCli(
  args = process.argv.slice(2),
  dependencies: { repositoryRoot?: string; execute?: ReleaseCommandExecutor } = {},
): Promise<void> {
  const { version } = parseApprovedReleaseArguments(args);
  const repositoryRoot = await realpath(resolve(dependencies.repositoryRoot ?? process.cwd()));
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
  const ownedOutputs = new Map<string, string>();
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
        const candidateBytes = Buffer.from(loaded.candidateRaw, "utf8");
        const moduleBytes = Buffer.from(`export const BUNDLED_SYSTEM_CONTENT_VERSION = "${version}";\n`, "utf8");
        ownedOutputs.set(destination, sha256(candidateBytes));
        ownedOutputs.set(versionModulePath, sha256(moduleBytes));
        await publishCandidate({ version, candidatePath: approvedSnapshot.candidatePath, reportPath: approvedSnapshot.reportPath, publicDir, versionModulePath });
        return {
          [`public/content/system-content-${version}.json`]: gitBlobOid(candidateBytes),
          "app/domain/bundledSystemContent.ts": gitBlobOid(moduleBytes),
        };
      },
      validateRollback: () => validateOwnedOutputs(repositoryRoot, ownedOutputs),
      rollback: () => restoreOutputs(repositoryRoot, snapshots, ownedOutputs),
      hooksPath: () => {
        if (!approvedSnapshot) throw new Error("Approved publish snapshot is unavailable for hook isolation");
        return approvedSnapshot.hooksPath;
      },
    });
  } finally {
    await approvedSnapshot?.cleanup();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await runApprovedReleaseCli();
