# Local Qwen Generation and Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resume the existing Qwen content checkpoint on the user's Windows computer, review the finished bilingual library in a localhost-only browser page, and allow exactly one guarded content commit and deployment after explicit approval.

**Architecture:** Keep the existing Qwen generation pipeline and add four narrow boundaries around it: a one-file checkpoint export/import path, a project-external secret loader and local runner, a pure review domain plus localhost HTTP UI, and an approval-gated release command. Generation artifacts and review state remain ignored under `.content-agent`; the API key remains outside the repository; the review page never edits candidate text or calls production APIs.

**Tech Stack:** Node.js 22, TypeScript, native `node:http`, native `node:crypto`, Vitest, existing Qwen client/pipeline/publisher, GitHub Actions, `gh` CLI, Git.

---

## File map

- Create `.github/workflows/qwen-checkpoint-export.yml`: manual, read-only export of exactly one server checkpoint as a short-lived artifact.
- Create `scripts/content-agent/qwenCheckpoint.ts`: validate legacy/current checkpoint identity, source metadata, version, and atomic import.
- Create `scripts/import-qwen-checkpoint.ts`: local CLI for importing the downloaded single checkpoint.
- Create `scripts/content-agent/localQwenEnv.ts`: strict loader for the external Windows secret file.
- Create `scripts/run-local-qwen-content-agent.ts`: local generation entry point that reuses `runQwenAgent`.
- Create `scripts/content-agent/localReview.ts`: candidate hash, deterministic sample, quality hints, decisions, approval rules.
- Create `scripts/content-agent/localReviewStore.ts`: atomic review-state persistence and candidate-hash invalidation.
- Create `scripts/content-agent/localReviewPage.ts`: dependency-free HTML/CSS/JS review page.
- Create `scripts/content-agent/localReviewServer.ts`: localhost-only HTTP API and server lifecycle.
- Create `scripts/run-local-content-review.ts`: CLI that starts the review server and prints only the local URL.
- Create `scripts/content-agent/approvedRelease.ts`: approval validation and exact release file contract.
- Create `scripts/release-approved-qwen-content.ts`: guarded tests, one commit, non-force push, and deploy dispatch.
- Modify `scripts/content-agent/qwenPipeline.ts`: use the shared checkpoint validator without changing slice/review semantics.
- Modify `package.json`: expose local import, generation, review, and approved-release commands.
- Modify `docs/runbooks/qwen-content-update.md`: make local generation/review the recommended path and server generation a recovery-only path.
- Modify `tests/deployment/qwenSecrets.test.ts`: lock the external-secret boundary.
- Create focused tests beside each new responsibility; never test the feature only through source-string matching when behavior can be exercised.

### Task 1: Export and import exactly one compatible checkpoint

**Files:**
- Create: `.github/workflows/qwen-checkpoint-export.yml`
- Create: `scripts/content-agent/qwenCheckpoint.ts`
- Create: `scripts/import-qwen-checkpoint.ts`
- Create: `tests/contentAgent/qwenCheckpoint.test.ts`
- Create: `tests/deployment/qwenCheckpointExportWorkflow.test.ts`
- Modify: `scripts/content-agent/qwenPipeline.ts`
- Modify: `package.json`

- [ ] **Step 1: Write the failing workflow contract test**

```ts
// tests/deployment/qwenCheckpointExportWorkflow.test.ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = () => readFileSync(resolve(".github/workflows/qwen-checkpoint-export.yml"), "utf8");

describe("Qwen checkpoint export workflow", () => {
  it("exports only the requested checkpoint and never reads the Qwen secret", () => {
    const yaml = source();
    expect(yaml).toContain("workflow_dispatch:");
    expect(yaml).toContain("contents: read");
    expect(yaml).toContain("actions/upload-artifact@v4");
    expect(yaml).toContain("checkpoint-${{ inputs.version }}.json");
    expect(yaml).toContain("retention-days: 1");
    expect(yaml).not.toContain("qwen-content.env");
    expect(yaml).not.toContain("DASHSCOPE_");
    expect(yaml).not.toMatch(/scp[^\n]*(?:-r|--recursive)/);
  });
});
```

- [ ] **Step 2: Run the workflow test and verify RED**

Run: `npm test -- tests/deployment/qwenCheckpointExportWorkflow.test.ts`

Expected: FAIL because `.github/workflows/qwen-checkpoint-export.yml` does not exist.

- [ ] **Step 3: Add the manual single-file export workflow**

```yaml
# .github/workflows/qwen-checkpoint-export.yml
name: Export Qwen checkpoint

on:
  workflow_dispatch:
    inputs:
      version:
        description: Content version
        required: true
        default: 2026.08.3

permissions:
  contents: read

jobs:
  export:
    runs-on: ubuntu-latest
    steps:
      - name: Configure SSH
        env:
          TENCENT_HOST: ${{ secrets.TENCENT_HOST }}
          TENCENT_SSH_KEY: ${{ secrets.TENCENT_SSH_KEY }}
        run: |
          install -m 700 -d ~/.ssh
          printf '%s\n' "$TENCENT_SSH_KEY" > ~/.ssh/tencent_qwen
          chmod 600 ~/.ssh/tencent_qwen
          ssh-keyscan -H "$TENCENT_HOST" >> ~/.ssh/known_hosts
          chmod 600 ~/.ssh/known_hosts
      - name: Download one checkpoint
        env:
          TENCENT_HOST: ${{ secrets.TENCENT_HOST }}
          TENCENT_USER: ${{ secrets.TENCENT_USER }}
        run: |
          mkdir checkpoint
          scp -i ~/.ssh/tencent_qwen -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes \
            "$TENCENT_USER@$TENCENT_HOST:/opt/phrase-bank/.content-agent/checkpoint-${{ inputs.version }}.json" \
            "checkpoint/checkpoint-${{ inputs.version }}.json"
      - name: Remove SSH key
        if: always()
        run: rm -f ~/.ssh/tencent_qwen
      - uses: actions/upload-artifact@v4
        with:
          name: qwen-checkpoint-${{ inputs.version }}
          path: checkpoint/checkpoint-${{ inputs.version }}.json
          if-no-files-found: error
          retention-days: 1
```

- [ ] **Step 4: Write failing checkpoint compatibility tests**

```ts
// tests/contentAgent/qwenCheckpoint.test.ts
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { generateSystemContent } from "../../scripts/content-agent/generator";
import { importQwenCheckpoint, loadQwenCheckpoint } from "../../scripts/content-agent/qwenCheckpoint";

describe("Qwen checkpoint boundary", () => {
  it("accepts the legacy server checkpoint only when IDs and immutable metadata match", async () => {
    const root = await mkdtemp(join(tmpdir(), "qwen-checkpoint-"));
    const source = generateSystemContent();
    const phrases = source.phrases.slice(0, 1_220).map((phrase) => ({
      ...phrase,
      contentVersion: "2026.08.3",
      qualityVersion: "qwen-plus-review-v2",
    }));
    const path = join(root, "checkpoint.json");
    await writeFile(path, JSON.stringify({ version: "2026.08.3", phrases }));
    const loaded = await loadQwenCheckpoint({ path, version: "2026.08.3", sourceContent: source });
    expect(loaded.phrases).toHaveLength(1_220);
    expect(loaded.sourceSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects a wrong version, duplicate ID, or changed immutable metadata", async () => {
    const root = await mkdtemp(join(tmpdir(), "qwen-checkpoint-bad-"));
    const source = generateSystemContent();
    const phrase = { ...source.phrases[0], contentVersion: "2026.08.3", qualityVersion: "qwen-plus-review-v2" };
    for (const checkpoint of [
      { version: "other", phrases: [phrase] },
      { version: "2026.08.3", phrases: [phrase, phrase] },
      { version: "2026.08.3", phrases: [{ ...phrase, categoryId: "travel" }] },
    ]) {
      const path = join(root, `${Math.random()}.json`);
      await writeFile(path, JSON.stringify(checkpoint));
      await expect(loadQwenCheckpoint({ path, version: "2026.08.3", sourceContent: source })).rejects.toThrow();
    }
  });

  it("atomically imports the validated file without changing the source file", async () => {
    const root = await mkdtemp(join(tmpdir(), "qwen-import-"));
    const sourceContent = generateSystemContent();
    const source = join(root, "download.json");
    const destination = join(root, ".content-agent", "checkpoint-2026.08.3.json");
    await writeFile(source, JSON.stringify({ version: "2026.08.3", phrases: [] }));
    await importQwenCheckpoint({ source, destination, version: "2026.08.3", sourceContent });
    expect(JSON.parse(await readFile(destination, "utf8"))).toMatchObject({ version: "2026.08.3" });
    expect(await readFile(source, "utf8")).toContain("2026.08.3");
  });
});
```

- [ ] **Step 5: Run the checkpoint tests and verify RED**

Run: `npm test -- tests/contentAgent/qwenCheckpoint.test.ts`

Expected: FAIL with module-not-found for `qwenCheckpoint`.

- [ ] **Step 6: Implement strict checkpoint validation and atomic import**

```ts
// scripts/content-agent/qwenCheckpoint.ts
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { SystemContentPackage, SystemContentPhrase } from "../../app/domain/types";

type Checkpoint = { version: string; sourceSha256?: string; phrases: SystemContentPhrase[] };
type LoadOptions = { path: string; version: string; sourceContent: SystemContentPackage };

const immutable = (phrase: SystemContentPhrase) => Object.fromEntries(
  Object.entries(phrase)
    .filter(([key]) => key !== "english" && key !== "chinese" && key !== "contentVersion" && key !== "qualityVersion")
    .sort(([left], [right]) => left.localeCompare(right)),
);

export const sourceSha256 = (content: SystemContentPackage) => createHash("sha256")
  .update(JSON.stringify(content.phrases.map(immutable)))
  .digest("hex");

export async function loadQwenCheckpoint(options: LoadOptions): Promise<Required<Checkpoint>> {
  const parsed = JSON.parse(await readFile(options.path, "utf8")) as Checkpoint;
  if (parsed.version !== options.version || !Array.isArray(parsed.phrases)) throw new Error("Qwen 断点版本或格式无效");
  const expected = new Map(options.sourceContent.phrases.map((phrase) => [phrase.id, phrase]));
  const seen = new Set<string>();
  for (const phrase of parsed.phrases) {
    if (!phrase || typeof phrase.id !== "string" || seen.has(phrase.id)) throw new Error("Qwen 断点包含重复或无效 ID");
    const source = expected.get(phrase.id);
    if (!source || JSON.stringify(immutable(phrase)) !== JSON.stringify(immutable(source))) throw new Error(`Qwen 断点元数据不兼容：${phrase.id}`);
    seen.add(phrase.id);
  }
  const fingerprint = sourceSha256(options.sourceContent);
  if (parsed.sourceSha256 && parsed.sourceSha256 !== fingerprint) throw new Error("Qwen 断点输入指纹不兼容");
  return { version: parsed.version, sourceSha256: fingerprint, phrases: parsed.phrases };
}

export async function importQwenCheckpoint(options: LoadOptions & { source: string; destination: string }) {
  const checkpoint = await loadQwenCheckpoint({ ...options, path: options.source });
  await mkdir(dirname(options.destination), { recursive: true });
  const pending = `${options.destination}.pending`;
  try {
    await writeFile(pending, `${JSON.stringify(checkpoint)}\n`, { encoding: "utf8", flag: "wx" });
    await rename(pending, options.destination);
  } finally {
    await rm(pending, { force: true });
  }
  return checkpoint;
}
```

Replace the checkpoint portion of `runQwenAgent` so validation and generation use the same deterministic source:

```ts
export async function runQwenAgent(options: AgentOptions) {
  await mkdir(options.outputDir, { recursive: true });
  const checkpointPath = join(options.outputDir, `checkpoint-${options.version}.json`);
  const sourceContent = options.sourceContent ?? generateSystemContent();
  const fingerprint = sourceSha256(sourceContent);
  let resumePhrases: SystemContentPhrase[] = [];
  try {
    resumePhrases = (await loadQwenCheckpoint({ path: checkpointPath, version: options.version, sourceContent })).phrases;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const content = await buildQwenCandidate({
    ...options,
    sourceContent,
    resumePhrases,
    onBatchCompleted: async (phrases) => {
      const pending = `${checkpointPath}.pending`;
      try {
        await writeFile(pending, `${JSON.stringify({ version: options.version, sourceSha256: fingerprint, phrases })}\n`, "utf8");
        await rename(pending, checkpointPath);
      } finally {
        await rm(pending, { force: true });
      }
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
```

Add `rename` to the existing `node:fs/promises` import and import `loadQwenCheckpoint` plus `sourceSha256` from `./qwenCheckpoint`.

- [ ] **Step 7: Add the import CLI and package script**

```ts
// scripts/import-qwen-checkpoint.ts
import { resolve } from "node:path";
import { generateSystemContent } from "./content-agent/generator";
import { importQwenCheckpoint } from "./content-agent/qwenCheckpoint";

const value = (name: string) => process.argv[process.argv.indexOf(name) + 1];
const version = value("--version");
const source = value("--source");
if (!version || !source) throw new Error("需要 --version 和 --source");
const destination = resolve(`.content-agent/checkpoint-${version}.json`);
const result = await importQwenCheckpoint({ source: resolve(source), destination, version, sourceContent: generateSystemContent() });
process.stdout.write(`已导入 ${result.phrases.length} 条断点内容：${destination}\n`);
```

Add to `package.json`:

```json
"content:checkpoint:import": "tsx scripts/import-qwen-checkpoint.ts"
```

- [ ] **Step 8: Run focused tests and commit**

Run: `npm test -- tests/contentAgent/qwenCheckpoint.test.ts tests/deployment/qwenCheckpointExportWorkflow.test.ts tests/contentAgent/qwenPipeline.test.ts`

Expected: PASS.

```bash
git add .github/workflows/qwen-checkpoint-export.yml scripts/content-agent/qwenCheckpoint.ts scripts/import-qwen-checkpoint.ts scripts/content-agent/qwenPipeline.ts tests/contentAgent/qwenCheckpoint.test.ts tests/deployment/qwenCheckpointExportWorkflow.test.ts package.json
git commit -m "feat: import Qwen generation checkpoint locally"
```

### Task 2: Load the project-external Qwen secret and run locally

**Files:**
- Create: `scripts/content-agent/localQwenEnv.ts`
- Create: `scripts/run-local-qwen-content-agent.ts`
- Create: `tests/contentAgent/localQwenEnv.test.ts`
- Create: `tests/contentAgent/runLocalQwenContentAgent.test.ts`
- Modify: `package.json`
- Modify: `tests/deployment/qwenSecrets.test.ts`

- [ ] **Step 1: Write failing external-secret tests**

```ts
// tests/contentAgent/localQwenEnv.test.ts
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadLocalQwenEnv } from "../../scripts/content-agent/localQwenEnv";

describe("local Qwen environment", () => {
  it("loads only the three allowlisted values from a file outside the repository", async () => {
    const root = await mkdtemp(join(tmpdir(), "qwen-env-"));
    const path = join(root, "qwen-content.env");
    await writeFile(path, "DASHSCOPE_API_KEY=secret\nDASHSCOPE_BASE_URL=https://example.test/v1\nDASHSCOPE_MODEL=qwen-plus\n");
    await expect(loadLocalQwenEnv({ path, repositoryRoot: process.cwd() })).resolves.toEqual({
      apiKey: "secret", baseUrl: "https://example.test/v1", model: "qwen-plus",
    });
  });

  it.each([
    "DASHSCOPE_BASE_URL=https://example.test/v1\nDASHSCOPE_MODEL=qwen-plus\n",
    "DASHSCOPE_API_KEY=a\nDASHSCOPE_API_KEY=b\nDASHSCOPE_BASE_URL=https://example.test/v1\nDASHSCOPE_MODEL=qwen-plus\n",
    "DASHSCOPE_API_KEY=a\nUNKNOWN=x\nDASHSCOPE_BASE_URL=https://example.test/v1\nDASHSCOPE_MODEL=qwen-plus\n",
  ])("rejects missing, duplicate, or unknown keys", async (contents) => {
    const root = await mkdtemp(join(tmpdir(), "qwen-env-bad-"));
    const path = join(root, "qwen-content.env");
    await writeFile(path, contents);
    await expect(loadLocalQwenEnv({ path, repositoryRoot: process.cwd() })).rejects.toThrow();
  });
});
```

Add to `tests/deployment/qwenSecrets.test.ts`:

```ts
expect(sourceFiles().some((file) => readFileSync(resolve(root, file), "utf8").includes("C:\\Users\\Administrator\\.phrase-bank"))).toBe(false);
expect(readFileSync(resolve(root, ".gitignore"), "utf8")).toContain("/.content-agent/");
```

- [ ] **Step 2: Run the secret tests and verify RED**

Run: `npm test -- tests/contentAgent/localQwenEnv.test.ts tests/deployment/qwenSecrets.test.ts`

Expected: FAIL because `localQwenEnv.ts` does not exist.

- [ ] **Step 3: Implement the strict loader**

```ts
// scripts/content-agent/localQwenEnv.ts
import { lstat, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";

export const defaultLocalQwenEnvPath = () => join(homedir(), ".phrase-bank", "qwen-content.env");

export async function loadLocalQwenEnv({ path = defaultLocalQwenEnvPath(), repositoryRoot }: { path?: string; repositoryRoot: string }) {
  const resolved = resolve(path);
  const fromRepository = relative(resolve(repositoryRoot), resolved);
  if (!isAbsolute(fromRepository) && !fromRepository.startsWith("..")) throw new Error("Qwen 配置文件必须位于项目外");
  const stat = await lstat(resolved);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Qwen 配置必须是项目外的普通文件");
  const allowed = new Set(["DASHSCOPE_API_KEY", "DASHSCOPE_BASE_URL", "DASHSCOPE_MODEL"]);
  const values = new Map<string, string>();
  for (const [index, raw] of (await readFile(resolved, "utf8")).split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Z0-9_]+)=(.+)$/);
    if (!match || !allowed.has(match[1]) || values.has(match[1])) throw new Error(`Qwen 配置第 ${index + 1} 行无效`);
    values.set(match[1], match[2].trim());
  }
  const apiKey = values.get("DASHSCOPE_API_KEY");
  const baseUrl = values.get("DASHSCOPE_BASE_URL");
  const model = values.get("DASHSCOPE_MODEL");
  if (!apiKey || !baseUrl || !model) throw new Error("Qwen 配置缺少必填项");
  new URL(baseUrl);
  return { apiKey, baseUrl, model };
}
```

- [ ] **Step 4: Write the failing local-runner test**

```ts
// tests/contentAgent/runLocalQwenContentAgent.test.ts
import { describe, expect, it, vi } from "vitest";
import { createLocalAgentOptions } from "../../scripts/run-local-qwen-content-agent";

describe("local Qwen runner", () => {
  it("uses the reviewed v2 pipeline and local ignored output directory without exposing the key", () => {
    const client = { complete: vi.fn() };
    const options = createLocalAgentOptions("2026.08.3", client, "2026-08-18T00:00:00.000Z");
    expect(options).toMatchObject({ version: "2026.08.3", qualityVersion: "qwen-plus-review-v2", client });
    expect(options.outputDir.replaceAll("\\", "/")).toMatch(/\/\.content-agent$/);
    expect(JSON.stringify(options)).not.toContain("DASHSCOPE_API_KEY");
  });
});
```

- [ ] **Step 5: Implement the local runner and script**

```ts
// scripts/run-local-qwen-content-agent.ts
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createQwenAgentOptions, QWEN_REVIEW_QUALITY_VERSION } from "./run-qwen-content-agent";
import { createQwenClient, type QwenClient } from "./content-agent/qwenClient";
import { loadLocalQwenEnv } from "./content-agent/localQwenEnv";
import { runQwenAgent } from "./content-agent/qwenPipeline";

const argument = (name: string) => process.argv[process.argv.indexOf(name) + 1];

export function createLocalAgentOptions(version: string, client: QwenClient, generatedAt: string) {
  return { ...createQwenAgentOptions(version, client, generatedAt), qualityVersion: QWEN_REVIEW_QUALITY_VERSION, outputDir: resolve(".content-agent") };
}

async function main() {
  const version = argument("--version");
  if (!version) throw new Error("请通过 --version 指定候选版本");
  const config = await loadLocalQwenEnv({ repositoryRoot: process.cwd() });
  process.stdout.write("本地 Qwen 配置已验证；不会显示密钥。\n");
  const client = createQwenClient({ ...config, timeoutMs: 120_000 });
  const result = await runQwenAgent(createLocalAgentOptions(version, client, new Date().toISOString()));
  process.stdout.write(`候选内容已生成：${result.candidatePath}\n质检报告：${result.reportPath}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
```

Add to `package.json`:

```json
"content:qwen:local": "tsx scripts/run-local-qwen-content-agent.ts"
```

- [ ] **Step 6: Run focused tests and commit**

Run: `npm test -- tests/contentAgent/localQwenEnv.test.ts tests/contentAgent/runLocalQwenContentAgent.test.ts tests/contentAgent/qwenClient.test.ts tests/contentAgent/qwenPipeline.test.ts tests/deployment/qwenSecrets.test.ts`

Expected: PASS.

```bash
git add scripts/content-agent/localQwenEnv.ts scripts/run-local-qwen-content-agent.ts tests/contentAgent/localQwenEnv.test.ts tests/contentAgent/runLocalQwenContentAgent.test.ts tests/deployment/qwenSecrets.test.ts package.json
git commit -m "feat: run Qwen generation safely on localhost"
```

### Task 3: Build the pure review model, sampling, and quality hints

**Files:**
- Create: `scripts/content-agent/localReview.ts`
- Create: `tests/contentAgent/localReview.test.ts`

- [ ] **Step 1: Write failing review-domain tests**

```ts
// tests/contentAgent/localReview.test.ts
import { describe, expect, it } from "vitest";
import { buildReviewModel, candidateSha256, decideReviewItem, approveReview } from "../../scripts/content-agent/localReview";
import { generateSystemContent } from "../../scripts/content-agent/generator";

const candidate = () => ({ ...generateSystemContent(), version: "2026.08.3", qualityVersion: "qwen-plus-review-v2" });

describe("local content review model", () => {
  it("creates a deterministic sample covering every category and work/supply-chain packaging content", () => {
    const first = buildReviewModel(candidate(), "fixed-seed");
    const second = buildReviewModel(candidate(), "fixed-seed");
    expect(first.sampledIds).toEqual(second.sampledIds);
    expect(new Set(first.sample.map((phrase) => phrase.categoryId))).toEqual(new Set(["daily", "travel", "work", "business", "supply-chain", "social"]));
    expect(first.sample.some((phrase) => /packag/i.test(`${phrase.subcategory} ${phrase.english}`))).toBe(true);
  });

  it("flags repeated openings, placeholders, empty translations, and likely missing translated context", () => {
    const content = candidate();
    content.phrases[0].english = "For packaging review, regarding xxx";
    content.phrases[0].chinese = "包装。";
    const model = buildReviewModel(content, "seed");
    expect(model.hintsById[content.phrases[0].id].map(({ code }) => code)).toEqual(expect.arrayContaining(["placeholder", "missing-context"]));
  });

  it("invalidates approval after candidate bytes change and blocks any issue or undecided sampled item", () => {
    const model = buildReviewModel(candidate(), "seed");
    let state = model.sampledIds.reduce((current, id) => decideReviewItem(current, model.candidateSha256, id, "pass", ""), model.initialState);
    expect(approveReview(state, model.candidateSha256, "2026.08.3").approvedAt).toBeTruthy();
    expect(() => approveReview(state, candidateSha256(JSON.stringify({ changed: true })), "2026.08.3")).toThrow("候选内容已变化");
    state = decideReviewItem(state, model.candidateSha256, model.sampledIds[0], "issue", "中文漏译");
    expect(() => approveReview(state, model.candidateSha256, "2026.08.3")).toThrow("仍有问题");
  });
});
```

- [ ] **Step 2: Run and verify RED**

Run: `npm test -- tests/contentAgent/localReview.test.ts`

Expected: FAIL because `localReview.ts` does not exist.

- [ ] **Step 3: Implement the review types and rules**

```ts
// scripts/content-agent/localReview.ts
import { createHash } from "node:crypto";
import type { SystemContentPackage, SystemContentPhrase } from "../../app/domain/types";

export type ReviewDecision = "pass" | "issue";
export type ReviewItem = { decision: ReviewDecision; note: string; updatedAt: string };
export type ReviewState = {
  format: "phrase-bank-local-review";
  version: string;
  candidateSha256: string;
  sampleSeed: string;
  sampledIds: string[];
  items: Record<string, ReviewItem>;
  approvedAt?: string;
};
export type QualityHint = { code: "repeated-opening" | "missing-context" | "placeholder" | "empty"; message: string };

export const candidateSha256 = (raw: string) => createHash("sha256").update(raw).digest("hex");
const hashNumber = (seed: string, id: string) => Number.parseInt(createHash("sha256").update(`${seed}:${id}`).digest("hex").slice(0, 12), 16);

export function qualityHints(content: SystemContentPackage) {
  const result: Record<string, QualityHint[]> = Object.fromEntries(content.phrases.map(({ id }) => [id, []]));
  const openingGroups = new Map<string, SystemContentPhrase[]>();
  for (const phrase of content.phrases) {
    const english = phrase.english.trim();
    const chinese = phrase.chinese.trim();
    if (!english || !chinese) result[phrase.id].push({ code: "empty", message: "英文或中文为空" });
    if (/\b(?:xxx|tbd|placeholder)\b/i.test(`${english} ${chinese}`)) result[phrase.id].push({ code: "placeholder", message: "包含占位文本" });
    if (/^(?:for|regarding|when it comes to)\b/i.test(english) && chinese.length < 8) result[phrase.id].push({ code: "missing-context", message: "中文可能没有完整翻译英文场景" });
    const opening = english.toLowerCase().split(/[,.!?]/, 1)[0].trim();
    openingGroups.set(opening, [...(openingGroups.get(opening) ?? []), phrase]);
  }
  for (const [opening, phrases] of openingGroups) if (opening && phrases.length >= 4) {
    for (const phrase of phrases) result[phrase.id].push({ code: "repeated-opening", message: `重复开头：${opening}` });
  }
  return result;
}

export function buildReviewModel(content: SystemContentPackage, sampleSeed: string) {
  const raw = `${JSON.stringify(content, null, 2)}\n`;
  const mustInclude = content.phrases
    .filter((phrase) => phrase.categoryId === "work" || phrase.categoryId === "supply-chain" || /packag/i.test(`${phrase.subcategory} ${phrase.english}`))
    .sort((left, right) => hashNumber(sampleSeed, left.id) - hashNumber(sampleSeed, right.id))
    .slice(0, 20);
  const byCategory = ["daily", "travel", "work", "business", "supply-chain", "social"].flatMap((category) => content.phrases
    .filter((phrase) => phrase.categoryId === category)
    .sort((left, right) => hashNumber(sampleSeed, left.id) - hashNumber(sampleSeed, right.id))
    .slice(0, 10));
  const sample = [...new Map([...byCategory, ...mustInclude].map((phrase) => [phrase.id, phrase])).values()];
  const sha = candidateSha256(raw);
  const sampledIds = sample.map(({ id }) => id);
  const initialState: ReviewState = { format: "phrase-bank-local-review", version: content.version, candidateSha256: sha, sampleSeed, sampledIds, items: {} };
  return { candidateSha256: sha, sampledIds, sample, hintsById: qualityHints(content), initialState };
}

export function decideReviewItem(state: ReviewState, sha: string, id: string, decision: ReviewDecision, note: string): ReviewState {
  if (state.candidateSha256 !== sha || !state.sampledIds.includes(id)) throw new Error("候选内容或抽样 ID 不匹配");
  return { ...state, approvedAt: undefined, items: { ...state.items, [id]: { decision, note: note.trim(), updatedAt: new Date().toISOString() } } };
}

export function approveReview(state: ReviewState, sha: string, version: string): ReviewState {
  if (state.candidateSha256 !== sha || state.version !== version) throw new Error("候选内容已变化");
  if (state.sampledIds.some((id) => !state.items[id] || state.items[id].decision !== "pass")) throw new Error("仍有问题或未完成的抽样条目");
  return { ...state, approvedAt: new Date().toISOString() };
}
```

- [ ] **Step 4: Run tests and commit**

Run: `npm test -- tests/contentAgent/localReview.test.ts`

Expected: PASS.

```bash
git add scripts/content-agent/localReview.ts tests/contentAgent/localReview.test.ts
git commit -m "feat: model local phrase review decisions"
```

### Task 4: Persist review state atomically and invalidate stale approval

**Files:**
- Create: `scripts/content-agent/localReviewStore.ts`
- Create: `tests/contentAgent/localReviewStore.test.ts`

- [ ] **Step 1: Write failing persistence tests**

```ts
// tests/contentAgent/localReviewStore.test.ts
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadOrCreateReview, saveReview } from "../../scripts/content-agent/localReviewStore";

describe("local review persistence", () => {
  it("preserves decisions for the same hash and resets them for changed candidate bytes", async () => {
    const root = await mkdtemp(join(tmpdir(), "review-store-"));
    const path = join(root, "review.json");
    const first = await loadOrCreateReview({ path, version: "2026.08.3", candidateSha256: "a".repeat(64), sampleSeed: "seed", sampledIds: ["one"] });
    await saveReview(path, { ...first, approvedAt: "2026-08-18T00:00:00.000Z", items: { one: { decision: "pass", note: "", updatedAt: "now" } } });
    const same = await loadOrCreateReview({ path, version: "2026.08.3", candidateSha256: "a".repeat(64), sampleSeed: "seed", sampledIds: ["one"] });
    expect(same.approvedAt).toBeTruthy();
    const changed = await loadOrCreateReview({ path, version: "2026.08.3", candidateSha256: "b".repeat(64), sampleSeed: "seed", sampledIds: ["one"] });
    expect(changed.items).toEqual({});
    expect(changed.approvedAt).toBeUndefined();
    expect(await readFile(path, "utf8")).not.toContain(".pending");
  });

  it("does not replace a valid review when an atomic pending write fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "review-failure-"));
    const path = join(root, "review.json");
    await writeFile(path, '{"existing":true}\n');
    await expect(saveReview(path, { circular: undefined } as never, async () => { throw new Error("disk full"); })).rejects.toThrow("disk full");
    expect(await readFile(path, "utf8")).toBe('{"existing":true}\n');
  });
});
```

- [ ] **Step 2: Run and verify RED**

Run: `npm test -- tests/contentAgent/localReviewStore.test.ts`

Expected: FAIL because `localReviewStore.ts` does not exist.

- [ ] **Step 3: Implement atomic storage**

```ts
// scripts/content-agent/localReviewStore.ts
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ReviewState } from "./localReview";

type Seed = Pick<ReviewState, "version" | "candidateSha256" | "sampleSeed" | "sampledIds"> & { path: string };
type Writer = typeof writeFile;

export async function saveReview(path: string, state: ReviewState, writer: Writer = writeFile) {
  await mkdir(dirname(path), { recursive: true });
  const pending = `${path}.pending`;
  try {
    await writer(pending, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", flag: "w" });
    await rename(pending, path);
  } finally {
    await rm(pending, { force: true });
  }
}

export async function loadOrCreateReview(seed: Seed): Promise<ReviewState> {
  try {
    const current = JSON.parse(await readFile(seed.path, "utf8")) as ReviewState;
    if (current.format === "phrase-bank-local-review" && current.version === seed.version && current.candidateSha256 === seed.candidateSha256 && current.sampleSeed === seed.sampleSeed && JSON.stringify(current.sampledIds) === JSON.stringify(seed.sampledIds)) return current;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const state: ReviewState = { format: "phrase-bank-local-review", version: seed.version, candidateSha256: seed.candidateSha256, sampleSeed: seed.sampleSeed, sampledIds: seed.sampledIds, items: {} };
  await saveReview(seed.path, state);
  return state;
}
```

- [ ] **Step 4: Run tests and commit**

Run: `npm test -- tests/contentAgent/localReviewStore.test.ts tests/contentAgent/localReview.test.ts`

Expected: PASS.

```bash
git add scripts/content-agent/localReviewStore.ts tests/contentAgent/localReviewStore.test.ts
git commit -m "feat: persist local phrase review safely"
```

### Task 5: Build the localhost review page

**Files:**
- Create: `scripts/content-agent/localReviewPage.ts`
- Create: `tests/contentAgent/localReviewPage.test.ts`

- [ ] **Step 1: Write a failing UI contract test**

```ts
// tests/contentAgent/localReviewPage.test.ts
import { describe, expect, it } from "vitest";
import { renderLocalReviewPage } from "../../scripts/content-agent/localReviewPage";

describe("local review page", () => {
  it("renders searchable bilingual review controls without editable candidate text", () => {
    const html = renderLocalReviewPage();
    expect(html).toContain("本地 Qwen 句库审核");
    expect(html).toContain('id="search"');
    expect(html).toContain('id="category"');
    expect(html).toContain('id="subcategory"');
    expect(html).toContain('id="sample-only"');
    expect(html).toContain('data-action="pass"');
    expect(html).toContain('data-action="issue"');
    expect(html).toContain('id="approve"');
    expect(html).toContain("fetch('/api/review')");
    expect(html).not.toMatch(/contenteditable/i);
    expect(html).not.toContain("textarea class=\"english\"");
  });
});
```

- [ ] **Step 2: Run and verify RED**

Run: `npm test -- tests/contentAgent/localReviewPage.test.ts`

Expected: FAIL because `localReviewPage.ts` does not exist.

- [ ] **Step 3: Implement a complete dependency-free page**

Create `renderLocalReviewPage(): string` returning one HTML document with:

```ts
// scripts/content-agent/localReviewPage.ts
export function renderLocalReviewPage() {
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>本地 Qwen 句库审核</title><style>
:root{font-family:system-ui,sans-serif;color:#173f35;background:#fbf8f0}body{margin:0}header{position:sticky;top:0;background:#fbf8f0;padding:16px;border-bottom:1px solid #d9d4c8;z-index:2}.filters{display:flex;gap:8px;flex-wrap:wrap}input,select,button,textarea{font:inherit;padding:10px;border:1px solid #aaa;border-radius:8px}main{max-width:1100px;margin:auto;padding:16px}.phrase{background:white;border:1px solid #ded8ca;border-radius:12px;padding:16px;margin:12px 0}.pair{display:grid;grid-template-columns:1fr 1fr;gap:16px}.meta,.hints{font-size:.86rem;color:#59635d}.hint{color:#a33}.actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.pass[aria-pressed=true]{background:#267453;color:white}.issue[aria-pressed=true]{background:#a84631;color:white}#approve{background:#267453;color:white}#approve:disabled{background:#d8d5cc;color:#59635d}@media(max-width:700px){.pair{grid-template-columns:1fr}}
</style></head><body><header><h1>本地 Qwen 句库审核</h1><p id="summary" role="status">正在读取候选内容…</p><div class="filters"><input id="search" type="search" placeholder="搜索中英文、ID、场景"><select id="category"><option value="">全部分类</option></select><select id="subcategory"><option value="">全部子场景</option></select><select id="kind"><option value="">核心和例句</option><option value="core">核心句</option><option value="example">例句</option></select><label><input id="sample-only" type="checkbox" checked>只看抽样</label></div></header><main><div id="phrases"></div><button id="approve" disabled>批准发布当前版本</button></main>
<template id="row"><article class="phrase"><div class="meta"></div><div class="pair"><section class="english" lang="en"></section><section class="chinese" lang="zh-CN"></section></div><div class="hints"></div><div class="actions"><button class="pass" data-action="pass">通过</button><button class="issue" data-action="issue">有问题</button><textarea rows="2" placeholder="问题备注"></textarea></div></article></template>
<script type="module">
let model; const search=document.querySelector('#search'), category=document.querySelector('#category'), subcategory=document.querySelector('#subcategory'), kind=document.querySelector('#kind'), sampleOnly=document.querySelector('#sample-only'), list=document.querySelector('#phrases'), approve=document.querySelector('#approve');
const escapeText=value=>String(value??'');
async function request(path,body){const response=await fetch(path,{method:body?'POST':'GET',headers:body?{'content-type':'application/json'}:{},body:body?JSON.stringify(body):undefined});const data=await response.json();if(!response.ok)throw new Error(data.error||'请求失败');return data}
function visible(phrase){const q=search.value.trim().toLowerCase();return (!category.value||phrase.categoryId===category.value)&&(!subcategory.value||phrase.subcategory===subcategory.value)&&(!kind.value||phrase.kind===kind.value)&&(!sampleOnly.checked||model.review.sampledIds.includes(phrase.id))&&(!q||[phrase.id,phrase.english,phrase.chinese,phrase.subcategory].some(value=>escapeText(value).toLowerCase().includes(q)))}
function render(){document.querySelector('#summary').textContent=`版本 ${model.content.version} · 核心 ${model.report.coreCount} · 总计 ${model.report.totalCount} · 已审核 ${Object.keys(model.review.items).length}/${model.review.sampledIds.length}`;list.replaceChildren(...model.content.phrases.filter(visible).map(phrase=>{const node=document.querySelector('#row').content.firstElementChild.cloneNode(true),item=model.review.items[phrase.id];node.dataset.id=phrase.id;node.querySelector('.meta').textContent=`${phrase.id} · ${phrase.categoryId} · ${phrase.subcategory} · ${phrase.kind}`;node.querySelector('.english').textContent=phrase.english;node.querySelector('.chinese').textContent=phrase.chinese;node.querySelector('.hints').textContent=(model.hintsById[phrase.id]||[]).map(h=>h.message).join('；');node.querySelector('.pass').setAttribute('aria-pressed',String(item?.decision==='pass'));node.querySelector('.issue').setAttribute('aria-pressed',String(item?.decision==='issue'));node.querySelector('textarea').value=item?.note||'';return node}));approve.disabled=!model.canApprove}
list.addEventListener('click',async event=>{const button=event.target.closest('[data-action]');if(!button)return;const row=button.closest('.phrase'),note=row.querySelector('textarea').value;model=await request('/api/decision',{id:row.dataset.id,decision:button.dataset.action,note,candidateSha256:model.candidateSha256});render()});
approve.addEventListener('click',async()=>{if(!confirm(`批准版本 ${model.content.version}？批准后仍需单独运行发布命令。`))return;model=await request('/api/approve',{version:model.content.version,candidateSha256:model.candidateSha256});render()});
[search,category,subcategory,kind,sampleOnly].forEach(element=>element.addEventListener('input',render));
model=await request('/api/review');for(const value of [...new Set(model.content.phrases.map(p=>p.categoryId))])category.add(new Option(value,value));for(const value of [...new Set(model.content.phrases.map(p=>p.subcategory))].sort())subcategory.add(new Option(value,value));render();
</script></body></html>`;
}
```

Candidate English/Chinese remain text nodes populated through `textContent`; only the note textarea is editable.

- [ ] **Step 4: Run tests and commit**

Run: `npm test -- tests/contentAgent/localReviewPage.test.ts`

Expected: PASS.

```bash
git add scripts/content-agent/localReviewPage.ts tests/contentAgent/localReviewPage.test.ts
git commit -m "feat: add local bilingual review page"
```

### Task 6: Serve the page only on 127.0.0.1

**Files:**
- Create: `scripts/content-agent/localReviewServer.ts`
- Create: `scripts/run-local-content-review.ts`
- Create: `tests/contentAgent/localReviewServer.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Write failing server behavior tests**

```ts
// tests/contentAgent/localReviewServer.test.ts
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { generateSystemContent } from "../../scripts/content-agent/generator";
import { inspectSystemContent } from "../../scripts/content-agent/qualityGate";
import { startLocalReviewServer } from "../../scripts/content-agent/localReviewServer";

const servers: Array<{ close(): Promise<void> }> = [];
afterEach(async () => Promise.all(servers.splice(0).map((server) => server.close())));

describe("local review server", () => {
  it("binds only loopback, persists decisions, and refuses approval with unresolved items", async () => {
    const root = await mkdtemp(join(tmpdir(), "review-server-"));
    const content = { ...generateSystemContent(), version: "2026.08.3", qualityVersion: "qwen-plus-review-v2" };
    const candidatePath = join(root, "candidate.json"), reportPath = join(root, "report.json"), reviewPath = join(root, "review.json");
    await writeFile(candidatePath, `${JSON.stringify(content)}\n`);
    await writeFile(reportPath, `${JSON.stringify({ status: "pass", version: content.version, ...inspectSystemContent(content) })}\n`);
    const server = await startLocalReviewServer({ candidatePath, reportPath, reviewPath, host: "127.0.0.1", port: 0, sampleSeed: "test" });
    servers.push(server);
    expect(server.host).toBe("127.0.0.1");
    const model = await fetch(`${server.url}/api/review`).then((response) => response.json());
    expect(model.content.phrases).toHaveLength(2000);
    const approval = await fetch(`${server.url}/api/approve`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ version: content.version, candidateSha256: model.candidateSha256 }) });
    expect(approval.status).toBe(409);
  });

  it("rejects non-loopback hosts and oversized or non-JSON writes", async () => {
    await expect(startLocalReviewServer({ candidatePath: "x", reportPath: "y", reviewPath: "z", host: "0.0.0.0", port: 0, sampleSeed: "test" })).rejects.toThrow("127.0.0.1");
  });
});
```

- [ ] **Step 2: Run and verify RED**

Run: `npm test -- tests/contentAgent/localReviewServer.test.ts`

Expected: FAIL because `localReviewServer.ts` does not exist.

- [ ] **Step 3: Implement the server with an injectable lifecycle**

```ts
// scripts/content-agent/localReviewServer.ts
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { validateSystemContentPackage } from "../../app/domain/systemContent";
import { approveReview, buildReviewModel, decideReviewItem } from "./localReview";
import { loadOrCreateReview, saveReview } from "./localReviewStore";
import { renderLocalReviewPage } from "./localReviewPage";

type Options = { candidatePath: string; reportPath: string; reviewPath: string; host: string; port: number; sampleSeed: string };
const json = (response: ServerResponse, status: number, value: unknown) => { response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }); response.end(JSON.stringify(value)); };
async function body(request: IncomingMessage) { const chunks: Buffer[] = []; let size = 0; for await (const chunk of request) { size += chunk.length; if (size > 32_768) throw new Error("请求过大"); chunks.push(chunk); } if (!request.headers["content-type"]?.startsWith("application/json")) throw new Error("只接受 JSON"); return JSON.parse(Buffer.concat(chunks).toString("utf8")); }

export async function startLocalReviewServer(options: Options) {
  if (options.host !== "127.0.0.1") throw new Error("审核服务只能监听 127.0.0.1");
  const candidateRaw = await readFile(options.candidatePath, "utf8");
  const content = validateSystemContentPackage(JSON.parse(candidateRaw));
  const report = JSON.parse(await readFile(options.reportPath, "utf8"));
  if (report.status !== "pass" || report.version !== content.version || report.coreCount !== 600 || report.totalCount !== 2000 || report.errors?.length) throw new Error("候选报告不允许审核");
  const model = buildReviewModel(content, options.sampleSeed);
  let review = await loadOrCreateReview({ path: options.reviewPath, version: content.version, candidateSha256: model.candidateSha256, sampleSeed: options.sampleSeed, sampledIds: model.sampledIds });
  const payload = () => ({ content, report, review, candidateSha256: model.candidateSha256, hintsById: model.hintsById, canApprove: review.sampledIds.every((id) => review.items[id]?.decision === "pass") && !review.approvedAt });
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);
      if (request.method === "GET" && url.pathname === "/") { response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }); response.end(renderLocalReviewPage()); return; }
      if (request.method === "GET" && url.pathname === "/api/review") return json(response, 200, payload());
      if (request.method === "POST" && url.pathname === "/api/decision") { const input = await body(request); review = decideReviewItem(review, input.candidateSha256, input.id, input.decision, input.note ?? ""); await saveReview(options.reviewPath, review); return json(response, 200, payload()); }
      if (request.method === "POST" && url.pathname === "/api/approve") { const input = await body(request); review = approveReview(review, input.candidateSha256, input.version); await saveReview(options.reviewPath, review); return json(response, 200, payload()); }
      json(response, 404, { error: "未找到" });
    } catch (error) { json(response, error instanceof SyntaxError ? 400 : 409, { error: error instanceof Error ? error.message : "请求失败" }); }
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(options.port, options.host, resolve); });
  const address = server.address(); if (!address || typeof address === "string") throw new Error("无法读取审核服务地址");
  return { host: options.host, url: `http://${options.host}:${address.port}`, close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) };
}
```

- [ ] **Step 4: Add the CLI and package script**

```ts
// scripts/run-local-content-review.ts
import { resolve } from "node:path";
import { startLocalReviewServer } from "./content-agent/localReviewServer";
const argument = (name: string) => process.argv[process.argv.indexOf(name) + 1];
const version = argument("--version");
if (!version) throw new Error("请通过 --version 指定候选版本");
const server = await startLocalReviewServer({
  candidatePath: resolve(`.content-agent/candidate-${version}.json`),
  reportPath: resolve(`.content-agent/report-${version}.json`),
  reviewPath: resolve(`.content-agent/review-${version}.json`),
  host: "127.0.0.1", port: 43127, sampleSeed: `${version}:manual-review-v1`,
});
process.stdout.write(`本地审核页：${server.url}\n按 Ctrl+C 停止；候选内容不会上传。\n`);
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, async () => { await server.close(); process.exit(0); });
```

Add to `package.json`:

```json
"content:review": "tsx scripts/run-local-content-review.ts"
```

- [ ] **Step 5: Run tests and commit**

Run: `npm test -- tests/contentAgent/localReviewServer.test.ts tests/contentAgent/localReviewPage.test.ts tests/contentAgent/localReviewStore.test.ts tests/contentAgent/localReview.test.ts`

Expected: PASS.

```bash
git add scripts/content-agent/localReviewServer.ts scripts/run-local-content-review.ts tests/contentAgent/localReviewServer.test.ts package.json
git commit -m "feat: serve local Qwen review on loopback"
```

### Task 7: Require explicit approval before publishing

**Files:**
- Create: `scripts/content-agent/approvedRelease.ts`
- Create: `scripts/release-approved-qwen-content.ts`
- Create: `tests/contentAgent/approvedRelease.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Write failing release-guard tests**

```ts
// tests/contentAgent/approvedRelease.test.ts
import { describe, expect, it, vi } from "vitest";
import { validateApprovedRelease, runApprovedRelease } from "../../scripts/content-agent/approvedRelease";

const review = { format: "phrase-bank-local-review", version: "2026.08.3", candidateSha256: "a".repeat(64), sampleSeed: "seed", sampledIds: ["one"], items: { one: { decision: "pass", note: "", updatedAt: "now" } }, approvedAt: "2026-08-18T00:00:00.000Z" } as const;

describe("approved Qwen release", () => {
  it("rejects missing approval, hash drift, unresolved issues, and branch drift", async () => {
    expect(() => validateApprovedRelease({ review: { ...review, approvedAt: undefined }, candidateSha256: review.candidateSha256, version: review.version })).toThrow("未批准");
    expect(() => validateApprovedRelease({ review, candidateSha256: "b".repeat(64), version: review.version })).toThrow("候选内容已变化");
    expect(() => validateApprovedRelease({ review: { ...review, items: { one: { ...review.items.one, decision: "issue" as const } } }, candidateSha256: review.candidateSha256, version: review.version })).toThrow("仍有问题");
  });

  it("publishes, gates, stages only two files, commits once, non-force pushes, then dispatches deploy", async () => {
    const calls: string[][] = [];
    let statusCalls = 0;
    const execute = vi.fn(async (...command: string[]) => {
      calls.push(command);
      if (command[0] === "git" && command[1] === "status") return statusCalls++ === 0 ? "" : " M app/domain/bundledSystemContent.ts\n?? public/content/system-content-2026.08.3.json\n";
      return "same\n";
    });
    await runApprovedRelease({ version: "2026.08.3", execute, validate: vi.fn(), publish: vi.fn() });
    expect(calls).toContainEqual(["git", "add", "public/content/system-content-2026.08.3.json", "app/domain/bundledSystemContent.ts"]);
    expect(calls.filter(([program, action]) => program === "git" && action === "commit")).toHaveLength(1);
    expect(calls).toContainEqual(["git", "push", "origin", "HEAD:main"]);
    expect(calls.flat().join(" ")).not.toMatch(/--force|-f\b/);
    expect(calls.at(-1)).toEqual(["gh", "workflow", "run", "deploy.yml", "--ref", "main"]);
  });
});
```

- [ ] **Step 2: Run and verify RED**

Run: `npm test -- tests/contentAgent/approvedRelease.test.ts`

Expected: FAIL because `approvedRelease.ts` does not exist.

- [ ] **Step 3: Implement approval and exact-file validation**

```ts
// scripts/content-agent/approvedRelease.ts
import type { ReviewState } from "./localReview";

export function validateApprovedRelease({ review, candidateSha256, version }: { review: ReviewState; candidateSha256: string; version: string }) {
  if (!review.approvedAt) throw new Error("候选版本尚未批准");
  if (review.version !== version || review.candidateSha256 !== candidateSha256) throw new Error("候选内容已变化");
  if (review.sampledIds.some((id) => review.items[id]?.decision !== "pass")) throw new Error("审核仍有问题或未完成条目");
}

type Execute = (...command: string[]) => Promise<string>;
export async function runApprovedRelease({ version, execute, validate, publish }: { version: string; execute: Execute; validate: () => Promise<void>; publish: () => Promise<void> }) {
  if ((await execute("git", "status", "--porcelain", "--untracked-files=no")).trim()) throw new Error("发布工作树必须没有已跟踪改动");
  const head = (await execute("git", "rev-parse", "HEAD")).trim();
  const remote = (await execute("git", "rev-parse", "origin/main")).trim();
  if (head !== remote) throw new Error("发布分支必须与 origin/main 完全一致");
  await validate();
  await publish();
  await execute("npm", "test");
  await execute("npm", "run", "lint");
  await execute("npm", "run", "build");
  await execute("git", "diff", "--check");
  const allowed = [`public/content/system-content-${version}.json`, "app/domain/bundledSystemContent.ts"];
  const changed = (await execute("git", "status", "--porcelain", "--untracked-files=all")).trim().split(/\r?\n/).filter(Boolean).map((line) => line.slice(3).replaceAll("\\", "/"));
  if (changed.length !== 2 || changed.some((path) => !allowed.includes(path))) throw new Error(`发布只允许改变两个内容文件：${changed.join(", ")}`);
  await execute("git", "fetch", "origin", "main");
  if ((await execute("git", "rev-parse", "origin/main")).trim() !== head) throw new Error("审核期间 main 已变化");
  await execute("git", "add", ...allowed);
  await execute("git", "diff", "--cached", "--check");
  await execute("git", "commit", "-m", `content: publish Qwen phrase library ${version}`);
  await execute("git", "push", "origin", "HEAD:main");
  await execute("gh", "workflow", "run", "deploy.yml", "--ref", "main");
}
```

- [ ] **Step 4: Add the executable release wrapper**

```ts
// scripts/release-approved-qwen-content.ts
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { publishCandidate } from "./content-agent/publisher";
import { runApprovedRelease, validateApprovedRelease } from "./content-agent/approvedRelease";
import type { ReviewState } from "./content-agent/localReview";

const argument = (name: string) => process.argv[process.argv.indexOf(name) + 1];
const version = argument("--version");
if (!version) throw new Error("请通过 --version 指定已批准版本");
const executeFile = promisify(execFile);
const execute = async (...command: string[]) => {
  const [program, ...args] = command;
  if (program === "npm") {
    const npmCli = process.env.npm_execpath;
    if (!npmCli) throw new Error("无法定位 npm CLI；请通过 npm run content:release:approved 执行");
    return (await executeFile(process.execPath, [npmCli, ...args], { encoding: "utf8", windowsHide: true })).stdout;
  }
  return (await executeFile(program, args, { encoding: "utf8", windowsHide: true })).stdout;
};
const candidatePath = resolve(`.content-agent/candidate-${version}.json`), reportPath = resolve(`.content-agent/report-${version}.json`), reviewPath = resolve(`.content-agent/review-${version}.json`);
await runApprovedRelease({
  version,
  execute,
  validate: async () => {
    const candidate = await readFile(candidatePath, "utf8");
    const review = JSON.parse(await readFile(reviewPath, "utf8")) as ReviewState;
    validateApprovedRelease({ review, candidateSha256: createHash("sha256").update(candidate).digest("hex"), version });
  },
  publish: () => publishCandidate({ version, candidatePath, reportPath, publicDir: resolve("public/content"), versionModulePath: resolve("app/domain/bundledSystemContent.ts") }).then(() => undefined),
});
```

Add to `package.json`:

```json
"content:release:approved": "tsx scripts/release-approved-qwen-content.ts"
```

- [ ] **Step 5: Run tests and commit**

Run: `npm test -- tests/contentAgent/approvedRelease.test.ts tests/contentAgent/publisher.test.ts tests/contentAgent/localReview.test.ts`

Expected: PASS.

```bash
git add scripts/content-agent/approvedRelease.ts scripts/release-approved-qwen-content.ts tests/contentAgent/approvedRelease.test.ts package.json
git commit -m "feat: gate Qwen release on local approval"
```

### Task 8: Document and contract-test the local operator flow

**Files:**
- Modify: `docs/runbooks/qwen-content-update.md`
- Modify: `tests/deployment/qwenContentReleaseWorkflow.test.ts`
- Modify: `tests/deployment/qwenSecrets.test.ts`

- [ ] **Step 1: Write failing runbook assertions**

Add assertions:

```ts
expect(runbook()).toContain("C:\\Users\\Administrator\\.phrase-bank\\qwen-content.env");
expect(runbook()).toContain("Export Qwen checkpoint");
expect(runbook()).toContain("content:checkpoint:import");
expect(runbook()).toContain("content:qwen:local");
expect(runbook()).toContain("content:review");
expect(runbook()).toContain("content:release:approved");
expect(runbook()).toContain("127.0.0.1");
expect(runbook()).toContain("页面批准不会直接提交");
```

Update the server-workflow contract so it states that `qwen-content-release.yml` is recovery-only and is not dispatched by any local command. Keep all existing secret and non-force-push assertions.

- [ ] **Step 2: Run and verify RED**

Run: `npm test -- tests/deployment/qwenContentReleaseWorkflow.test.ts tests/deployment/qwenSecrets.test.ts`

Expected: FAIL because the runbook still recommends server generation.

- [ ] **Step 3: Rewrite the runbook as exact operator commands**

The recommended section must contain this sequence:

```powershell
# 1. Create the external secret once. Paste the real key only in Notepad.
New-Item -ItemType Directory -Force "$env:USERPROFILE\.phrase-bank" | Out-Null
notepad "$env:USERPROFILE\.phrase-bank\qwen-content.env"

# 2. Export the existing server checkpoint without exporting the key.
gh workflow run qwen-checkpoint-export.yml -f version=2026.08.3
$runId = gh run list --workflow qwen-checkpoint-export.yml --limit 1 --json databaseId --jq '.[0].databaseId'
gh run watch $runId --exit-status
gh run download $runId -n qwen-checkpoint-2026.08.3 -D .content-agent-download
npm run content:checkpoint:import -- --version 2026.08.3 --source .content-agent-download/checkpoint-2026.08.3.json

# 3. Resume locally, then inspect locally.
npm run content:qwen:local -- --version 2026.08.3
npm run content:review -- --version 2026.08.3

# 4. Only after the page says approved, run from a clean release worktree.
npm run content:release:approved -- --version 2026.08.3
```

Also document:

- The expected imported checkpoint is 1,220 phrases / logical progress 68 of 120; the runner recalculates progress from stable IDs rather than trusting this prose.
- The external file contains exactly the three allowlisted keys and must not be pasted into chat or committed.
- The page is `http://127.0.0.1:43127`, candidate text is read-only, and only notes/decisions are editable.
- Marking any item “有问题” blocks approval; fixing content requires regeneration and a new hash/review.
- Page approval writes only `.content-agent/review-2026.08.3.json`; it never commits or deploys.
- The release command must run from a clean isolated worktree, makes one content commit, uses a non-force push, and explicitly dispatches `deploy.yml`.
- `qwen-content-release.yml` remains a manual disaster-recovery path and must not be used for this local review cycle.

- [ ] **Step 4: Run tests and commit**

Run: `npm test -- tests/deployment/qwenContentReleaseWorkflow.test.ts tests/deployment/qwenCheckpointExportWorkflow.test.ts tests/deployment/qwenSecrets.test.ts`

Expected: PASS.

```bash
git add docs/runbooks/qwen-content-update.md tests/deployment/qwenContentReleaseWorkflow.test.ts tests/deployment/qwenSecrets.test.ts
git commit -m "docs: guide local Qwen review and release"
```

### Task 9: End-to-end verification without spending API credits

**Files:**
- Modify only if a verification defect is found in an owned file from Tasks 1-8.

- [ ] **Step 1: Run all focused content and workflow tests**

Run:

```bash
npm test -- tests/contentAgent tests/deployment/qwenSecrets.test.ts tests/deployment/qwenContentReleaseWorkflow.test.ts tests/deployment/qwenCheckpointExportWorkflow.test.ts
```

Expected: all tests PASS; no network request and no DashScope charge.

- [ ] **Step 2: Prove the local runner fails before network without the external key**

Temporarily point the loader to a nonexistent test path through its exported function test; do not rename or print the real secret file. Run:

```bash
npm test -- tests/contentAgent/localQwenEnv.test.ts tests/contentAgent/runLocalQwenContentAgent.test.ts
```

Expected: PASS; the missing-file case reports a local configuration error and the fake client records zero calls.

- [ ] **Step 3: Run full verification**

Run:

```bash
npm test
npm run lint
npm run build
git diff --check
```

Expected: full test suite PASS, lint exit 0, build exit 0, diff check empty.

- [ ] **Step 4: Perform a localhost smoke test with fixtures**

Use a test-only temporary candidate and port `0` through `startLocalReviewServer`; do not start a second production-like service. Verify:

```text
GET / -> 200 text/html
GET /api/review -> 200 with 2,000 phrases
POST /api/decision -> 200 and atomic review file updated
POST /api/approve before all samples pass -> 409
server.host -> 127.0.0.1
```

Expected: all assertions are already exercised by `localReviewServer.test.ts`; the process exits with no listener left open.

- [ ] **Step 5: Review the final diff against the approved design**

Run:

```bash
git status --short
git diff --stat HEAD~8..HEAD
rg -n "DASHSCOPE_API_KEY=.+|0\.0\.0\.0|contenteditable|git push.*(?:--force|-f)" scripts tests docs .github package.json
```

Expected:

- No tracked API key value.
- No review listener on `0.0.0.0`.
- No editable candidate fields.
- No force push.
- `.content-agent` remains ignored and no candidate/checkpoint/review file is staged.

- [ ] **Step 6: Commit any test-only correction, otherwise record no extra commit**

If all checks pass without edits, do not create an empty commit. If an owned verification test needed correction, stage only that test and its matching owned implementation file, then use:

```bash
git commit -m "test: verify local Qwen review release"
```

## Manual execution after implementation

Implementation completion does **not** authorize a paid Qwen call. After the implementation branch is reviewed and deployed, perform these separately:

1. Ask the user to create `C:\Users\Administrator\.phrase-bank\qwen-content.env` locally without sharing the key.
2. Run the checkpoint-export workflow once, download its one-day artifact, and import it.
3. Confirm the imported checkpoint reports 1,220 phrases and compatible source metadata.
4. Ask for explicit permission immediately before running `npm run content:qwen:local -- --version 2026.08.3`, because it spends Qwen API credits.
5. Start the local review page and let the user review/mark/approve without modifying candidate text.
6. After approval, run the release command from a clean worktree. Monitor the one deployment run and verify public `system-content-2026.08.3.json`, the bundled version, and the visible app.

No server Qwen dispatch is part of this flow.
