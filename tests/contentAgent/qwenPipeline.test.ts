import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { generateSystemContent } from "../../scripts/content-agent/generator";
import { buildQwenCandidate, runQwenAgent } from "../../scripts/content-agent/qwenPipeline";
import { createQwenClient, type QwenClient } from "../../scripts/content-agent/qwenClient";
import type { SystemContentPhrase } from "../../app/domain/types";

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
      return [...familySlices(chunk).map((slice) => JSON.stringify({ phrases: slice.map(({ id, english, chinese }) => ({ id, english, chinese })) })), JSON.stringify({ status: reviewStatus, issues: reviewStatus === "pass" ? [] : ["unnatural"], corrections: [] })];
    }).flat();
  });
}

function familySlices(phrases: SystemContentPhrase[]) {
  const families = phrases.filter(({ kind }) => kind === "core").map((core) => phrases.filter((phrase) => phrase.id === core.id || phrase.parentPhraseId === core.id));
  const slices: SystemContentPhrase[][] = [];
  let slice: SystemContentPhrase[] = [];
  for (const family of families) {
    if (slice.length && slice.length + family.length > 10) {
      slices.push(slice);
      slice = [];
    }
    slice.push(...family);
  }
  if (slice.length) slices.push(slice);
  return slices;
}

function fakeClient(outputs: string[]): QwenClient {
  return { complete: vi.fn(async () => {
    const output = outputs.shift();
    if (!output) throw new Error("unexpected request");
    return output;
  }) };
}

function workBatchIndex(outputs: string[]) {
  return outputs.findIndex((output) => {
    const parsed = JSON.parse(output) as { phrases?: Array<{ id: string }> };
    return parsed.phrases?.[0]?.id.startsWith("sys-work-") ?? false;
  });
}

function promptPhrases(messages: Parameters<QwenClient["complete"]>[0]) {
  const content = messages[1].content;
  return JSON.parse(content.slice(content.lastIndexOf("输入模板：") + "输入模板：".length)).phrases as Array<{ id: string; english: string; chinese: string }>;
}

function exactSlicePatchClient(): QwenClient {
  return { complete: vi.fn(async (messages) => messages[0].content.includes("独立审校")
    ? JSON.stringify({ status: "pass", issues: [], corrections: [] })
    : JSON.stringify({ phrases: promptPhrases(messages).map(({ id, english, chinese }) => ({ id, english, chinese })) })) };
}

describe("Qwen content pipeline", () => {
  it("generates and independently reviews all six exact category batches", async () => {
    const outputs = responseQueue("2026.08.3");
    const expectedCalls = outputs.length;
    const client = fakeClient(outputs);
    const onProgress = vi.fn();
    const result = await buildQwenCandidate({ client, version: "2026.08.3", generatedAt: "2026-08-10T00:00:00.000Z", qualityVersion: "qwen-plus-review-v2", onProgress });

    expect(result.phrases.filter(({ kind }) => kind === "core")).toHaveLength(600);
    expect(result.phrases).toHaveLength(2000);
    for (const category of categories) expect(result.phrases.filter((phrase) => phrase.categoryId === category && phrase.kind === "core")).toHaveLength(quotas[category]);
    expect(client.complete).toHaveBeenCalledTimes(expectedCalls);
    const calls = vi.mocked(client.complete).mock.calls;
    const firstGenerationPrompt = calls[0][0].map(({ content }) => content).join(" ");
    expect(firstGenerationPrompt).toContain("daily");
    expect(firstGenerationPrompt).toContain("本次输入恰好包含 8 条扁平短语记录");
    expect(firstGenerationPrompt).toContain("sys-daily-01-1-1");
    expect(firstGenerationPrompt).toContain("完整翻译子场景");
    expect(firstGenerationPrompt).toContain("不得整批使用同一种开头");
    expect(firstGenerationPrompt).toContain("只允许修改 english 和 chinese");
    expect(firstGenerationPrompt).toContain("不得包含任何其他字段");
    expect(firstGenerationPrompt).toContain("2026.08.3");
    expect(calls[5][0][0].content).toContain("独立审校");
    expect(calls[5][0]).not.toBe(calls[0][0]);
    const firstTravelCall = calls.findIndex(([messages]) => messages[1].content.includes("优化 travel 类别第 1/10 批"));
    expect(calls[firstTravelCall][0].map(({ content }) => content).join(" ")).toContain("本次输入恰好包含 8 条扁平短语记录");
    const thirdTravelCall = calls.findIndex(([messages]) => messages[1].content.includes("优化 travel 类别第 3/10 批"));
    expect(calls[thirdTravelCall][0].map(({ content }) => content).join(" ")).toContain("本次输入恰好包含 9 条扁平短语记录");
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
    const expectedCalls = outputs.length + 1;
    outputs.splice(5, 0, JSON.stringify({ status: "unknown", issues: [], corrections: [] }));
    const client = fakeClient(outputs);

    await expect(buildQwenCandidate({ client, version: "2026.08.3", generatedAt: "2026-08-10T00:00:00.000Z", qualityVersion: "qwen-plus-review-v2" })).resolves.toMatchObject({ version: "2026.08.3" });
    expect(client.complete).toHaveBeenCalledTimes(expectedCalls);
  });

  it("stops after one explicit review failure", async () => {
    const client = fakeClient(responseQueue("2026.08.3", "fail"));

    await expect(buildQwenCandidate({ client, version: "2026.08.3", generatedAt: "2026-08-10T00:00:00.000Z", qualityVersion: "qwen-plus-review-v2" })).rejects.toThrow("审校未通过");
    expect(client.complete).toHaveBeenCalledTimes(6);
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
    outputs[5] = JSON.stringify({
      status: "pass",
      issues: ["更自然的日常表达"],
      corrections: [{ id: firstGenerated.phrases[0].id, english: "That works for me.", chinese: "我觉得可以。" }],
    });

    const result = await buildQwenCandidate({ client: fakeClient(outputs), version: "2026.08.3", generatedAt: "2026-08-10T00:00:00.000Z", qualityVersion: "qwen-plus-review-v2" });
    expect(result.phrases.find(({ id }) => id === firstGenerated.phrases[0].id)).toMatchObject({ english: "That works for me.", chinese: "我觉得可以。" });
  });

  it("retries an incomplete slice with the same IDs before accepting it", async () => {
    const outputs = responseQueue("2026.08.3");
    const full = JSON.parse(outputs[0]);
    const incomplete = { phrases: full.phrases.slice(1) };
    outputs.splice(0, 1, JSON.stringify(incomplete), JSON.stringify(full));
    const client = fakeClient(outputs);

    await expect(buildQwenCandidate({ client, version: "2026.08.3", generatedAt: "2026-08-10T00:00:00.000Z", qualityVersion: "qwen-plus-review-v2" })).resolves.toMatchObject({ version: "2026.08.3" });
    expect(promptPhrases(vi.mocked(client.complete).mock.calls[0][0]).map(({ id }) => id)).toEqual(promptPhrases(vi.mocked(client.complete).mock.calls[1][0]).map(({ id }) => id));
    expect(vi.mocked(client.complete).mock.calls[1][0][1].content).toContain("缺少 ID");
    expect(vi.mocked(client.complete).mock.calls[6][0][0].content).toContain("独立审校");
  });

  it("resumes after the last reviewed checkpoint without repeating completed calls", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "phrase-bank-qwen-resume-"));
    const firstRun = responseQueue("2026.08.3");
    const reviewIndexes = firstRun.flatMap((output, index) => JSON.parse(output).status === "pass" ? [index] : []);
    const failedReviewIndex = reviewIndexes[1];
    firstRun[failedReviewIndex] = JSON.stringify({ status: "fail", issues: ["retry later"], corrections: [] });
    await expect(runQwenAgent({ client: fakeClient(firstRun), version: "2026.08.3", generatedAt: "2026-08-10T00:00:00.000Z", qualityVersion: "qwen-plus-review-v2", outputDir })).rejects.toThrow("审校未通过");
    expect(await readdir(outputDir)).toContain("checkpoint-2026.08.3.json");

    const remaining = responseQueue("2026.08.3").slice(reviewIndexes[0] + 1);
    const expectedRemainingCalls = remaining.length;
    const resumedClient = fakeClient(remaining);
    await expect(runQwenAgent({ client: resumedClient, version: "2026.08.3", generatedAt: "2026-08-10T00:00:00.000Z", qualityVersion: "qwen-plus-review-v2", outputDir })).resolves.toBeTruthy();
    expect(resumedClient.complete).toHaveBeenCalledTimes(expectedRemainingCalls);
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

  it("collects a 30-record work batch in complete family slices before one review", async () => {
    const client = exactSlicePatchClient();

    await expect(buildQwenCandidate({ client, version: "2026.08.3", generatedAt: "2026-08-10T00:00:00.000Z", qualityVersion: "qwen-plus-review-v2" })).resolves.toMatchObject({ version: "2026.08.3" });
    const workGenerationCalls = vi.mocked(client.complete).mock.calls.filter(([messages]) => messages[1].content.includes("优化 work 类别第 1/12 批"));
    expect(workGenerationCalls.map(([messages]) => promptPhrases(messages).length)).toEqual([9, 9, 9, 3]);
    for (const [messages] of workGenerationCalls) {
      const ids = new Set(promptPhrases(messages).map(({ id }) => id));
      for (const phrase of generateSystemContent().phrases.filter((phrase) => ids.has(phrase.id))) {
        if (phrase.kind === "example") expect(ids).toContain(phrase.parentPhraseId);
      }
    }
    const firstWorkGenerationIndex = vi.mocked(client.complete).mock.calls.indexOf(workGenerationCalls[0]);
    expect(vi.mocked(client.complete).mock.calls[firstWorkGenerationIndex + 4][0][0].content).toContain("独立审校");
  });

  it("collects a 40-record daily batch in complete family slices", async () => {
    const client = exactSlicePatchClient();

    await expect(buildQwenCandidate({ client, version: "2026.08.3", generatedAt: "2026-08-10T00:00:00.000Z", qualityVersion: "qwen-plus-review-v2" })).resolves.toMatchObject({ version: "2026.08.3" });
    const dailyGenerationCalls = vi.mocked(client.complete).mock.calls.filter(([messages]) => messages[1].content.includes("优化 daily 类别第 1/18 批"));
    expect(dailyGenerationCalls.map(([messages]) => promptPhrases(messages).length)).toEqual([8, 8, 8, 8, 8]);
  });

  it("sends only the next complete source slice and merges patches in source order", async () => {
    const outputs = responseQueue("2026.08.3");
    const index = workBatchIndex(outputs);
    const full = JSON.parse(outputs[index]);
    full.phrases[0].english = `${full.phrases[0].english} Please let me know.`;
    full.phrases[0].chinese = `${full.phrases[0].chinese} 请告诉我。`;
    outputs[index] = JSON.stringify(full);
    const client = fakeClient(outputs);

    const result = await buildQwenCandidate({ client, version: "2026.08.3", generatedAt: "2026-08-10T00:00:00.000Z", qualityVersion: "qwen-plus-review-v2" });
    const expected = generateSystemContent().phrases.find(({ id }) => id === full.phrases[0].id)!;
    const nextSlicePrompt = vi.mocked(client.complete).mock.calls.filter(([messages]) => messages[1].content.includes("优化 work 类别第 1/12 批"))[1][0];
    expect(promptPhrases(nextSlicePrompt).map(({ id }) => id)).toEqual(familySlices(generateSystemContent().phrases.filter(({ categoryId }) => categoryId === "work").slice(0, 30))[1].map(({ id }) => id));
    expect(result.phrases.find(({ id }) => id === expected.id)).toMatchObject({ ...expected, english: full.phrases[0].english, chinese: full.phrases[0].chinese, contentVersion: "2026.08.3", qualityVersion: "qwen-plus-review-v2" });
    expect(result.phrases.map(({ id }) => id)).toEqual(generateSystemContent().phrases.map(({ id }) => id));
  });

  it("stops on a repeated already-collected patch without reviewing", async () => {
    let firstRound: Array<{ id: string; english: string; chinese: string }> | undefined;
    const client: QwenClient = { complete: vi.fn(async (messages) => {
      if (messages[0].content.includes("独立审校")) return JSON.stringify({ status: "pass", issues: [], corrections: [] });
      const patches = firstRound ?? promptPhrases(messages).map(({ id, english, chinese }) => ({ id, english, chinese }));
      firstRound ??= patches;
      return JSON.stringify({ phrases: patches });
    }) };

    await expect(buildQwenCandidate({ client, version: "2026.08.3", generatedAt: "2026-08-10T00:00:00.000Z", qualityVersion: "qwen-plus-review-v2" })).rejects.toThrow("无进展");
    expect(client.complete).toHaveBeenCalledTimes(2);
  });

  it("exhausts validation retries for a slice that is one patch short without reviewing", async () => {
    const client: QwenClient = { complete: vi.fn(async (messages) => JSON.stringify({ phrases: promptPhrases(messages).slice(0, -1).map(({ id, english, chinese }) => ({ id, english, chinese })) })) };

    await expect(buildQwenCandidate({ client, version: "2026.08.3", generatedAt: "2026-08-10T00:00:00.000Z", qualityVersion: "qwen-plus-review-v2" })).rejects.toThrow("缺少 ID");
    expect(client.complete).toHaveBeenCalledTimes(3);
  });

  it.each(["duplicate", "extra"])("rejects generated patches with %s IDs", async (kind) => {
    const outputs = responseQueue("2026.08.3");
    const invalid = JSON.parse(outputs[0]);
    invalid.phrases.push(kind === "duplicate" ? invalid.phrases[0] : { id: "extra-id", english: "Extra.", chinese: "多余。" });
    const serialized = JSON.stringify(invalid);
    outputs.splice(0, 1, serialized, serialized, serialized);

    await expect(buildQwenCandidate({ client: fakeClient(outputs), version: "2026.08.3", generatedAt: "2026-08-10T00:00:00.000Z", qualityVersion: "qwen-plus-review-v2" })).rejects.toThrow(kind === "duplicate" ? "重复 ID" : "未知 ID");
  });
});
