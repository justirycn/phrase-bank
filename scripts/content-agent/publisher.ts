import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { validateSystemContentPackage } from "../../app/domain/systemContent";
import type { SystemContentPackage } from "../../app/domain/types";
import { inspectSystemContent } from "./qualityGate";

interface PublishOptions {
  candidatePath: string;
  reportPath: string;
  publicDir: string;
  versionModulePath: string;
  version: string;
}

interface QualityReport { status?: string; version?: string; errors?: unknown[]; coreCount?: number; totalCount?: number; }

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
  const candidateTemp = `${destination}.tmp`;
  const moduleTemp = `${options.versionModulePath}.tmp`;
  try {
    await writeFile(candidateTemp, candidateRaw, "utf8");
    await writeFile(moduleTemp, `export const BUNDLED_SYSTEM_CONTENT_VERSION = "${options.version}";\n`, "utf8");
    await rename(candidateTemp, destination);
    await rename(moduleTemp, options.versionModulePath);
  } finally {
    await Promise.all([rm(candidateTemp, { force: true }), rm(moduleTemp, { force: true })]);
  }
  return { destination, version: options.version };
}
