import { constants } from "node:fs";
import { link, lstat, mkdir, open, readFile, readdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { generateSystemContent } from "../../scripts/content-agent/generator";
import { buildQwenCandidate, runQwenAgent } from "../../scripts/content-agent/qwenPipeline";
import { sourceSha256 } from "../../scripts/content-agent/qwenCheckpoint";
import { createQwenClient, type QwenClient } from "../../scripts/content-agent/qwenClient";
import type { SystemContentPhrase } from "../../app/domain/types";
import { createTempRootTracker } from "./tempRoots";

const tempRoots = createTempRootTracker();

afterEach(async () => tempRoots.cleanup());

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

const noOpCheckpointDurability = { platform: "linux" as const, syncDirectory: async () => undefined };

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
    const outputDir = await tempRoots.create("phrase-bank-qwen-");
    const paths = await runQwenAgent({ client: fakeClient(responseQueue("2026.08.3")), version: "2026.08.3", generatedAt: "2026-08-10T00:00:00.000Z", qualityVersion: "qwen-plus-review-v2", outputDir, checkpointDependencies: noOpCheckpointDurability });
    expect(JSON.parse(await readFile(paths.reportPath, "utf8"))).toMatchObject({ status: "pass", coreCount: 600, totalCount: 2000 });
    expect(JSON.parse(await readFile(paths.candidatePath, "utf8"))).toMatchObject({ version: "2026.08.3" });
    const originalCandidateRaw = await readFile(paths.candidatePath, "utf8");
    const originalReportRaw = await readFile(paths.reportPath, "utf8");
    const checkpointPath = join(outputDir, "checkpoint-2026.08.3.json");
    const durableCheckpointRaw = await readFile(checkpointPath, "utf8");
    const durableCheckpoint = JSON.parse(durableCheckpointRaw);
    expect(durableCheckpoint.phrases).toHaveLength(2000);
    expect(durableCheckpoint.phrases.map(({ id }: { id: string }) => id)).toEqual(generateSystemContent().phrases.map(({ id }) => id));

    const damageOutputs = [
      async () => rm(paths.candidatePath),
      async () => writeFile(paths.candidatePath, "corrupt candidate\n", "utf8"),
      async () => rm(paths.reportPath),
      async () => writeFile(paths.reportPath, "corrupt report\n", "utf8"),
      async () => { await rm(paths.candidatePath); await rm(paths.reportPath); },
    ];
    for (const damage of damageOutputs) {
      await damage();
      const recoveryClient = fakeClient([]);
      await expect(runQwenAgent({ client: recoveryClient, version: "2026.08.3", generatedAt: "2099-01-01T00:00:00.000Z", qualityVersion: "qwen-plus-review-v2", outputDir, checkpointDependencies: noOpCheckpointDurability })).resolves.toEqual(paths);
      expect(recoveryClient.complete).not.toHaveBeenCalled();
      const recoveredCandidate = JSON.parse(await readFile(paths.candidatePath, "utf8"));
      expect(recoveredCandidate).toMatchObject({ version: "2026.08.3" });
      expect(recoveredCandidate.phrases).toHaveLength(2000);
      expect(JSON.parse(await readFile(paths.reportPath, "utf8"))).toMatchObject({ status: "pass", coreCount: 600, totalCount: 2000 });
      expect(await readFile(paths.candidatePath, "utf8")).toBe(originalCandidateRaw);
      expect(await readFile(paths.reportPath, "utf8")).toBe(originalReportRaw);
      expect(await readFile(checkpointPath, "utf8")).toBe(durableCheckpointRaw);
    }
    const candidateRaw = await readFile(paths.candidatePath, "utf8");
    const reportRaw = await readFile(paths.reportPath, "utf8");
    const repeatClient = fakeClient([]);
    await expect(runQwenAgent({ client: repeatClient, version: "2026.08.3", generatedAt: "2100-01-01T00:00:00.000Z", qualityVersion: "qwen-plus-review-v2", outputDir, checkpointDependencies: noOpCheckpointDurability })).resolves.toEqual(paths);
    expect(repeatClient.complete).not.toHaveBeenCalled();
    expect(await readFile(paths.candidatePath, "utf8")).toBe(candidateRaw);
    expect(await readFile(paths.reportPath, "utf8")).toBe(reportRaw);
    expect(await readFile(checkpointPath, "utf8")).toBe(durableCheckpointRaw);

    const failedDir = await tempRoots.create("phrase-bank-qwen-failed-");
    await expect(runQwenAgent({ client: fakeClient(responseQueue("2026.08.3", "fail")), version: "2026.08.3", generatedAt: "2026-08-10T00:00:00.000Z", qualityVersion: "qwen-plus-review-v2", outputDir: failedDir })).rejects.toThrow();
    expect(await readdir(failedDir)).not.toContain("candidate-2026.08.3.json");
  }, 30_000);

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
    const outputDir = await tempRoots.create("phrase-bank-qwen-resume-");
    const firstRun = responseQueue("2026.08.3");
    const reviewIndexes = firstRun.flatMap((output, index) => JSON.parse(output).status === "pass" ? [index] : []);
    const failedReviewIndex = reviewIndexes[1];
    firstRun[failedReviewIndex] = JSON.stringify({ status: "fail", issues: ["retry later"], corrections: [] });
    await expect(runQwenAgent({ client: fakeClient(firstRun), version: "2026.08.3", generatedAt: "2026-08-10T00:00:00.000Z", qualityVersion: "qwen-plus-review-v2", outputDir })).rejects.toThrow("审校未通过");
    expect(await readdir(outputDir)).toContain("checkpoint-2026.08.3.json");
    const checkpointPath = join(outputDir, "checkpoint-2026.08.3.json");
    const legacyCheckpoint = JSON.parse(await readFile(checkpointPath, "utf8"));
    delete legacyCheckpoint.sourceSha256;
    await writeFile(checkpointPath, `${JSON.stringify(legacyCheckpoint)}\n`, "utf8");

    const remaining = responseQueue("2026.08.3").slice(reviewIndexes[0] + 1);
    const expectedRemainingCalls = remaining.length;
    const resumedClient = fakeClient(remaining);
    await expect(runQwenAgent({ client: resumedClient, version: "2026.08.3", generatedAt: "2026-08-10T00:00:00.000Z", qualityVersion: "qwen-plus-review-v2", outputDir, checkpointDependencies: noOpCheckpointDurability })).resolves.toBeTruthy();
    expect(resumedClient.complete).toHaveBeenCalledTimes(expectedRemainingCalls);
    expect(JSON.parse(await readFile(join(outputDir, "checkpoint-2026.08.3.json"), "utf8")).phrases).toHaveLength(2000);
  }, 20_000);

  it("writes a current fingerprinted checkpoint after each independently reviewed full batch", async () => {
    const outputDir = await tempRoots.create("phrase-bank-qwen-current-checkpoint-");
    const outputs = responseQueue("2026.08.3");
    const reviewIndexes = outputs.flatMap((output, index) => JSON.parse(output).status === "pass" ? [index] : []);
    outputs[reviewIndexes[1]] = JSON.stringify({ status: "fail", issues: ["retry later"], corrections: [] });

    await expect(runQwenAgent({ client: fakeClient(outputs), version: "2026.08.3", generatedAt: "2026-08-10T00:00:00.000Z", qualityVersion: "qwen-plus-review-v2", outputDir })).rejects.toThrow("审校未通过");
    const checkpoint = JSON.parse(await readFile(join(outputDir, "checkpoint-2026.08.3.json"), "utf8"));

    expect(checkpoint).toMatchObject({ version: "2026.08.3", sourceSha256: sourceSha256(generateSystemContent()) });
    expect(checkpoint.phrases).toHaveLength(40);
    expect(checkpoint.phrases.map(({ id }: { id: string }) => id)).toEqual(generateSystemContent().phrases.slice(0, 40).map(({ id }) => id));
  });

  it("rejects a non-prefix imported checkpoint before any Qwen call", async () => {
    const outputDir = await tempRoots.create("phrase-bank-qwen-nonprefix-checkpoint-");
    const source = generateSystemContent();
    const phrases = [source.phrases[0], source.phrases[2]].map((phrase) => ({ ...phrase, contentVersion: "2026.08.3", qualityVersion: "qwen-plus-review-v2" }));
    await writeFile(join(outputDir, "checkpoint-2026.08.3.json"), `${JSON.stringify({ version: "2026.08.3", sourceSha256: sourceSha256(source), phrases })}\n`, "utf8");
    const client = exactSlicePatchClient();

    await expect(runQwenAgent({ client, version: "2026.08.3", generatedAt: "2026-08-10T00:00:00.000Z", qualityVersion: "qwen-plus-review-v2", outputDir })).rejects.toThrow(/prefix|order/i);
    expect(client.complete).not.toHaveBeenCalled();
  });

  it("keeps the prior valid checkpoint when an atomic checkpoint write fails", async () => {
    const outputDir = await tempRoots.create("phrase-bank-qwen-atomic-checkpoint-");
    const checkpointPath = join(outputDir, "checkpoint-2026.08.3.json");
    const prior = { version: "2026.08.3", sourceSha256: sourceSha256(generateSystemContent()), phrases: [] };
    const priorSerialized = `${JSON.stringify(prior)}\n`;
    await writeFile(checkpointPath, priorSerialized, "utf8");
    const legacyPendingPath = `${checkpointPath}.pending`;
    await writeFile(legacyPendingPath, "foreign legacy pending\n", "utf8");
    const renameCheckpoint = vi.fn(async () => {
      const error = new Error("simulated crash before replace") as NodeJS.ErrnoException;
      error.code = "EIO";
      throw error;
    });

    await expect(runQwenAgent({ client: fakeClient(responseQueue("2026.08.3")), version: "2026.08.3", generatedAt: "2026-08-10T00:00:00.000Z", qualityVersion: "qwen-plus-review-v2", outputDir, checkpointDependencies: { rename: renameCheckpoint } })).rejects.toThrow(/simulated crash/);

    expect(await readFile(checkpointPath, "utf8")).toBe(priorSerialized);
    expect(await readFile(legacyPendingPath, "utf8")).toBe("foreign legacy pending\n");
    expect((await readdir(outputDir)).filter((name) => name.includes(".pending.") && name !== legacyPendingPath)).toEqual([]);
  });

  it("syncs and closes a unique checkpoint temp before retrying a Windows atomic replace", async () => {
    const outputDir = await tempRoots.create("phrase-bank-qwen-windows-retry-");
    const checkpointPath = join(outputDir, "checkpoint-2026.08.3.json");
    await writeFile(checkpointPath, `${JSON.stringify({ version: "2026.08.3", sourceSha256: sourceSha256(generateSystemContent()), phrases: [] })}\n`, "utf8");
    const openedPaths: string[] = [];
    const sync = vi.fn(async () => undefined);
    const close = vi.fn(async () => undefined);
    const openCheckpoint = vi.fn(async (path: string, flags: number) => {
      openedPaths.push(path);
      const handle = await open(path, flags);
      return {
        writeFile: handle.writeFile.bind(handle),
        sync: async () => { await handle.sync(); await sync(); },
        stat: handle.stat.bind(handle),
        close: async () => { await handle.close(); await close(); },
      };
    });
    let attempts = 0;
    const renameCheckpoint = vi.fn(async (source: string, destination: string) => {
      attempts += 1;
      if (attempts < 3) {
        const error = new Error("temporarily locked") as NodeJS.ErrnoException;
        error.code = attempts === 1 ? "EPERM" : "EACCES";
        throw error;
      }
      await rename(source, destination);
    });
    const outputs = responseQueue("2026.08.3");
    const reviewIndexes = outputs.flatMap((output, index) => JSON.parse(output).status === "pass" ? [index] : []);
    outputs[reviewIndexes[1]] = JSON.stringify({ status: "fail", issues: ["stop after checkpoint"], corrections: [] });

    await expect(runQwenAgent({ client: fakeClient(outputs), version: "2026.08.3", generatedAt: "2026-08-10T00:00:00.000Z", qualityVersion: "qwen-plus-review-v2", outputDir, checkpointDependencies: { open: openCheckpoint, rename: renameCheckpoint, retryDelay: async () => undefined } })).rejects.toThrow("审校未通过");

    expect(renameCheckpoint).toHaveBeenCalledTimes(3);
    expect(sync).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
    expect(openedPaths[0]).toMatch(/checkpoint-2026\.08\.3\.json\.pending\.\d+\.[0-9a-f-]+$/i);
    expect(await readdir(outputDir)).toEqual(["checkpoint-2026.08.3.json"]);
    expect(JSON.parse(await readFile(checkpointPath, "utf8")).phrases).toHaveLength(40);
  });

  it.each([
    ["win32", "sync-file"],
    ["linux", "sync-directory"],
  ] as const)("durably syncs a replaced checkpoint on %s after rename and verification", async (platform, expectedSync) => {
    const outputDir = await tempRoots.create(`phrase-bank-qwen-durable-${platform}-`);
    const events: string[] = [];
    const outputs = responseQueue("2026.08.3");
    const reviewIndexes = outputs.flatMap((output, index) => JSON.parse(output).status === "pass" ? [index] : []);
    outputs[reviewIndexes[1]] = JSON.stringify({ status: "fail", issues: ["stop after checkpoint"], corrections: [] });

    await expect(runQwenAgent({
      client: fakeClient(outputs), version: "2026.08.3", generatedAt: "2026-08-10T00:00:00.000Z", qualityVersion: "qwen-plus-review-v2", outputDir,
      checkpointDependencies: {
        platform,
        rename: async (sourcePath, destination) => { events.push("rename"); await rename(sourcePath, destination); },
        syncCommittedDestination: async (path) => { events.push(`sync-file:${path}`); },
        syncDirectory: async (path) => { events.push(`sync-directory:${path}`); },
      },
    })).rejects.toThrow("审校未通过");

    expect(events).toEqual(["rename", `${expectedSync}:${platform === "win32" ? join(outputDir, "checkpoint-2026.08.3.json") : outputDir}`]);
  });

  it("reopens the committed Windows checkpoint r+, syncs it, and closes it after verification", async () => {
    const outputDir = await tempRoots.create("phrase-bank-qwen-windows-committed-sync-");
    const events: string[] = [];
    const outputs = responseQueue("2026.08.3");
    const reviewIndexes = outputs.flatMap((output, index) => JSON.parse(output).status === "pass" ? [index] : []);
    outputs[reviewIndexes[1]] = JSON.stringify({ status: "fail", issues: ["stop after checkpoint"], corrections: [] });
    const openDestination = vi.fn(async (path: string, flags: Parameters<typeof open>[1]) => {
      const phase = flags === "r+" ? "committed" : "verify";
      events.push(`open-${phase}:${String(flags)}`);
      const handle = await open(path, flags);
      const originalSync = handle.sync.bind(handle);
      const originalClose = handle.close.bind(handle);
      vi.spyOn(handle, "sync").mockImplementation(async () => { events.push(`sync-${phase}`); await originalSync(); });
      vi.spyOn(handle, "close").mockImplementation(async () => { events.push(`close-${phase}`); await originalClose(); });
      return handle;
    }) as typeof open;

    await expect(runQwenAgent({
      client: fakeClient(outputs), version: "2026.08.3", generatedAt: "2026-08-10T00:00:00.000Z", qualityVersion: "qwen-plus-review-v2", outputDir,
      checkpointDependencies: {
        platform: "win32",
        rename: async (sourcePath, destination) => { events.push("rename"); await rename(sourcePath, destination); },
        openDestination,
      },
    })).rejects.toThrow("审校未通过");

    expect(events).toEqual(["rename", `open-verify:${constants.O_RDONLY | constants.O_NOFOLLOW}`, "close-verify", "open-committed:r+", "sync-committed", "close-committed"]);
  });

  it("syncs each newly created POSIX output-directory entry before checkpoint rename", async () => {
    const root = await tempRoots.create("phrase-bank-qwen-created-output-");
    const outputDir = join(root, "first-created", "nested-output");
    const events: string[] = [];
    const outputs = responseQueue("2026.08.3");
    const reviewIndexes = outputs.flatMap((output, index) => JSON.parse(output).status === "pass" ? [index] : []);
    outputs[reviewIndexes[1]] = JSON.stringify({ status: "fail", issues: ["stop after checkpoint"], corrections: [] });

    await expect(runQwenAgent({
      client: fakeClient(outputs), version: "2026.08.3", generatedAt: "2026-08-10T00:00:00.000Z", qualityVersion: "qwen-plus-review-v2", outputDir,
      checkpointDependencies: {
        platform: "linux",
        rename: async (sourcePath, destination) => { events.push("rename"); await rename(sourcePath, destination); },
        syncDirectory: async (path) => { events.push(`sync:${path}`); },
      },
    })).rejects.toThrow("审校未通过");

    expect(events).toEqual([`sync:${root}`, `sync:${join(root, "first-created")}`, "rename", `sync:${outputDir}`]);
  });

  it("reports an ambiguous committed sync failure, reloads disk progress, and keeps the checkpoint queue usable", async () => {
    const outputDir = await tempRoots.create("phrase-bank-qwen-ambiguous-sync-");
    const firstClient = fakeClient(responseQueue("2026.08.3"));

    await expect(runQwenAgent({
      client: firstClient, version: "2026.08.3", generatedAt: "2026-08-10T00:00:00.000Z", qualityVersion: "qwen-plus-review-v2", outputDir,
      checkpointDependencies: { platform: "win32", syncCommittedDestination: async () => { throw new Error("committed checkpoint sync failed"); } },
    })).rejects.toThrow(/committed.*ambiguous|ambiguous.*committed/i);
    expect(firstClient.complete).toHaveBeenCalledTimes(6);
    expect(JSON.parse(await readFile(join(outputDir, "checkpoint-2026.08.3.json"), "utf8")).phrases).toHaveLength(40);
    expect(await readdir(outputDir)).toEqual(["checkpoint-2026.08.3.json"]);

    const remaining = responseQueue("2026.08.3").slice(6);
    const reviewIndexes = remaining.flatMap((output, index) => JSON.parse(output).status === "pass" ? [index] : []);
    remaining[reviewIndexes[1]] = JSON.stringify({ status: "fail", issues: ["stop after recovered write"], corrections: [] });
    const recoveredClient = fakeClient(remaining);
    await expect(runQwenAgent({ client: recoveredClient, version: "2026.08.3", generatedAt: "2026-08-10T00:00:00.000Z", qualityVersion: "qwen-plus-review-v2", outputDir })).rejects.toThrow("审校未通过");

    expect(promptPhrases(vi.mocked(recoveredClient.complete).mock.calls[0][0])[0].id).toBe(generateSystemContent().phrases[40].id);
    expect(JSON.parse(await readFile(join(outputDir, "checkpoint-2026.08.3.json"), "utf8")).phrases).toHaveLength(80);
  }, 20_000);

  it("does not let legacy or unique stale pending artifacts block a new checkpoint", async () => {
    const outputDir = await tempRoots.create("phrase-bank-qwen-stale-pending-");
    const checkpointPath = join(outputDir, "checkpoint-2026.08.3.json");
    const legacyPending = `${checkpointPath}.pending`;
    const uniquePending = `${checkpointPath}.pending.99999999.foreign-owner`;
    await writeFile(legacyPending, "legacy foreign\n", "utf8");
    await writeFile(uniquePending, "unique foreign\n", "utf8");
    const outputs = responseQueue("2026.08.3");
    const reviewIndexes = outputs.flatMap((output, index) => JSON.parse(output).status === "pass" ? [index] : []);
    outputs[reviewIndexes[1]] = JSON.stringify({ status: "fail", issues: ["stop after checkpoint"], corrections: [] });

    await expect(runQwenAgent({ client: fakeClient(outputs), version: "2026.08.3", generatedAt: "2026-08-10T00:00:00.000Z", qualityVersion: "qwen-plus-review-v2", outputDir })).rejects.toThrow("审校未通过");

    expect(await readFile(legacyPending, "utf8")).toBe("legacy foreign\n");
    expect(await readFile(uniquePending, "utf8")).toBe("unique foreign\n");
    await expect(readFile(checkpointPath, "utf8")).resolves.toContain('"sourceSha256"');
    expect((await readdir(outputDir)).sort()).toEqual(["checkpoint-2026.08.3.json", "checkpoint-2026.08.3.json.pending", "checkpoint-2026.08.3.json.pending.99999999.foreign-owner"]);
  });

  it("refuses to follow or delete a foreign link swapped over its owned temp before rename", async () => {
    const outputDir = await tempRoots.create("phrase-bank-qwen-temp-swap-");
    const checkpointPath = join(outputDir, "checkpoint-2026.08.3.json");
    const priorSerialized = `${JSON.stringify({ version: "2026.08.3", sourceSha256: sourceSha256(generateSystemContent()), phrases: [] })}\n`;
    const foreignPath = join(outputDir, "foreign-checkpoint.json");
    await writeFile(checkpointPath, priorSerialized, "utf8");
    await writeFile(foreignPath, priorSerialized, "utf8");
    let swappedPath = "";
    const openCheckpoint = async (path: string, flags: number) => {
      const handle = await open(path, flags);
      return {
        writeFile: handle.writeFile.bind(handle),
        sync: handle.sync.bind(handle),
        stat: handle.stat.bind(handle),
        close: async () => {
          await handle.close();
          swappedPath = path;
          await rm(path, { force: true });
          await symlink(foreignPath, path, "file");
        },
      };
    };

    await expect(runQwenAgent({ client: fakeClient(responseQueue("2026.08.3")), version: "2026.08.3", generatedAt: "2026-08-10T00:00:00.000Z", qualityVersion: "qwen-plus-review-v2", outputDir, checkpointDependencies: { open: openCheckpoint } })).rejects.toThrow(/temporary|临时|type|类型/i);

    expect(await readFile(checkpointPath, "utf8")).toBe(priorSerialized);
    expect((await lstat(checkpointPath)).isSymbolicLink()).toBe(false);
    expect((await lstat(swappedPath)).isSymbolicLink()).toBe(true);
    expect(await readFile(foreignPath, "utf8")).toBe(priorSerialized);
  });

  it("revalidates temp ownership after a Windows retry delay before replacing the checkpoint", async () => {
    const outputDir = await tempRoots.create("phrase-bank-qwen-retry-swap-");
    const checkpointPath = join(outputDir, "checkpoint-2026.08.3.json");
    const priorSerialized = `${JSON.stringify({ version: "2026.08.3", sourceSha256: sourceSha256(generateSystemContent()), phrases: [] })}\n`;
    const foreignPath = join(outputDir, "foreign-checkpoint.json");
    await writeFile(checkpointPath, priorSerialized, "utf8");
    await writeFile(foreignPath, priorSerialized, "utf8");
    let pendingPath = "";
    let renameAttempts = 0;
    const renameCheckpoint = async (source: string, destination: string) => {
      pendingPath = source;
      renameAttempts += 1;
      if (renameAttempts === 1) {
        const error = new Error("temporarily locked") as NodeJS.ErrnoException;
        error.code = "EPERM";
        throw error;
      }
      await rename(source, destination);
    };
    const retryDelay = async () => {
      await rm(pendingPath, { force: true });
      await symlink(foreignPath, pendingPath, "file");
    };

    await expect(runQwenAgent({ client: fakeClient(responseQueue("2026.08.3")), version: "2026.08.3", generatedAt: "2026-08-10T00:00:00.000Z", qualityVersion: "qwen-plus-review-v2", outputDir, checkpointDependencies: { rename: renameCheckpoint, retryDelay } })).rejects.toThrow(/ownership|所有权|temporary|临时/i);

    expect(renameAttempts).toBe(1);
    expect(await readFile(checkpointPath, "utf8")).toBe(priorSerialized);
    expect((await lstat(checkpointPath)).isSymbolicLink()).toBe(false);
    expect((await lstat(pendingPath)).isSymbolicLink()).toBe(true);
    expect(await readFile(foreignPath, "utf8")).toBe(priorSerialized);
  });

  it("rejects a destination link swapped in immediately before verification opens it", async () => {
    const outputDir = await tempRoots.create("phrase-bank-qwen-destination-swap-");
    const checkpointPath = join(outputDir, "checkpoint-2026.08.3.json");
    const hardlinkPath = join(outputDir, "foreign-hardlink.json");
    let swapped = false;
    const openDestination = async (path: string, flags: number) => {
      if (!swapped) {
        swapped = true;
        await link(path, hardlinkPath);
        await rm(path, { force: true });
        await symlink(hardlinkPath, path, "file");
      }
      return open(path, flags);
    };
    const outputs = responseQueue("2026.08.3");
    const reviewIndexes = outputs.flatMap((output, index) => JSON.parse(output).status === "pass" ? [index] : []);
    outputs[reviewIndexes[1]] = JSON.stringify({ status: "fail", issues: ["stop after checkpoint"], corrections: [] });

    await expect(runQwenAgent({ client: fakeClient(outputs), version: "2026.08.3", generatedAt: "2026-08-10T00:00:00.000Z", qualityVersion: "qwen-plus-review-v2", outputDir, checkpointDependencies: { openDestination } })).rejects.toThrow(/ownership|所有权|symbolic|link|链接/i);

    expect((await lstat(checkpointPath)).isSymbolicLink()).toBe(true);
    expect((await lstat(hardlinkPath)).isFile()).toBe(true);
  });

  it("allows concurrent checkpoint writers without corruption or owned-temp residue", async () => {
    const outputDir = await tempRoots.create("phrase-bank-qwen-checkpoint-contention-");
    const makeOutputs = () => {
      const outputs = responseQueue("2026.08.3");
      const reviewIndexes = outputs.flatMap((output, index) => JSON.parse(output).status === "pass" ? [index] : []);
      outputs[reviewIndexes[1]] = JSON.stringify({ status: "fail", issues: ["stop after checkpoint"], corrections: [] });
      return outputs;
    };

    const results = await Promise.allSettled(Array.from({ length: 4 }, () => runQwenAgent({ client: fakeClient(makeOutputs()), version: "2026.08.3", generatedAt: "2026-08-10T00:00:00.000Z", qualityVersion: "qwen-plus-review-v2", outputDir })));

    expect(results).toHaveLength(4);
    expect(results.every(({ status }) => status === "rejected")).toBe(true);
    const checkpoint = JSON.parse(await readFile(join(outputDir, "checkpoint-2026.08.3.json"), "utf8"));
    expect(checkpoint).toMatchObject({ version: "2026.08.3", sourceSha256: sourceSha256(generateSystemContent()) });
    expect(checkpoint.phrases).toHaveLength(40);
    expect(await readdir(outputDir)).toEqual(["checkpoint-2026.08.3.json"]);
  });

  it("does not let a slow in-process alias writer regress an 80-phrase checkpoint", async () => {
    const outputDir = await tempRoots.create("phrase-bank-qwen-checkpoint-monotonic-");
    let releaseSlow!: () => void;
    const slowGate = new Promise<void>((resolve) => { releaseSlow = resolve; });
    let signalSlowRename!: () => void;
    const slowRenameStarted = new Promise<void>((resolve) => { signalSlowRename = resolve; });
    const slowOutputs = responseQueue("2026.08.3");
    const slowReviewIndexes = slowOutputs.flatMap((output, index) => JSON.parse(output).status === "pass" ? [index] : []);
    slowOutputs[slowReviewIndexes[1]] = JSON.stringify({ status: "fail", issues: ["stop slow writer"], corrections: [] });
    const slowRun = runQwenAgent({
      client: fakeClient(slowOutputs), version: "2026.08.3", generatedAt: "2026-08-10T00:00:00.000Z", qualityVersion: "qwen-plus-review-v2", outputDir,
      checkpointDependencies: { rename: async (source, destination) => { signalSlowRename(); await slowGate; await rename(source, destination); } },
    });
    const slowSettled = slowRun.catch(() => undefined);
    await slowRenameStarted;

    const source = generateSystemContent();
    const firstForty = source.phrases.slice(0, 40).map((phrase) => ({ ...phrase, contentVersion: "2026.08.3", qualityVersion: "qwen-plus-review-v2" }));
    await writeFile(join(outputDir, "checkpoint-2026.08.3.json"), `${JSON.stringify({ version: "2026.08.3", sourceSha256: sourceSha256(source), phrases: firstForty })}\n`, "utf8");
    let signalFastRename!: () => void;
    const fastRenameStarted = new Promise<void>((resolve) => { signalFastRename = resolve; });
    let releaseFastRename!: () => void;
    const fastRenameGate = new Promise<void>((resolve) => { releaseFastRename = resolve; });
    const fastOutputs = responseQueue("2026.08.3").slice(6);
    const fastReviewIndexes = fastOutputs.flatMap((output, index) => JSON.parse(output).status === "pass" ? [index] : []);
    fastOutputs[fastReviewIndexes[1]] = JSON.stringify({ status: "fail", issues: ["stop fast writer"], corrections: [] });
    const fastOutputDir = process.platform === "win32" ? outputDir.toUpperCase() : outputDir;
    const fastRun = runQwenAgent({
      client: fakeClient(fastOutputs), version: "2026.08.3", generatedAt: "2026-08-10T00:00:00.000Z", qualityVersion: "qwen-plus-review-v2", outputDir: fastOutputDir,
      checkpointDependencies: { rename: async (sourcePath, destination) => { signalFastRename(); await fastRenameGate; await rename(sourcePath, destination); } },
    });
    const fastSettled = fastRun.catch(() => undefined);
    const fastEnteredBeforeSlowRelease = await Promise.race([fastRenameStarted.then(() => true), new Promise<false>((resolve) => setTimeout(() => resolve(false), 100))]);
    if (fastEnteredBeforeSlowRelease) {
      releaseFastRename();
      await fastSettled;
      releaseSlow();
    } else {
      releaseSlow();
      await fastRenameStarted;
      releaseFastRename();
    }
    await Promise.all([slowSettled, fastSettled]);

    const checkpoint = JSON.parse(await readFile(join(outputDir, "checkpoint-2026.08.3.json"), "utf8"));
    expect(checkpoint.phrases).toHaveLength(80);
    expect(await readdir(outputDir)).toEqual(["checkpoint-2026.08.3.json"]);
  }, 20_000);

  it("retains the checkpoint until both final output files have succeeded", async () => {
    const outputDir = await tempRoots.create("phrase-bank-qwen-final-output-");
    await mkdir(join(outputDir, "report-2026.08.3.json"));

    await expect(runQwenAgent({ client: fakeClient(responseQueue("2026.08.3")), version: "2026.08.3", generatedAt: "2026-08-10T00:00:00.000Z", qualityVersion: "qwen-plus-review-v2", outputDir, checkpointDependencies: noOpCheckpointDurability })).rejects.toThrow();

    expect(await readdir(outputDir)).toContain("checkpoint-2026.08.3.json");
  }, 20_000);

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

  it.each([
    ["empty", { phrases: [] }],
    ["wholly unrelated", { phrases: [{ id: "unrelated-id", english: "Unrelated.", chinese: "无关。" }] }],
  ])("stops after one %s parsed patch response that accepts no requested IDs", async (_kind, response) => {
    const client: QwenClient = { complete: vi.fn(async () => JSON.stringify(response)) };

    await expect(buildQwenCandidate({ client, version: "2026.08.3", generatedAt: "2026-08-10T00:00:00.000Z", qualityVersion: "qwen-plus-review-v2" })).rejects.toThrow("无进展");
    expect(client.complete).toHaveBeenCalledTimes(1);
  });

  it("retries a parsed patch containing only malformed records", async () => {
    const client: QwenClient = { complete: vi.fn(async () => JSON.stringify({ phrases: [{ id: 123, english: "Malformed.", chinese: "格式错误。" }] })) };

    await expect(buildQwenCandidate({ client, version: "2026.08.3", generatedAt: "2026-08-10T00:00:00.000Z", qualityVersion: "qwen-plus-review-v2" })).rejects.toThrow(/连续 3 次无效/);
    expect(client.complete).toHaveBeenCalledTimes(3);
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
