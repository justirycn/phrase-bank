import { lstat, mkdtemp, mkdir, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
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

  it("atomically restores the first output when the second rename fails and permits a clean retry", async () => {
    const files = await fixture();
    const destination = join(files.publicDir, `system-content-${files.version}.json`);
    await writeFile(destination, "previous candidate\n");
    let renames = 0;
    await expect(publishCandidate({
      ...files,
      fileOperations: {
        rename: async (source, target) => {
          renames += 1;
          if (renames === 2) throw new Error("simulated second rename failure");
          await rename(source, target);
        },
      },
    })).rejects.toThrow(/second rename failure/i);
    expect(await readFile(destination, "utf8")).toBe("previous candidate\n");
    expect(await readFile(files.versionModulePath, "utf8")).toContain('"old"');
    expect((await lstat(destination)).isSymbolicLink()).toBe(false);

    await publishCandidate(files);
    expect(await readFile(destination, "utf8")).toBe(files.candidateRaw);
    expect(await readFile(files.versionModulePath, "utf8")).toContain(`"${files.version}"`);
  });

  it("refuses to overwrite third-party file or symlink drift during rollback", async () => {
    for (const mode of ["file", "symlink"] as const) {
      const files = await fixture();
      const destination = join(files.publicDir, `system-content-${files.version}.json`);
      const outside = join(files.root, "outside.txt");
      await writeFile(outside, "outside bytes\n");
      let renames = 0;
      await expect(publishCandidate({
        ...files,
        fileOperations: {
          rename: async (source, target) => {
            renames += 1;
            if (renames === 1) { await rename(source, target); return; }
            if (renames === 2) {
              await rm(destination, { force: true });
              if (mode === "file") await writeFile(destination, "third-party bytes\n");
              else await symlink(outside, destination, "file");
              throw new Error("simulated second rename failure");
            }
            await rename(source, target);
          },
        },
      })).rejects.toThrow(/无法安全恢复/);
      if (mode === "file") expect(await readFile(destination, "utf8")).toBe("third-party bytes\n");
      else expect((await lstat(destination)).isSymbolicLink()).toBe(true);
      expect(await readFile(outside, "utf8")).toBe("outside bytes\n");
      expect(await readFile(files.versionModulePath, "utf8")).toContain('"old"');
    }
  });
});
