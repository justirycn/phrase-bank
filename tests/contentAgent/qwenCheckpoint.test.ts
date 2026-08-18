// @vitest-environment node
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { generateSystemContent } from "../../scripts/content-agent/generator";
import { importQwenCheckpoint, loadQwenCheckpoint, sourceSha256 } from "../../scripts/content-agent/qwenCheckpoint";

const VERSION = "2026.08.3";
const execFileAsync = promisify(execFile);

function fixture() {
  const sourceContent = generateSystemContent();
  const phrases = sourceContent.phrases.slice(0, 1_220).map((phrase) => ({
    ...phrase,
    english: `${phrase.english} Reviewed.`,
    chinese: `${phrase.chinese} 已审校。`,
    contentVersion: VERSION,
    qualityVersion: "qwen-plus-review-v2",
  }));
  return { sourceContent, phrases };
}

async function checkpointFile(value: unknown, prefix = "phrase-bank-qwen-checkpoint-") {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  const path = join(directory, "checkpoint.json");
  await writeFile(path, `${JSON.stringify(value)}\n`, "utf8");
  return { directory, path };
}

describe("Qwen checkpoint validation", () => {
  it("accepts the real 1,220-phrase server prefix in legacy form and preserves its order and content", async () => {
    const { sourceContent, phrases } = fixture();
    const { path } = await checkpointFile({ version: VERSION, phrases });

    const checkpoint = await loadQwenCheckpoint({ path, version: VERSION, sourceContent });

    expect(checkpoint.phrases).toEqual(phrases);
    expect(checkpoint.phrases).toHaveLength(1_220);
  });

  it("accepts a current checkpoint with a deterministic immutable-source fingerprint", async () => {
    const { sourceContent, phrases } = fixture();
    const fingerprint = sourceSha256(sourceContent);
    const mutableCopy = structuredClone(sourceContent);
    mutableCopy.version = "different-version";
    mutableCopy.generatedAt = "2099-01-01T00:00:00.000Z";
    mutableCopy.qualityVersion = "different-quality";
    mutableCopy.phrases[0].english = "Different mutable English.";
    mutableCopy.phrases[0].chinese = "不同的可变中文。";
    mutableCopy.phrases[0].contentVersion = "different-version";
    mutableCopy.phrases[0].qualityVersion = "different-quality";
    const { path } = await checkpointFile({ version: VERSION, sourceSha256: fingerprint, phrases });

    expect(sourceSha256(mutableCopy)).toBe(fingerprint);
    await expect(loadQwenCheckpoint({ path, version: VERSION, sourceContent })).resolves.toMatchObject({ sourceSha256: fingerprint, phrases });
    const immutableCopy = structuredClone(sourceContent);
    immutableCopy.phrases[0].intent = "changed-intent";
    expect(sourceSha256(immutableCopy)).not.toBe(fingerprint);
  });

  it("rejects the wrong version, malformed phrases, duplicates, unknown IDs, immutable drift, and fingerprint mismatch", async () => {
    const { sourceContent, phrases } = fixture();
    const cases: Array<[string, unknown, RegExp]> = [
      ["wrong-version", { version: "2026.08.4", phrases }, /version/i],
      ["not-an-array", { version: VERSION, phrases: {} }, /phrases/i],
      ["malformed-phrase", { version: VERSION, phrases: [{ ...phrases[0], english: "" }] }, /phrase/i],
      ["malformed-version-fields", { version: VERSION, phrases: [{ ...phrases[0], contentVersion: 3, qualityVersion: "" }] }, /phrase/i],
      ["duplicate", { version: VERSION, phrases: [phrases[0], phrases[0]] }, /duplicate/i],
      ["unknown", { version: VERSION, phrases: [{ ...phrases[0], id: "unknown-id" }] }, /unknown/i],
      ["metadata-drift", { version: VERSION, phrases: [{ ...phrases[0], subcategory: "drifted" }] }, /metadata/i],
      ["fingerprint", { version: VERSION, sourceSha256: "0".repeat(64), phrases }, /fingerprint/i],
    ];

    for (const [name, value, message] of cases) {
      const { path } = await checkpointFile(value, `phrase-bank-qwen-${name}-`);
      await expect(loadQwenCheckpoint({ path, version: VERSION, sourceContent }), name).rejects.toThrow(message);
    }
  });
});

describe("Qwen checkpoint import", () => {
  it("validates before an atomic import, never changes the source, and is idempotent for identical content", async () => {
    const { sourceContent, phrases } = fixture();
    const source = (await checkpointFile({ version: VERSION, phrases }, "phrase-bank-qwen-import-source-")).path;
    const destinationRoot = await mkdtemp(join(tmpdir(), "phrase-bank-qwen-import-destination-"));
    const destination = join(destinationRoot, "nested", `checkpoint-${VERSION}.json`);
    const originalSource = await readFile(source, "utf8");

    const first = await importQwenCheckpoint({ source, destination, version: VERSION, sourceContent });
    const imported = await loadQwenCheckpoint({ path: destination, version: VERSION, sourceContent });
    const second = await importQwenCheckpoint({ source, destination, version: VERSION, sourceContent });

    expect(first).toEqual({ count: 1_220, destination });
    expect(second).toEqual(first);
    expect(imported).toMatchObject({ version: VERSION, sourceSha256: sourceSha256(sourceContent), phrases });
    expect(await readFile(source, "utf8")).toBe(originalSource);
    expect(await readdir(join(destinationRoot, "nested"))).toEqual([`checkpoint-${VERSION}.json`]);
  });

  it("refuses a different valid checkpoint and cleans pending files after validation or write failures", async () => {
    const { sourceContent, phrases } = fixture();
    const destinationRoot = await mkdtemp(join(tmpdir(), "phrase-bank-qwen-import-conflict-"));
    const destination = join(destinationRoot, `checkpoint-${VERSION}.json`);
    const firstSource = (await checkpointFile({ version: VERSION, phrases }, "phrase-bank-qwen-import-first-")).path;
    await importQwenCheckpoint({ source: firstSource, destination, version: VERSION, sourceContent });
    const originalDestination = await readFile(destination, "utf8");
    const conflicting = structuredClone(phrases);
    conflicting[0].english = "A different reviewed sentence.";
    const conflictingSource = (await checkpointFile({ version: VERSION, phrases: conflicting }, "phrase-bank-qwen-import-second-")).path;

    await expect(importQwenCheckpoint({ source: conflictingSource, destination, version: VERSION, sourceContent })).rejects.toThrow(/already exists|conflict/i);
    expect(await readFile(destination, "utf8")).toBe(originalDestination);
    expect(await readdir(destinationRoot)).not.toContain(`checkpoint-${VERSION}.json.pending`);

    const invalidDestination = join(destinationRoot, "invalid", `checkpoint-${VERSION}.json`);
    const invalidSource = (await checkpointFile({ version: VERSION, phrases: [{ ...phrases[0], id: "unknown" }] }, "phrase-bank-qwen-import-invalid-")).path;
    await expect(importQwenCheckpoint({ source: invalidSource, destination: invalidDestination, version: VERSION, sourceContent })).rejects.toThrow(/unknown/i);
    await expect(readdir(join(destinationRoot, "invalid"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("provides a required-argument CLI that reports only count and destination", async () => {
    const { phrases } = fixture();
    const directory = await mkdtemp(join(tmpdir(), "phrase-bank-qwen-import-cli-"));
    const source = join(directory, "server-checkpoint.json");
    await writeFile(source, `${JSON.stringify({ version: VERSION, phrases })}\n`, "utf8");
    const tsxCli = resolve("node_modules/tsx/dist/cli.mjs");
    const script = resolve("scripts/import-qwen-checkpoint.ts");

    const missing = execFileAsync(process.execPath, [tsxCli, script, "--source", source], { cwd: directory });
    await expect(missing).rejects.toMatchObject({ stderr: expect.stringMatching(/--version/) });
    const { stdout } = await execFileAsync(process.execPath, [tsxCli, script, "--version", VERSION, "--source", source], { cwd: directory });
    const destination = join(directory, ".content-agent", `checkpoint-${VERSION}.json`);

    expect(stdout.trim()).toBe(`Imported 1220 phrases to ${destination}`);
    expect(stdout).not.toContain(phrases[0].english);
    expect(JSON.parse(await readFile(resolve("package.json"), "utf8")).scripts["content:checkpoint:import"]).toBe("tsx scripts/import-qwen-checkpoint.ts");
  });
});
