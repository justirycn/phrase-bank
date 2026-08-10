import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { generateSystemContent } from "../../scripts/content-agent/generator";
import { buildQwenCandidate, runQwenAgent } from "../../scripts/content-agent/qwenPipeline";
import type { QwenClient } from "../../scripts/content-agent/qwenClient";

const categories = ["daily", "travel", "work", "business", "supply-chain", "social"] as const;
const quotas = { daily: 180, travel: 100, work: 120, business: 100, "supply-chain": 70, social: 30 };

function responseQueue(reviewStatus: "pass" | "fail" = "pass") {
  const source = generateSystemContent();
  return categories.flatMap((category) => {
    const phrases = source.phrases.filter((phrase) => phrase.categoryId === category).map((phrase) => ({
      ...phrase,
      contentVersion: "2026.08.2",
      qualityVersion: "qwen-plus-review-v1",
    }));
    return [JSON.stringify({ phrases }), JSON.stringify({ status: reviewStatus, issues: reviewStatus === "pass" ? [] : ["unnatural"], phrases })];
  });
}

function fakeClient(outputs: string[]): QwenClient {
  return { complete: vi.fn(async () => {
    const output = outputs.shift();
    if (!output) throw new Error("unexpected request");
    return output;
  }) };
}

describe("Qwen content pipeline", () => {
  it("generates and independently reviews all six exact category batches", async () => {
    const client = fakeClient(responseQueue());
    const result = await buildQwenCandidate({ client, version: "2026.08.2", generatedAt: "2026-08-10T00:00:00.000Z", qualityVersion: "qwen-plus-review-v1" });

    expect(result.phrases.filter(({ kind }) => kind === "core")).toHaveLength(600);
    expect(result.phrases).toHaveLength(2000);
    for (const category of categories) expect(result.phrases.filter((phrase) => phrase.categoryId === category && phrase.kind === "core")).toHaveLength(quotas[category]);
    expect(client.complete).toHaveBeenCalledTimes(12);
    const calls = vi.mocked(client.complete).mock.calls;
    expect(calls[0][0].map(({ content }) => content).join(" ")).toContain("daily");
    expect(calls[1][0][0].content).toContain("独立审校");
    expect(calls[1][0]).not.toBe(calls[0][0]);
  });

  it("accepts a single JSON markdown fence but rejects review failures", async () => {
    const fenced = responseQueue();
    fenced[0] = `\`\`\`json\n${fenced[0]}\n\`\`\``;
    await expect(buildQwenCandidate({ client: fakeClient(fenced), version: "2026.08.2", generatedAt: "2026-08-10T00:00:00.000Z", qualityVersion: "qwen-plus-review-v1" })).resolves.toMatchObject({ version: "2026.08.2" });

    await expect(buildQwenCandidate({ client: fakeClient(responseQueue("fail")), version: "2026.08.2", generatedAt: "2026-08-10T00:00:00.000Z", qualityVersion: "qwen-plus-review-v1" })).rejects.toThrow("审校未通过");
  });

  it("writes candidate and passing report only after the complete pipeline succeeds", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "phrase-bank-qwen-"));
    const paths = await runQwenAgent({ client: fakeClient(responseQueue()), version: "2026.08.2", generatedAt: "2026-08-10T00:00:00.000Z", qualityVersion: "qwen-plus-review-v1", outputDir });
    expect(JSON.parse(await readFile(paths.reportPath, "utf8"))).toMatchObject({ status: "pass", coreCount: 600, totalCount: 2000 });
    expect(JSON.parse(await readFile(paths.candidatePath, "utf8"))).toMatchObject({ version: "2026.08.2" });

    const failedDir = await mkdtemp(join(tmpdir(), "phrase-bank-qwen-failed-"));
    await expect(runQwenAgent({ client: fakeClient(responseQueue("fail")), version: "2026.08.2", generatedAt: "2026-08-10T00:00:00.000Z", qualityVersion: "qwen-plus-review-v1", outputDir: failedDir })).rejects.toThrow();
    expect(await readdir(failedDir)).toEqual([]);
  });
});
