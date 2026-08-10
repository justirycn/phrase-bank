import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { generateSystemContent } from "../../scripts/content-agent/generator";
import { inspectSystemContent } from "../../scripts/content-agent/qualityGate";
import { publishCandidate } from "../../scripts/content-agent/publisher";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "phrase-bank-publish-"));
  const publicDir = join(root, "public", "content");
  const candidatePath = join(root, "candidate.json");
  const reportPath = join(root, "report.json");
  const versionModulePath = join(root, "bundledSystemContent.ts");
  await mkdir(publicDir, { recursive: true });
  const content = generateSystemContent();
  const version = "2026.08.2";
  const qualityVersion = "qwen-plus-review-v1";
  const candidate = { ...content, version, qualityVersion, phrases: content.phrases.map((phrase) => ({ ...phrase, contentVersion: version, qualityVersion })) };
  const report = { status: "pass", version, ...inspectSystemContent(candidate) };
  const candidateRaw = `${JSON.stringify(candidate, null, 2)}\n`;
  await writeFile(candidatePath, candidateRaw);
  await writeFile(reportPath, `${JSON.stringify(report)}\n`);
  await writeFile(versionModulePath, 'export const BUNDLED_SYSTEM_CONTENT_VERSION = "old";\n');
  return { root, publicDir, candidatePath, reportPath, versionModulePath, version, candidateRaw };
}

describe("Qwen content publisher", () => {
  it("publishes a complete passing candidate and updates the shared version", async () => {
    const files = await fixture();
    await publishCandidate(files);
    expect(await readFile(join(files.publicDir, `system-content-${files.version}.json`), "utf8")).toBe(files.candidateRaw);
    expect(await readFile(files.versionModulePath, "utf8")).toBe(`export const BUNDLED_SYSTEM_CONTENT_VERSION = "${files.version}";\n`);
  });

  it("leaves destinations unchanged when the report or candidate is invalid", async () => {
    const files = await fixture();
    const destination = join(files.publicDir, `system-content-${files.version}.json`);
    await writeFile(destination, "old-content\n");
    await writeFile(files.reportPath, JSON.stringify({ status: "fail", version: files.version }));
    await expect(publishCandidate(files)).rejects.toThrow("质检报告未通过");
    expect(await readFile(destination, "utf8")).toBe("old-content\n");
    expect(await readFile(files.versionModulePath, "utf8")).toContain('"old"');

    const invalid = await fixture();
    await writeFile(invalid.candidatePath, "{}\n");
    await expect(publishCandidate(invalid)).rejects.toThrow();
    expect(await readFile(invalid.versionModulePath, "utf8")).toContain('"old"');
  });
});
