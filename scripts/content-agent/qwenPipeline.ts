import { randomUUID } from "node:crypto";
import { constants, type BigIntStats } from "node:fs";
import { lstat, mkdir, open, realpath, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import type { SystemContentPackage, SystemContentPhrase } from "../../app/domain/types";
import { inspectSystemContent } from "./qualityGate";
import type { QwenClient, QwenMessage } from "./qwenClient";
import { generateSystemContent } from "./generator";
import { loadQwenCheckpoint, sourceSha256, validateQwenCheckpoint } from "./qwenCheckpoint";

const CATEGORY_QUOTAS = [
  ["daily", 180], ["travel", 100], ["work", 120], ["business", 100], ["supply-chain", 70], ["social", 30],
] as const;

interface PipelineProgress { category: string; stage: "generate" | "review"; completed: number; total: number; }
interface PipelineOptions { client: QwenClient; version: string; generatedAt: string; qualityVersion: string; sourceContent?: SystemContentPackage; resumePhrases?: SystemContentPhrase[]; onProgress?: (progress: PipelineProgress) => void; onBatchCompleted?: (phrases: SystemContentPhrase[]) => Promise<void>; }
interface CheckpointFileHandle {
  writeFile(data: string, encoding: BufferEncoding): Promise<unknown>;
  sync(): Promise<unknown>;
  stat(options: { bigint: true }): Promise<BigIntStats>;
  close(): Promise<unknown>;
}
interface CheckpointDependencies {
  open?: (path: string, flags: number) => Promise<CheckpointFileHandle>;
  openDestination?: typeof open;
  rename?: (source: string, destination: string) => Promise<void>;
  retryDelay?: (milliseconds: number) => Promise<void>;
  platform?: NodeJS.Platform;
  syncCommittedDestination?: (path: string) => Promise<void>;
  syncDirectory?: (path: string) => Promise<void>;
}
interface AgentOptions extends PipelineOptions { outputDir: string; checkpointDependencies?: CheckpointDependencies; }
interface BatchResponse { phrases: SystemContentPhrase[]; }
interface PhrasePatch { id: string; english: string; chinese: string; }
interface PatchResponse { phrases: PhrasePatch[]; }
interface ReviewCorrection { id: string; english: string; chinese: string; }
interface ReviewResponse { status: "pass" | "fail"; issues: string[]; corrections: ReviewCorrection[]; }

function parseJson<T>(value: string): T {
  const trimmed = value.trim();
  const match = trimmed.match(/^```json\s*([\s\S]*?)\s*```$/i);
  const json = match ? match[1] : trimmed;
  if (!match && (json.startsWith("```") || !json.startsWith("{"))) throw new Error("Qwen 返回的内容不是纯 JSON");
  try { return JSON.parse(json) as T; }
  catch { throw new Error("Qwen 返回的 JSON 无法解析"); }
}

const MAX_CORES_PER_REQUEST = 10;
const MAX_VALIDATION_ATTEMPTS = 3;
const MAX_PATCH_RECORDS_PER_SLICE = 10;
const TOTAL_REQUESTS = CATEGORY_QUOTAS.reduce((total, [, quota]) => total + Math.ceil(quota / MAX_CORES_PER_REQUEST) * 2, 0);

function generationMessages(category: string, chunkIndex: number, chunkCount: number, source: BatchResponse, options: PipelineOptions, feedback?: string): QwenMessage[] {
  return [
    { role: "system", content: "你是英语口语课程内容设计师。只返回 JSON，不要 Markdown。内容必须自然、实用、准确，适合中国成年学习者。" },
    { role: "user", content: `优化 ${category} 类别第 ${chunkIndex + 1}/${chunkCount} 批。只允许修改 english 和 chinese；英文必须是自然、多样的口语表达；不得整批使用同一种开头或机械重复模式。中文必须完整翻译子场景，包括英文中的引导上下文，并与英文含义完整对应。批次之间不得重复。使用版本 ${options.version} 和质检版本 ${options.qualityVersion}。本次输入恰好包含 ${source.phrases.length} 条扁平短语记录，必须返回恰好 ${source.phrases.length} 条补丁，每个输入 ID 一条。返回紧凑补丁 JSON：'{"phrases":[{"id":"输入ID","english":"优化后的英文","chinese":"优化后的中文"}]}'。每个补丁只允许 id、english、chinese 三个字段，不得包含任何其他字段。${feedback ? `上一轮该切片无效：${feedback}。请修正后只返回本切片的完整补丁。` : ""}输入模板：${JSON.stringify(source)}` },
  ];
}

function reviewMessages(category: string, coreCount: number, batch: BatchResponse, options: PipelineOptions): QwenMessage[] {
  return [
    { role: "system", content: "你是独立审校员，不继承生成上下文。检查双语完整性、完整翻译子场景、自然口语、实用性、机械重复的表达模式或句首开头、冒犯或危险内容。只返回 JSON。" },
    { role: "user", content: `逐条独立审校 ${category} 批次中的全部内容（共 ${coreCount} 个核心及其案例）。中文必须完整翻译子场景，包括英文中的引导上下文；检查中英文含义是否完整对应，并识别机械重复模式或整批同一种开头。只可修正 english 和 chinese，版本必须是 ${options.version}，质检版本必须是 ${options.qualityVersion}。不要复述整批；只返回需要修改的条目。若修正后整批可发布，返回 '{"status":"pass","issues":[],"corrections":[{"id":"原ID","english":"修正后的英文","chinese":"修正后的中文"}]}'；无法安全修正才返回 fail。corrections 可为空，ID 必须来自输入。输入：${JSON.stringify(batch)}` },
  ];
}

function applyReview(category: string, generated: BatchResponse, review: ReviewResponse): BatchResponse {
  if (!review || !Array.isArray(review.issues) || !Array.isArray(review.corrections)) throw new Error(`${category} 审校格式无效`);
  if (review.status !== "pass") throw new Error(`${category} 审校未通过`);
  const corrections = new Map<string, ReviewCorrection>();
  for (const correction of review.corrections) {
    if (!correction || typeof correction.id !== "string" || typeof correction.english !== "string" || !correction.english.trim() || typeof correction.chinese !== "string" || !correction.chinese.trim()) {
      throw new Error(`${category} 审校修正格式无效`);
    }
    if (corrections.has(correction.id)) throw new Error(`${category} 审校包含重复 ID`);
    corrections.set(correction.id, correction);
  }
  const knownIds = new Set(generated.phrases.map(({ id }) => id));
  if ([...corrections.keys()].some((id) => !knownIds.has(id))) throw new Error(`${category} 审校包含未知 ID`);
  return { phrases: generated.phrases.map((phrase) => {
    const correction = corrections.get(phrase.id);
    return correction ? { ...phrase, english: correction.english.trim(), chinese: correction.chinese.trim() } : phrase;
  }) };
}

function stableMetadata(phrase: SystemContentPhrase) {
  const metadata = Object.fromEntries(Object.entries(phrase).filter(([key]) => key !== "english" && key !== "chinese"));
  return JSON.stringify(Object.fromEntries(Object.entries(metadata).sort(([left], [right]) => left.localeCompare(right))));
}

function validatePatchSlice(value: unknown, requestedIds: string[], collectedIds: Set<string>): PhrasePatch[] {
  if (!value || typeof value !== "object" || !Array.isArray((value as PatchResponse).phrases)) throw new Error("Qwen 补丁格式无效：phrases 必须是数组");
  const patches = (value as { phrases: unknown[] }).phrases;
  const actualIds: string[] = [];
  const errors: string[] = [];
  for (const [index, patch] of patches.entries()) {
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
      errors.push(`第 ${index + 1} 条补丁不是对象`);
      continue;
    }
    const candidate = patch as Record<string, unknown>;
    const extraFields = Object.keys(candidate).filter((key) => key !== "id" && key !== "english" && key !== "chinese");
    if (extraFields.length) errors.push(`第 ${index + 1} 条包含不允许字段: ${extraFields.join(", ")}`);
    if (typeof candidate.id !== "string" || !candidate.id.trim()) errors.push(`第 ${index + 1} 条 ID 无效`);
    else actualIds.push(candidate.id);
    if (typeof candidate.english !== "string" || !candidate.english.trim()) errors.push(`第 ${index + 1} 条英文无效`);
    if (typeof candidate.chinese !== "string" || !candidate.chinese.trim()) errors.push(`第 ${index + 1} 条中文无效`);
  }
  const schemaErrorCount = errors.length;
  const duplicateIds = [...new Set(actualIds.filter((id, index) => actualIds.indexOf(id) !== index))];
  const requested = new Set(requestedIds);
  const acceptedRequestedIds = new Set(actualIds.filter((id) => requested.has(id)));
  if (!acceptedRequestedIds.size && schemaErrorCount === 0) throw new Error("Qwen 补丁验证失败：无进展：响应未包含任何请求 ID");
  const unrequestedIds = [...new Set(actualIds.filter((id) => !requested.has(id)))];
  const repeatedIds = unrequestedIds.filter((id) => collectedIds.has(id));
  const unknownIds = unrequestedIds.filter((id) => !collectedIds.has(id));
  const missingIds = requestedIds.filter((id) => !actualIds.includes(id));
  if (duplicateIds.length) errors.push(`重复 ID: ${duplicateIds.join(", ")}`);
  if (unknownIds.length) errors.push(`未知 ID: ${unknownIds.join(", ")}`);
  if (repeatedIds.length) errors.push(`无进展：已收集 ID: ${repeatedIds.join(", ")}`);
  if (missingIds.length) errors.push(`缺少 ID: ${missingIds.join(", ")}`);
  if (patches.length !== requestedIds.length) errors.push(`补丁数量错误：期望 ${requestedIds.length}，实际 ${patches.length}`);
  if (errors.length) throw new Error(`Qwen 补丁验证失败：${errors.join("；")}`);
  return patches as PhrasePatch[];
}

const CHECKPOINT_REPLACE_ATTEMPTS = 5;
// The local agent contract permits one generating process. Canonical keys prevent
// aliases inside that process from racing; progress is still rechecked before rename.
const checkpointWriteQueues = new Map<string, Promise<void>>();

async function checkpointRetryDelay(milliseconds: number) {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

async function removeOwnedCheckpointTemp(path: string, identity: { dev: bigint; ino: bigint }) {
  try {
    const metadata = await lstat(path, { bigint: true });
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.dev !== identity.dev || metadata.ino !== identity.ino) return;
    await rm(path, { force: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

async function assertOwnedCheckpointPath(path: string, identity: { dev: bigint; ino: bigint }) {
  let metadata: BigIntStats;
  try {
    metadata = await lstat(path, { bigint: true });
  } catch (error) {
    throw new Error("Qwen 检查点临时文件所有权已变化", { cause: error });
  }
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.dev !== identity.dev || metadata.ino !== identity.ino) {
    throw new Error("Qwen 检查点临时文件所有权已变化");
  }
}

async function readCheckpointProgress(path: string, version: string, sourceContent: SystemContentPackage) {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  try {
    const identity = await handle.stat({ bigint: true });
    if (!identity.isFile() || identity.isSymbolicLink()) throw new Error("Qwen 检查点文件类型无效");
    const pathMetadata = await lstat(path, { bigint: true });
    if (!pathMetadata.isFile() || pathMetadata.isSymbolicLink() || pathMetadata.dev !== identity.dev || pathMetadata.ino !== identity.ino) throw new Error("Qwen 检查点文件所有权已变化");
    const raw = await handle.readFile("utf8");
    return validateQwenCheckpoint(JSON.parse(raw), { version, sourceContent }).phrases.length;
  } finally {
    await handle.close();
  }
}

async function defaultSyncDirectory(path: string) {
  const handle = await open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function defaultSyncCommittedDestination(path: string, identity: { dev: bigint; ino: bigint }, openCommitted: typeof open) {
  const handle = await openCommitted(path, "r+");
  try {
    const metadata = await handle.stat({ bigint: true });
    if (!metadata.isFile() || metadata.dev !== identity.dev || metadata.ino !== identity.ino) throw new Error("Qwen 已提交检查点所有权已变化");
    await assertOwnedCheckpointPath(path, identity);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function parentDirectoriesForCreatedPath(firstCreated: string, targetDirectory: string): string[] {
  const nativeFirst = process.platform === "win32" && firstCreated.startsWith("\\\\?\\UNC\\")
    ? `\\\\${firstCreated.slice(8)}`
    : process.platform === "win32" && firstCreated.startsWith("\\\\?\\") ? firstCreated.slice(4) : firstCreated;
  const first = resolve(nativeFirst);
  const target = resolve(targetDirectory);
  const remainder = relative(first, target);
  if (remainder.startsWith("..") || resolve(first, remainder) !== target) return [dirname(first)];
  const segments = remainder ? remainder.split(/[\\/]/u) : [];
  const parents = [dirname(first)];
  let directory = first;
  for (const segment of segments) {
    parents.push(directory);
    directory = join(directory, segment);
  }
  return parents;
}

async function serializeCheckpointWrite(path: string, operation: () => Promise<void>) {
  const physicalParent = await realpath(dirname(path));
  const physicalPath = join(physicalParent, basename(path));
  const key = process.platform === "win32" ? physicalPath.toLowerCase() : physicalPath;
  const previous = checkpointWriteQueues.get(key) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(operation);
  checkpointWriteQueues.set(key, current);
  try {
    await current;
  } finally {
    if (checkpointWriteQueues.get(key) === current) checkpointWriteQueues.delete(key);
  }
}

async function writeCheckpointAtomicallyLocked(options: {
  checkpointPath: string;
  serialized: string;
  version: string;
  sourceContent: SystemContentPackage;
  phraseCount: number;
  createdOutputDirectory?: string;
  dependencies?: CheckpointDependencies;
}) {
  const candidate = validateQwenCheckpoint(JSON.parse(options.serialized), { version: options.version, sourceContent: options.sourceContent });
  if (candidate.phrases.length !== options.phraseCount) throw new Error("Qwen 检查点保存进度不一致");
  const initialProgress = await readCheckpointProgress(options.checkpointPath, options.version, options.sourceContent);
  if (initialProgress !== undefined && initialProgress >= options.phraseCount) return;
  const pendingPath = `${options.checkpointPath}.pending.${process.pid}.${randomUUID()}`;
  const openCheckpoint = options.dependencies?.open ?? open;
  const renameCheckpoint = options.dependencies?.rename ?? rename;
  const retryDelay = options.dependencies?.retryDelay ?? checkpointRetryDelay;
  let pendingFile: CheckpointFileHandle | undefined;
  let identity: { dev: bigint; ino: bigint } | undefined;
  try {
    pendingFile = await openCheckpoint(pendingPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW);
    const handleMetadata = await pendingFile.stat({ bigint: true });
    if (!handleMetadata.isFile() || handleMetadata.isSymbolicLink()) throw new Error("Qwen 检查点临时文件类型无效");
    identity = { dev: handleMetadata.dev, ino: handleMetadata.ino };
    await assertOwnedCheckpointPath(pendingPath, identity);
    await pendingFile.writeFile(options.serialized, "utf8");
    await pendingFile.sync();
    await pendingFile.close();
    pendingFile = undefined;
    await assertOwnedCheckpointPath(pendingPath, identity);
    const platform = options.dependencies?.platform ?? process.platform;
    if (platform !== "win32" && options.createdOutputDirectory) {
      for (const directory of parentDirectoriesForCreatedPath(options.createdOutputDirectory, dirname(options.checkpointPath))) {
        await (options.dependencies?.syncDirectory ?? defaultSyncDirectory)(directory);
      }
    }
    for (let attempt = 1; ; attempt += 1) {
      await assertOwnedCheckpointPath(pendingPath, identity);
      const currentProgress = await readCheckpointProgress(options.checkpointPath, options.version, options.sourceContent);
      if (currentProgress !== undefined && currentProgress >= options.phraseCount) return;
      try {
        await renameCheckpoint(pendingPath, options.checkpointPath);
        break;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if ((code !== "EPERM" && code !== "EACCES") || attempt >= CHECKPOINT_REPLACE_ATTEMPTS) throw error;
        await retryDelay(10 * 2 ** (attempt - 1));
      }
    }
    await assertOwnedCheckpointPath(options.checkpointPath, identity);
    const checkpointHandle = await (options.dependencies?.openDestination ?? open)(options.checkpointPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const checkpointIdentity = await checkpointHandle.stat({ bigint: true });
      if (checkpointIdentity.dev !== identity.dev || checkpointIdentity.ino !== identity.ino) throw new Error("Qwen 检查点原子替换验证失败：所有权变化");
      await assertOwnedCheckpointPath(options.checkpointPath, identity);
      if (await checkpointHandle.readFile("utf8") !== options.serialized) throw new Error("Qwen 检查点原子替换验证失败：内容不一致");
    } finally {
      await checkpointHandle.close();
    }
    try {
      if (platform === "win32") {
        if (options.dependencies?.syncCommittedDestination) await options.dependencies.syncCommittedDestination(options.checkpointPath);
        else await defaultSyncCommittedDestination(options.checkpointPath, identity, options.dependencies?.openDestination ?? open);
      } else {
        await (options.dependencies?.syncDirectory ?? defaultSyncDirectory)(dirname(options.checkpointPath));
      }
    } catch (error) {
      throw new Error("Qwen checkpoint replacement committed; durability is ambiguous", { cause: error });
    }
    identity = undefined;
  } finally {
    try {
      await pendingFile?.close();
    } finally {
      if (identity) await removeOwnedCheckpointTemp(pendingPath, identity);
    }
  }
}

async function writeCheckpointAtomically(options: Parameters<typeof writeCheckpointAtomicallyLocked>[0]) {
  await serializeCheckpointWrite(options.checkpointPath, () => writeCheckpointAtomicallyLocked(options));
}

function sourceSlices(source: BatchResponse): BatchResponse[] {
  const families = source.phrases.filter(({ kind }) => kind === "core").map((core) =>
    source.phrases.filter((phrase) => phrase.id === core.id || phrase.parentPhraseId === core.id),
  );
  const slices: BatchResponse[] = [];
  let current: SystemContentPhrase[] = [];
  for (const family of families) {
    if (family.length > MAX_PATCH_RECORDS_PER_SLICE) throw new Error(`输入模板家庭超过补丁切片上限：${family[0]?.id}`);
    if (current.length && current.length + family.length > MAX_PATCH_RECORDS_PER_SLICE) {
      slices.push({ phrases: current });
      current = [];
    }
    current.push(...family);
  }
  if (current.length) slices.push({ phrases: current });
  return slices;
}

function mergePatches(patchById: Map<string, PhrasePatch>, source: BatchResponse): BatchResponse {
  return { phrases: source.phrases.map((phrase) => {
    const patch = patchById.get(phrase.id)!;
    return { ...phrase, english: patch.english.trim(), chinese: patch.chinese.trim() };
  }) };
}

function assertBatch(category: string, coreCount: number, batch: BatchResponse, source?: BatchResponse) {
  if (!batch || !Array.isArray(batch.phrases)) throw new Error(`${category} 批次格式无效`);
  if (batch.phrases.some((phrase) => phrase.categoryId !== category)) throw new Error(`${category} 批次包含错误类别`);
  const cores = batch.phrases.filter(({ kind }) => kind === "core").length;
  if (cores !== coreCount) throw new Error(`${category} 核心数量错误：${cores}`);
  if (source) {
    const expectedIds = source.phrases.map(({ id }) => id).sort();
    const actualIds = batch.phrases.map(({ id }) => id).sort();
    if (JSON.stringify(actualIds) !== JSON.stringify(expectedIds)) throw new Error(`${category} 批次 ID 与输入模板不一致`);
    const expectedById = new Map(source.phrases.map((phrase) => [phrase.id, phrase]));
    for (const actualPhrase of batch.phrases) {
      const expectedPhrase = expectedById.get(actualPhrase.id);
      if (stableMetadata(actualPhrase) !== stableMetadata(expectedPhrase!)) throw new Error(`${category} 批次元数据与输入模板不一致`);
    }
  }
}

async function generateValidBatch(options: PipelineOptions, category: string, coreCount: number, chunkIndex: number, chunkCount: number, source: BatchResponse) {
  const collected = new Map<string, PhrasePatch>();
  for (const slice of sourceSlices(source)) {
    const requestedIds = slice.phrases.map(({ id }) => id);
    let accepted: PhrasePatch[] | undefined;
    let feedback: string | undefined;
    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_VALIDATION_ATTEMPTS; attempt += 1) {
      const response = await options.client.complete(generationMessages(category, chunkIndex, chunkCount, slice, options, feedback));
      try {
        accepted = validatePatchSlice(parseJson<unknown>(response), requestedIds, new Set(collected.keys()));
        break;
      } catch (error) {
        lastError = error;
        const message = error instanceof Error ? error.message : "补丁验证失败";
        if (message.includes("无进展")) throw error;
        feedback = message.replace(/^Qwen 补丁验证失败：/, "");
      }
    }
    if (!accepted) throw new Error(`${category} 补丁切片连续 ${MAX_VALIDATION_ATTEMPTS} 次无效：${lastError instanceof Error ? lastError.message : "补丁验证失败"}`);
    for (const patch of accepted) collected.set(patch.id, patch);
  }
  const generated = mergePatches(collected, source);
  assertBatch(category, coreCount, generated, source);
  return generated;
}

async function reviewValidBatch(options: PipelineOptions, category: string, coreCount: number, generated: BatchResponse) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_VALIDATION_ATTEMPTS; attempt += 1) {
    let response: ReviewResponse;
    const review = await options.client.complete(reviewMessages(category, coreCount, generated, options));
    try {
      response = parseJson<ReviewResponse>(review);
    } catch (error) {
      lastError = error;
      continue;
    }
    if (response.status === "fail") throw new Error(`${category} 审校未通过`);
    try {
      return applyReview(category, generated, response);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

export async function buildQwenCandidate(options: PipelineOptions): Promise<SystemContentPackage> {
  const phrases: SystemContentPhrase[] = [];
  const resumedById = new Map((options.resumePhrases ?? []).map((phrase) => [phrase.id, phrase]));
  let completedRequests = 0;
  const sourceContent = options.sourceContent ?? generateSystemContent();
  const targetSource: SystemContentPackage = {
    ...sourceContent,
    version: options.version,
    generatedAt: options.generatedAt,
    qualityVersion: options.qualityVersion,
    phrases: sourceContent.phrases.map((phrase) => ({
      ...phrase,
      contentVersion: options.version,
      qualityVersion: options.qualityVersion,
    })),
  };
  for (const [category, coreQuota] of CATEGORY_QUOTAS) {
    const sourcePhrases = targetSource.phrases.filter((phrase) => phrase.categoryId === category);
    const sourceCores = sourcePhrases.filter(({ kind }) => kind === "core");
    if (sourceCores.length !== coreQuota) throw new Error(`${category} 输入模板配额错误`);
    const chunkCount = Math.ceil(sourceCores.length / MAX_CORES_PER_REQUEST);
    const categoryPhrases: SystemContentPhrase[] = [];
    for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
      const coreCount = Math.min(MAX_CORES_PER_REQUEST, coreQuota - chunkIndex * MAX_CORES_PER_REQUEST);
      const chunkCores = sourceCores.slice(chunkIndex * MAX_CORES_PER_REQUEST, chunkIndex * MAX_CORES_PER_REQUEST + coreCount);
      const coreIds = new Set(chunkCores.map(({ id }) => id));
      const source: BatchResponse = { phrases: sourcePhrases.filter((phrase) => phrase.kind === "core" ? coreIds.has(phrase.id) : coreIds.has(phrase.parentPhraseId ?? "")) };
      const resumed = source.phrases.map(({ id }) => resumedById.get(id));
      if (resumed.every((phrase): phrase is SystemContentPhrase => Boolean(phrase))) {
        const resumedBatch = { phrases: resumed };
        assertBatch(category, coreCount, resumedBatch, source);
        categoryPhrases.push(...resumedBatch.phrases);
        options.onProgress?.({ category, stage: "generate", completed: ++completedRequests, total: TOTAL_REQUESTS });
        options.onProgress?.({ category, stage: "review", completed: ++completedRequests, total: TOTAL_REQUESTS });
        continue;
      }
      const exampleCount = source.phrases.filter(({ kind }) => kind === "example").length / coreCount;
      if (!Number.isInteger(exampleCount)) throw new Error(`${category} 输入模板案例数量不一致`);
      const generated = await generateValidBatch(options, category, coreCount, chunkIndex, chunkCount, source);
      options.onProgress?.({ category, stage: "generate", completed: ++completedRequests, total: TOTAL_REQUESTS });
      const reviewed = await reviewValidBatch(options, category, coreCount, generated);
      assertBatch(category, coreCount, reviewed, source);
      options.onProgress?.({ category, stage: "review", completed: ++completedRequests, total: TOTAL_REQUESTS });
      categoryPhrases.push(...reviewed.phrases);
      await options.onBatchCompleted?.([...phrases, ...categoryPhrases]);
    }
    if (categoryPhrases.filter(({ kind }) => kind === "core").length !== coreQuota) throw new Error(`${category} 总配额不完整`);
    phrases.push(...categoryPhrases);
  }
  const content: SystemContentPackage = { format: "phrase-bank-system-content", version: options.version, generatedAt: options.generatedAt, qualityVersion: options.qualityVersion, phrases };
  const report = inspectSystemContent(content);
  if (report.errors.length) throw new Error(`候选内容未通过质量门：${report.errors[0]}`);
  return content;
}

export async function runQwenAgent(options: AgentOptions) {
  const createdOutputDirectory = await mkdir(options.outputDir, { recursive: true });
  let outputDirectoryEntryToSync = createdOutputDirectory;
  const checkpointPath = join(options.outputDir, `checkpoint-${options.version}.json`);
  const sourceContent = options.sourceContent ?? generateSystemContent();
  let resumePhrases: SystemContentPhrase[] = [];
  try {
    const checkpoint = await loadQwenCheckpoint({ path: checkpointPath, version: options.version, sourceContent });
    resumePhrases = checkpoint.phrases;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const content = await buildQwenCandidate({
    ...options,
    sourceContent,
    resumePhrases,
    onBatchCompleted: async (phrases) => {
      await writeCheckpointAtomically({
        checkpointPath,
        serialized: `${JSON.stringify({ version: options.version, sourceSha256: sourceSha256(sourceContent), phrases })}\n`,
        version: options.version,
        sourceContent,
        phraseCount: phrases.length,
        createdOutputDirectory: outputDirectoryEntryToSync,
        dependencies: options.checkpointDependencies,
      });
      outputDirectoryEntryToSync = undefined;
      await options.onBatchCompleted?.(phrases);
    },
  });
  const report = inspectSystemContent(content);
  const candidatePath = join(options.outputDir, `candidate-${options.version}.json`);
  const reportPath = join(options.outputDir, `report-${options.version}.json`);
  await writeFile(candidatePath, `${JSON.stringify(content, null, 2)}\n`, "utf8");
  await writeFile(reportPath, `${JSON.stringify({ status: "pass", version: options.version, ...report }, null, 2)}\n`, "utf8");
  await rm(checkpointPath, { force: true });
  return { candidatePath, reportPath };
}
