# Qwen Content Quality and Training Priority Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate and independently review a complete versioned 2,000-phrase system library with Qwen Plus, publish only validated complete packages, and select daily training near a 50% personal / 30% due / 20% system-new target.

**Architecture:** A Node-only content pipeline calls the configurable Alibaba Model Studio OpenAI-compatible Chat Completions endpoint through an injected client, builds six category batches, performs an independent Qwen review, and then runs the existing deterministic package validator before writing a candidate. A separate publisher copies only a passing candidate into `public/content` and updates one shared bundled-version module. Training selection receives same-day bucket counts and uses mutually exclusive pools, exact 5/3/2 standard allocation, and deficit-driven quick allocation.

**Tech Stack:** TypeScript, Node 22 native `fetch`, Vitest, React 19, IndexedDB repository, Alibaba Model Studio OpenAI-compatible `qwen-plus` Chat Completions.

---

### Task 1: Define the Qwen client and secret-safe failure contract

**Files:**
- Create: `scripts/content-agent/qwenClient.ts`
- Create: `tests/contentAgent/qwenClient.test.ts`

- [ ] **Step 1: Write failing client tests**

Test an injected `fetch` with `DASHSCOPE_API_KEY="test-secret"`, base URL `https://example.invalid/compatible-mode/v1`, and model `qwen-plus`. Assert one POST to `/chat/completions`, `Authorization: Bearer test-secret`, JSON messages, `stream:false`, and returned assistant content. Add cases for missing key, timeout via a fake aborted fetch, retry of 429/5xx up to three attempts, no retry on 401, malformed response, and prove thrown messages never contain `test-secret`.

```ts
const client = createQwenClient({
  apiKey: "test-secret",
  baseUrl: "https://example.invalid/compatible-mode/v1",
  model: "qwen-plus",
  fetcher,
  timeoutMs: 50,
  maxAttempts: 3,
});
await expect(client.complete([{ role: "user", content: "hello" }])).resolves.toBe("result");
expect(JSON.stringify(requests)).toContain("Bearer test-secret");
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npm test -- tests/contentAgent/qwenClient.test.ts`

Expected: FAIL because `qwenClient.ts` does not exist.

- [ ] **Step 3: Implement the minimal client**

Export `QwenMessage`, `QwenClient`, `QwenClientOptions`, and `createQwenClient`. Use `AbortController`, bounded retries, and sanitized Chinese errors. Accept configuration by injection; do not read process globals inside the reusable client.

```ts
export interface QwenClient { complete(messages: QwenMessage[]): Promise<string>; }
export function createQwenClient(options: QwenClientOptions): QwenClient {
  if (!options.apiKey) throw new Error("缺少 DASHSCOPE_API_KEY");
  return { complete: (messages) => requestWithRetry(options, messages) };
}
```

- [ ] **Step 4: Verify GREEN and lint**

Run: `npm test -- tests/contentAgent/qwenClient.test.ts && npm run lint`

Expected: all client tests PASS; lint exits 0.

- [ ] **Step 5: Commit**

```bash
git add scripts/content-agent/qwenClient.ts tests/contentAgent/qwenClient.test.ts
git commit -m "feat: call Qwen through a secret-safe client"
```

### Task 2: Generate and independently review six complete category batches

**Files:**
- Create: `scripts/content-agent/qwenPipeline.ts`
- Create: `scripts/run-qwen-content-agent.ts`
- Create: `tests/contentAgent/qwenPipeline.test.ts`
- Modify: `scripts/content-agent/catalog.ts`
- Modify: `package.json`

- [ ] **Step 1: Write failing pipeline tests**

Create a fake `QwenClient` returning fenced or plain JSON. Prove the pipeline requests each of the six categories with exact core quotas `180/100/120/100/70/30`, sends the generated batch through a separate review prompt, rejects review status other than `pass`, rejects any missing category, and calls `inspectSystemContent` on the final 600/2,000 package. Assert that one failed category produces no candidate file.

```ts
const result = await buildQwenCandidate({
  client: fakeClient,
  version: "2026.08.2",
  generatedAt: "2026-08-10T00:00:00.000Z",
  qualityVersion: "qwen-plus-review-v1",
});
expect(result.phrases.filter((p) => p.kind === "core")).toHaveLength(600);
expect(result.phrases).toHaveLength(2000);
```

Also assert category-slot IDs remain stable when wording is revised, while a reviewer-marked semantic replacement receives the replacement ID supplied by the reviewed batch.

- [ ] **Step 2: Run the test and verify RED**

Run: `npm test -- tests/contentAgent/qwenPipeline.test.ts`

Expected: FAIL because the pipeline does not exist.

- [ ] **Step 3: Implement prompts, JSON extraction, aggregation, and CLI**

Expose `buildQwenCandidate(options)` and `runQwenAgent(options)`. Process categories sequentially to bound spend. Generation prompts require concise spoken English, accurate natural Chinese, A2–B2 metadata, and 2–3 linked examples. Review prompts receive no earlier chat context and must return `{status, issues, phrases}`. Strip a single Markdown JSON fence before parsing and reject all other prose.

The CLI reads only these environment variables:

```ts
const apiKey = process.env.DASHSCOPE_API_KEY;
const baseUrl = process.env.DASHSCOPE_BASE_URL ?? "https://dashscope.aliyuncs.com/compatible-mode/v1";
const model = process.env.DASHSCOPE_MODEL ?? "qwen-plus";
```

Write candidates under `.content-agent/candidate-<version>.json` and reports under `.content-agent/report-<version>.json`; add `.content-agent/` to `.gitignore`. Never print request headers or the key. Add `"content:qwen": "tsx scripts/run-qwen-content-agent.ts"`.

- [ ] **Step 4: Verify GREEN**

Run: `npm test -- tests/contentAgent/qwenPipeline.test.ts tests/contentAgent/generator.test.ts && npm run lint`

Expected: all pipeline and legacy generator tests PASS.

- [ ] **Step 5: Commit**

```bash
git add .gitignore package.json scripts/content-agent scripts/run-qwen-content-agent.ts tests/contentAgent/qwenPipeline.test.ts
git commit -m "feat: generate and review complete Qwen content batches"
```

### Task 3: Publish only a complete passing candidate

**Files:**
- Create: `app/domain/bundledSystemContent.ts`
- Create: `scripts/publish-qwen-content.ts`
- Create: `tests/contentAgent/publisher.test.ts`
- Modify: `app/services/systemContentInstaller.ts`
- Modify: `tests/services/systemContentInstaller.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Write failing publisher and installer tests**

Use a temporary directory. Assert a passing candidate is revalidated, copied to `public/content/system-content-<version>.json`, and updates the shared version constant. Assert failed report, mismatched versions, incomplete quotas, or invalid package leave both destination and version module byte-for-byte unchanged. Update installer tests to import the shared version and request its exact URL.

```ts
await publishCandidate({ candidatePath, reportPath, publicDir, versionModulePath });
expect(readFileSync(join(publicDir, "system-content-2026.08.2.json"), "utf8")).toBe(candidateRaw);
expect(readFileSync(versionModulePath, "utf8")).toContain('"2026.08.2"');
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `npm test -- tests/contentAgent/publisher.test.ts tests/services/systemContentInstaller.test.ts`

Expected: FAIL because the publisher/shared version module does not exist.

- [ ] **Step 3: Implement atomic local publication**

Export immutable `BUNDLED_SYSTEM_CONTENT_VERSION` and derive the URL in the installer. The publisher validates candidate and report before writing, writes temporary sibling files, then renames them into place. It never deletes earlier version files. Add `"content:publish": "tsx scripts/publish-qwen-content.ts"`.

- [ ] **Step 4: Verify GREEN and deterministic package checks**

Run: `npm test -- tests/contentAgent/publisher.test.ts tests/services/systemContentInstaller.test.ts tests/contentAgent/package.test.ts`

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add app/domain/bundledSystemContent.ts app/services/systemContentInstaller.ts scripts/publish-qwen-content.ts tests/contentAgent/publisher.test.ts tests/services/systemContentInstaller.test.ts package.json
git commit -m "feat: publish Qwen content packages atomically"
```

### Task 4: Select standard training at 5 personal / 3 due / 2 system-new

**Files:**
- Modify: `app/domain/trainingSelection.ts`
- Modify: `tests/domain/trainingSelection.test.ts`

- [ ] **Step 1: Write failing standard-allocation tests**

Build disjoint pools with at least six personal phrases, five due phrases, and four unreviewed system cores. Assert standard mode returns exactly 10 unique IDs: five personal-priority candidates, three remaining due candidates, and two system-new candidates. Add tests proving recent unmastered personal phrases rank before older mastered personal phrases, today's repeated IDs rank last, daily new caps remain 5 personal and 3 system, and deficient pools backfill in personal → due → system order.

```ts
const selected = selectTrainingGroup(phrases, prioritizedOptions({ mode: "standard" }));
expect(bucketCounts(selected)).toEqual({ personal: 5, due: 3, systemNew: 2 });
expect(new Set(selected.map((x) => x.phrase.id)).size).toBe(10);
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm test -- tests/domain/trainingSelection.test.ts`

Expected: the new 5/3/2 expectations FAIL against the current due-first unbounded selector.

- [ ] **Step 3: Implement mutually exclusive pools and bounded allocation**

Classify candidates once. `personalPool` includes personal phrases and sorts new/recent/weak before mastered; `duePool` contains due phrases not already selected; `systemNewPool` contains unreviewed, unlocked system cores. Allocate 5/3/2, then backfill without duplicates. Retain deterministic seeded ordering as the final tie-breaker and never mutate inputs.

- [ ] **Step 4: Verify GREEN**

Run: `npm test -- tests/domain/trainingSelection.test.ts tests/hooks/useTrainingSession.test.tsx`

Expected: selection and session tests PASS.

- [ ] **Step 5: Commit**

```bash
git add app/domain/trainingSelection.ts tests/domain/trainingSelection.test.ts
git commit -m "feat: allocate standard practice by learning priority"
```

### Task 5: Make quick groups converge on same-day 50/30/20 deficits

**Files:**
- Modify: `app/domain/trainingSelection.ts`
- Modify: `app/hooks/useTrainingSession.ts`
- Modify: `tests/domain/trainingSelection.test.ts`
- Modify: `tests/hooks/useTrainingSession.test.tsx`

- [ ] **Step 1: Write failing quick-deficit tests**

Extend options with same-day counts `{personal, due, systemNew}`. Assert the first three-item quick group chooses the largest proportional deficits; after simulated prior groups, subsequent selection changes so cumulative totals approach 50/30/20. Assert a day with `{5,3,2}` starts a new cycle rather than permanently starving any bucket. Add a hook test proving Shanghai-today events are classified using event source plus phrase origin and passed to selection.

```ts
const second = selectTrainingGroup(phrases, {
  ...options,
  mode: "quick",
  practicedTodayBucketCounts: { personal: 2, due: 1, systemNew: 0 },
});
expect(bucketCounts(second).systemNew).toBeGreaterThan(0);
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npm test -- tests/domain/trainingSelection.test.ts tests/hooks/useTrainingSession.test.tsx`

Expected: FAIL because same-day bucket counts are not accepted or used.

- [ ] **Step 3: Implement deficit allocation and hook integration**

For each next quick slot, compute `(targetShare * (completed + remainingSlots)) - currentBucketCount`, choose the available bucket with largest deficit, and use personal → due → system as the deterministic tie order. Recompute after each selected item. In the hook, aggregate unique completed phrase events on the current Shanghai date into the three exclusive bucket counts before calling the selector.

- [ ] **Step 4: Verify GREEN and existing idempotency**

Run: `npm test -- tests/domain/trainingSelection.test.ts tests/hooks/useTrainingSession.test.tsx tests/storage/repository.test.ts`

Expected: all tests PASS, including session resume and atomic review tests.

- [ ] **Step 5: Commit**

```bash
git add app/domain/trainingSelection.ts app/hooks/useTrainingSession.ts tests/domain/trainingSelection.test.ts tests/hooks/useTrainingSession.test.tsx
git commit -m "feat: balance quick practice across the day"
```

### Task 6: Operational documentation, full verification, and guarded release

**Files:**
- Create: `docs/runbooks/qwen-content-update.md`
- Create: `.env.content.example`
- Test: `tests/deployment/qwenSecrets.test.ts`

- [ ] **Step 1: Write failing secret-boundary tests**

Assert tracked source contains no `sk-` credential literal, the example environment file contains names but no values, the runbook instructs revoking exposed keys, and client-side `app/` code never reads `DASHSCOPE_API_KEY`.

- [ ] **Step 2: Run and verify RED**

Run: `npm test -- tests/deployment/qwenSecrets.test.ts`

Expected: FAIL because runbook/example do not exist.

- [ ] **Step 3: Write the nontechnical runbook**

Document creating a new key, server environment configuration without shell-history exposure, optional `DASHSCOPE_BASE_URL` for the user's Alibaba region/workspace, dry generation, report inspection, publication, Git commit/push, GitHub Actions observation, public JSON verification, rollback, expected API call ceiling, and deleting temporary candidate files. Never include a real credential.

- [ ] **Step 4: Run complete verification**

Run:

```bash
npm test
npm run lint
npm run build
npm run content:generate
git diff --check
git status --short
```

Expected: every test passes, lint/build exit 0, deterministic legacy generator remains stable, and only intentional tracked changes exist.

- [ ] **Step 5: Commit documentation**

```bash
git add docs/runbooks/qwen-content-update.md .env.content.example tests/deployment/qwenSecrets.test.ts
git commit -m "docs: secure Qwen content update operations"
```

- [ ] **Step 6: Configure and publish without exposing the new key**

The user creates a replacement key and enters it directly into the Tencent server environment following the runbook. Run `npm run content:qwen -- --version <next-version>` and `npm run content:publish -- --version <next-version>`, inspect the generated report, commit only the versioned public JSON and version module, push `main`, wait for GitHub Actions, and verify the live JSON and application installation. If no replacement secret has been configured, stop after shipping the pipeline and do not use the exposed key.
