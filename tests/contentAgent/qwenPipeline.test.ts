import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { generateSystemContent } from "../../scripts/content-agent/generator";
import { buildQwenCandidate, runQwenAgent } from "../../scripts/content-agent/qwenPipeline";
import { createQwenClient, type QwenClient } from "../../scripts/content-agent/qwenClient";

const categories = ["daily", "travel", "work", "business", "supply-chain", "social"] as const;
const quotas = { daily: 180, travel: 100, work: 120, business: 100, "supply-chain": 70, social: 30 };

function responseQueue(requestedVersion: string, reviewStatus: "pass" | "fail" = "pass") {
  const source = generateSystemContent();
  return categories.flatMap((category) => {
    const phrases = source.phrases.filter((phrase) => phrase.categoryId === category).map((phrase) => ({
      ...phrase,
      contentVersion: requestedVersion,
      qualityVersion: "qwen-plus-review-v2",
    }));
    const cores = phrases.filter(({ kind }) => kind === "core");
    return Array.from({ length: Math.ceil(cores.length / 10) }, (_, chunkIndex) => {
      const chunkCores = cores.slice(chunkIndex * 10, chunkIndex * 10 + 10);
      const ids = new Set(chunkCores.map(({ id }) => id));
      const chunk = phrases.filter((phrase) => phrase.kind === "core" ? ids.has(phrase.id) : ids.has(phrase.parentPhraseId ?? ""));
      return [JSON.stringify({ phrases: chunk.map(({ id, english, chinese }) => ({ id, english, chinese })) }), JSON.stringify({ status: reviewStatus, issues: reviewStatus === "pass" ? [] : ["unnatural"], corrections: [] })];
    }).flat();
  });
}

function fakeClient(outputs: string[]): QwenClient {
  return { complete: vi.fn(async () => {
    const output = outputs.shift();
    if (!output) throw new Error("unexpected request");
    return output;
  }) };
}

function workBatchIndex(outputs: string[]) {
  return outputs.findIndex((output, index) => index % 2 === 0 && JSON.parse(output).phrases.length === 30 && JSON.parse(output).phrases[0].id.startsWith("sys-work-"));
}

describe("Qwen content pipeline", () => {
  it("generates and independently reviews all six exact category batches", async () => {
    const client = fakeClient(responseQueue("2026.08.3"));
    const onProgress = vi.fn();
    const result = await buildQwenCandidate({ client, version: "2026.08.3", generatedAt: "2026-08-10T00:00:00.000Z", qualityVersion: "qwen-plus-review-v2", onProgress });

    expect(result.phrases.filter(({ kind }) => kind === "core")).toHaveLength(600);
    expect(result.phrases).toHaveLength(2000);
    for (const category of categories) expect(result.phrases.filter((phrase) => phrase.categoryId === category && phrase.kind === "core")).toHaveLength(quotas[category]);
    expect(client.complete).toHaveBeenCalledTimes(120);
    const calls = vi.mocked(client.complete).mock.calls;
    const firstGenerationPrompt = calls[0][0].map(({ content }) => content).join(" ");
    expect(firstGenerationPrompt).toContain("daily");
    expect(firstGenerationPrompt).toContain("每个核心恰好 3 个案例");
    expect(firstGenerationPrompt).toContain("sys-daily-01-1-1");
    expect(firstGenerationPrompt).toContain("完整翻译子场景");
    expect(firstGenerationPrompt).toContain("不得整批使用同一种开头");
    expect(firstGenerationPrompt).toContain("只允许修改 english 和 chinese");
    expect(firstGenerationPrompt).toContain("不得包含任何其他字段");
    expect(firstGenerationPrompt).toContain("2026.08.3");
    expect(calls[1][0][0].content).toContain("独立审校");
    expect(calls[1][0]).not.toBe(calls[0][0]);
    const firstTravelCall = 36;
    expect(calls[firstTravelCall][0].map(({ content }) => content).join(" ")).toContain("每个核心恰好 3 个案例");
    expect(calls[firstTravelCall + 4][0].map(({ content }) => content).join(" ")).toContain("每个核心恰好 2 个案例");
    expect(onProgress).toHaveBeenCalledTimes(120);
    expect(onProgress).toHaveBeenLastCalledWith({ category: "social", completed: 120, total: 120, stage: "review" });
    expect(result.phrases.every((phrase) => phrase.contentVersion === "2026.08.3")).toBe(true);
    expect(result.phrases.every((phrase) => phrase.qualityVersion === "qwen-plus-review-v2")).toBe(true);
  });

  it("accepts a single JSON markdown fence but rejects review failures", async () => {
    const fenced = responseQueue("2026.08.3");
    fenced[0] = `\`\`\`json\n${fenced[0]}\n\`\`\``;
    await expect(buildQwenCandidate({ client: fakeClient(fenced), version: "2026.08.3", generatedAt: "2026-08-10T00:00:00.000Z", qualityVersion: "qwen-plus-review-v2" })).resolves.toMatchObject({ version: "2026.08.3" });

    await expect(buildQwenCandidate({ client: fakeClient(responseQueue("2026.08.3", "fail")), version: "2026.08.3", generatedAt: "2026-08-10T00:00:00.000Z", qualityVersion: "qwen-plus-review-v2" })).rejects.toThrow("审校未通过");
  });

  it("does not retry a Qwen authentication error in the content pipeline", async () => {
    const fetcher = vi.fn(async () => new Response("unauthorized", { status: 401 }));
    const client = createQwenClient({ apiKey: "test-secret", baseUrl: "https://example.invalid/v1", model: "qwen-plus", fetcher, maxAttempts: 3 });

    await expect(buildQwenCandidate({ client, version: "2026.08.3", generatedAt: "2026-08-10T00:00:00.000Z", qualityVersion: "qwen-plus-review-v2" })).rejects.toThrow("认证失败");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("retries a malformed review status as a validation failure", async () => {
    const outputs = responseQueue("2026.08.3");
    outputs.splice(1, 0, JSON.stringify({ status: "unknown", issues: [], corrections: [] }));
    const client = fakeClient(outputs);

    await expect(buildQwenCandidate({ client, version: "2026.08.3", generatedAt: "2026-08-10T00:00:00.000Z", qualityVersion: "qwen-plus-review-v2" })).resolves.toMatchObject({ version: "2026.08.3" });
    expect(client.complete).toHaveBeenCalledTimes(121);
  });

  it("stops after one explicit review failure", async () => {
    const client = fakeClient(responseQueue("2026.08.3", "fail"));

    await expect(buildQwenCandidate({ client, version: "2026.08.3", generatedAt: "2026-08-10T00:00:00.000Z", qualityVersion: "qwen-plus-review-v2" })).rejects.toThrow("审校未通过");
    expect(client.complete).toHaveBeenCalledTimes(2);
  });

  it("writes candidate and passing report only after the complete pipeline succeeds", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "phrase-bank-qwen-"));
    const paths = await runQwenAgent({ client: fakeClient(responseQueue("2026.08.3")), version: "2026.08.3", generatedAt: "2026-08-10T00:00:00.000Z", qualityVersion: "qwen-plus-review-v2", outputDir });
    expect(JSON.parse(await readFile(paths.reportPath, "utf8"))).toMatchObject({ status: "pass", coreCount: 600, totalCount: 2000 });
    expect(JSON.parse(await readFile(paths.candidatePath, "utf8"))).toMatchObject({ version: "2026.08.3" });

    const failedDir = await mkdtemp(join(tmpdir(), "phrase-bank-qwen-failed-"));
    await expect(runQwenAgent({ client: fakeClient(responseQueue("2026.08.3", "fail")), version: "2026.08.3", generatedAt: "2026-08-10T00:00:00.000Z", qualityVersion: "qwen-plus-review-v2", outputDir: failedDir })).rejects.toThrow();
    expect(await readdir(failedDir)).not.toContain("candidate-2026.08.3.json");
  });

  it("rejects a batch that changes stable source IDs", async () => {
    const outputs = responseQueue("2026.08.3");
    const first = JSON.parse(outputs[0]);
    first.phrases[0].id = "changed-id";
    outputs[0] = JSON.stringify(first);
    await expect(buildQwenCandidate({ client: fakeClient(outputs), version: "2026.08.3", generatedAt: "2026-08-10T00:00:00.000Z", qualityVersion: "qwen-plus-review-v2" })).rejects.toThrow("ID");
  });

  it("applies reviewer corrections without requiring the full batch to be returned", async () => {
    const outputs = responseQueue("2026.08.3");
    const firstGenerated = JSON.parse(outputs[0]);
    outputs[1] = JSON.stringify({
      status: "pass",
      issues: ["更自然的日常表达"],
      corrections: [{ id: firstGenerated.phrases[0].id, english: "That works for me.", chinese: "我觉得可以。" }],
    });

    const result = await buildQwenCandidate({ client: fakeClient(outputs), version: "2026.08.3", generatedAt: "2026-08-10T00:00:00.000Z", qualityVersion: "qwen-plus-review-v2" });
    expect(result.phrases.find(({ id }) => id === firstGenerated.phrases[0].id)).toMatchObject({ english: "That works for me.", chinese: "我觉得可以。" });
  });

  it("automatically retries an incomplete generated batch", async () => {
    const outputs = responseQueue("2026.08.3");
    const incomplete = JSON.parse(outputs[0]);
    incomplete.phrases = incomplete.phrases.slice(1);
    outputs.unshift(JSON.stringify(incomplete));
    const client = fakeClient(outputs);

    await expect(buildQwenCandidate({ client, version: "2026.08.3", generatedAt: "2026-08-10T00:00:00.000Z", qualityVersion: "qwen-plus-review-v2" })).resolves.toMatchObject({ version: "2026.08.3" });
    expect(client.complete).toHaveBeenCalledTimes(121);
  });

  it("resumes after the last reviewed checkpoint without repeating completed calls", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "phrase-bank-qwen-resume-"));
    const firstRun = responseQueue("2026.08.3");
    firstRun[3] = JSON.stringify({ status: "fail", issues: ["retry later"], corrections: [] });
    await expect(runQwenAgent({ client: fakeClient(firstRun), version: "2026.08.3", generatedAt: "2026-08-10T00:00:00.000Z", qualityVersion: "qwen-plus-review-v2", outputDir })).rejects.toThrow("审校未通过");
    expect(await readdir(outputDir)).toContain("checkpoint-2026.08.3.json");

    const remaining = responseQueue("2026.08.3").slice(2);
    const resumedClient = fakeClient(remaining);
    await expect(runQwenAgent({ client: resumedClient, version: "2026.08.3", generatedAt: "2026-08-10T00:00:00.000Z", qualityVersion: "qwen-plus-review-v2", outputDir })).resolves.toBeTruthy();
    expect(resumedClient.complete).toHaveBeenCalledTimes(118);
    expect(await readdir(outputDir)).not.toContain("checkpoint-2026.08.3.json");
  });

  it.each(["subcategory", "cefrLevel", "intent", "parentPhraseId", "unlockOrder"])("rejects a generated patch that includes immutable %s metadata", async (field) => {
    const outputs = responseQueue("2026.08.3");
    const first = JSON.parse(outputs[0]);
    first.phrases[0][field] = field === "unlockOrder" ? 99 : "changed-metadata";
    outputs[0] = JSON.stringify(first);
    outputs.unshift(JSON.stringify(first), JSON.stringify(first));

    await expect(buildQwenCandidate({ client: fakeClient(outputs), version: "2026.08.3", generatedAt: "2026-08-10T00:00:00.000Z", qualityVersion: "qwen-plus-review-v2" })).rejects.toThrow("字段");
  });

  it("reports omitted IDs after three invalid 30-item generation attempts without reviewing", async () => {
    const outputs = responseQueue("2026.08.3");
    const index = workBatchIndex(outputs);
    const original = JSON.parse(outputs[index]);
    const missingIds = original.phrases.slice(0, 2).map((phrase: { id: string }) => phrase.id);
    const missing = JSON.stringify({ phrases: original.phrases.slice(2) });
    outputs.splice(index, 1, missing, missing, missing);
    const client = fakeClient(outputs);

    await expect(buildQwenCandidate({ client, version: "2026.08.3", generatedAt: "2026-08-10T00:00:00.000Z", qualityVersion: "qwen-plus-review-v2" })).rejects.toThrow(missingIds.join(", "));
    const failedBatchCalls = vi.mocked(client.complete).mock.calls.filter(([messages]) => messages[1].content.includes("优化 work 类别第 1/12 批"));
    expect(failedBatchCalls).toHaveLength(3);
    expect(failedBatchCalls.every(([messages]) => messages[0].content.includes("内容设计师"))).toBe(true);
  });

  it("feeds omitted IDs back into the next generation prompt and merges valid patches onto the source", async () => {
    const outputs = responseQueue("2026.08.3");
    const index = workBatchIndex(outputs);
    const missing = JSON.parse(outputs[index]);
    const missingIds = missing.phrases.slice(0, 2).map((phrase: { id: string }) => phrase.id);
    missing.phrases = missing.phrases.slice(2);
    const valid = JSON.parse(outputs[index]);
    valid.phrases[0].english = `${valid.phrases[0].english} Please let me know.`;
    valid.phrases[0].chinese = `${valid.phrases[0].chinese} 请告诉我。`;
    outputs[index] = JSON.stringify(valid);
    outputs.splice(index, 0, JSON.stringify(missing));
    const client = fakeClient(outputs);

    const result = await buildQwenCandidate({ client, version: "2026.08.3", generatedAt: "2026-08-10T00:00:00.000Z", qualityVersion: "qwen-plus-review-v2" });
    const expected = generateSystemContent().phrases.find(({ id }) => id === valid.phrases[0].id)!;
    const retryPrompt = vi.mocked(client.complete).mock.calls.find(([messages]) => messages[1].content.includes("优化 work 类别第 1/12 批") && messages[1].content.includes("上一轮补丁无效"))![0].map(({ content }) => content).join(" ");
    expect(retryPrompt).toContain("期望 30 条，实际 28 条");
    expect(retryPrompt).toContain(missingIds[0]);
    expect(result.phrases.find(({ id }) => id === expected.id)).toMatchObject({ ...expected, english: valid.phrases[0].english, chinese: valid.phrases[0].chinese, contentVersion: "2026.08.3", qualityVersion: "qwen-plus-review-v2" });
    expect(result.phrases.map(({ id }) => id)).toEqual(generateSystemContent().phrases.map(({ id }) => id));
  });

  it.each(["duplicate", "extra"])("rejects generated patches with %s IDs", async (kind) => {
    const outputs = responseQueue("2026.08.3");
    const invalid = JSON.parse(outputs[0]);
    invalid.phrases.push(kind === "duplicate" ? invalid.phrases[0] : { id: "extra-id", english: "Extra.", chinese: "多余。" });
    const serialized = JSON.stringify(invalid);
    outputs.splice(0, 1, serialized, serialized, serialized);

    await expect(buildQwenCandidate({ client: fakeClient(outputs), version: "2026.08.3", generatedAt: "2026-08-10T00:00:00.000Z", qualityVersion: "qwen-plus-review-v2" })).rejects.toThrow(kind === "duplicate" ? "重复 ID" : "额外 ID");
  });
});
