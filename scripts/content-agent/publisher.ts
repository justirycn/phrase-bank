import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, rename, rm, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { validateSystemContentPackage } from "../../app/domain/systemContent";
import type { SystemContentPackage } from "../../app/domain/types";
import { inspectSystemContent } from "./qualityGate";

interface PublishOptions {
  candidatePath: string;
  reportPath: string;
  publicDir: string;
  versionModulePath: string;
  version: string;
  fileOperations?: { rename?: typeof rename };
}

interface QualityReport { status?: string; version?: string; errors?: unknown[]; coreCount?: number; totalCount?: number; }

interface TargetSnapshot { path: string; existed: boolean; contents?: Buffer }

function hasCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

async function snapshotTarget(path: string): Promise<TargetSnapshot> {
  try {
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error("发布目标不是安全的普通文件");
    return { path, existed: true, contents: await readFile(path) };
  } catch (error) {
    if (hasCode(error, "ENOENT")) return { path, existed: false };
    throw error;
  }
}

async function assertSnapshotUnchanged(snapshot: TargetSnapshot): Promise<void> {
  const current = await snapshotTarget(snapshot.path);
  if (current.existed !== snapshot.existed || (current.existed && !current.contents?.equals(snapshot.contents!))) {
    throw new Error("发布目标在提交前发生变化");
  }
}

async function assertOwnedFile(path: string, contents: Buffer): Promise<void> {
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink() || !(await readFile(path)).equals(contents)) {
    throw new Error("拒绝恢复已被其他操作修改的发布目标");
  }
}

async function restoreOwnedTarget(snapshot: TargetSnapshot, ownedContents: Buffer, atomicReplace: typeof rename): Promise<void> {
  await assertOwnedFile(snapshot.path, ownedContents);
  if (!snapshot.existed) {
    await unlink(snapshot.path);
    return;
  }
  const restoreTemp = join(dirname(snapshot.path), `.publish-restore-${randomUUID()}.tmp`);
  try {
    await writeFile(restoreTemp, snapshot.contents!, { flag: "wx" });
    await assertOwnedFile(snapshot.path, ownedContents);
    await atomicReplace(restoreTemp, snapshot.path);
  } finally {
    await rm(restoreTemp, { force: true });
  }
}

export async function publishCandidate(options: PublishOptions) {
  const report = JSON.parse(await readFile(options.reportPath, "utf8")) as QualityReport;
  if (report.status !== "pass" || report.version !== options.version || report.errors?.length || report.coreCount !== 600 || report.totalCount !== 2000) {
    throw new Error("质检报告未通过或与候选版本不一致");
  }
  const candidateRaw = await readFile(options.candidatePath, "utf8");
  const candidate = validateSystemContentPackage(JSON.parse(candidateRaw) as SystemContentPackage);
  if (candidate.version !== options.version) throw new Error("候选内容版本不一致");
  const inspection = inspectSystemContent(candidate);
  if (inspection.errors.length) throw new Error(`候选内容未通过质量门：${inspection.errors[0]}`);

  await mkdir(options.publicDir, { recursive: true });
  const destination = join(options.publicDir, `system-content-${options.version}.json`);
  const candidateBytes = Buffer.from(candidateRaw, "utf8");
  const moduleBytes = Buffer.from(`export const BUNDLED_SYSTEM_CONTENT_VERSION = "${options.version}";\n`, "utf8");
  const candidateSnapshot = await snapshotTarget(destination);
  const moduleSnapshot = await snapshotTarget(options.versionModulePath);
  const candidateTemp = join(dirname(destination), `.publish-candidate-${randomUUID()}.tmp`);
  const moduleTemp = join(dirname(options.versionModulePath), `.publish-module-${randomUUID()}.tmp`);
  const atomicReplace = options.fileOperations?.rename ?? rename;
  let candidateCommitted = false;
  try {
    await writeFile(candidateTemp, candidateBytes, { flag: "wx" });
    await writeFile(moduleTemp, moduleBytes, { flag: "wx" });
    await assertSnapshotUnchanged(candidateSnapshot);
    await assertSnapshotUnchanged(moduleSnapshot);
    await atomicReplace(candidateTemp, destination);
    candidateCommitted = true;
    await assertSnapshotUnchanged(moduleSnapshot);
    await atomicReplace(moduleTemp, options.versionModulePath);
  } catch (error) {
    if (candidateCommitted) {
      try { await restoreOwnedTarget(candidateSnapshot, candidateBytes, atomicReplace); }
      catch (rollbackError) { throw new AggregateError([error, rollbackError], "发布失败且无法安全恢复第一个输出"); }
    }
    throw error;
  } finally {
    await Promise.all([rm(candidateTemp, { force: true }), rm(moduleTemp, { force: true })]);
  }
  return { destination, version: options.version };
}
