# Qwen Automatic Content Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a manually triggered GitHub workflow that uses the Qwen key stored only on the Tencent server to generate, independently review, validate, publish, commit, and deploy the AI-authored `2026.08.3` system phrase library.

**Architecture:** Harden the existing Qwen pipeline so AI may change only bilingual text while stable metadata is normalized to the requested release version and checked exactly. A new `workflow_dispatch` job runs generation remotely with `/etc/phrase-bank/qwen-content.env`, copies only the candidate and report back to the GitHub runner, reruns deterministic gates, and pushes a generated content commit to `main`; the existing deployment workflow handles production rollout.

**Tech Stack:** TypeScript, Vitest, Qwen OpenAI-compatible API, GitHub Actions, SSH/SCP, Docker/Node 22, vinext.

---

## File Structure

- Modify `scripts/content-agent/qwenPipeline.ts`: normalize release metadata, strengthen prompts, and reject AI metadata drift.
- Modify `tests/contentAgent/qwenPipeline.test.ts`: prove prompt, metadata, version, retry, and review behavior.
- Create `tests/deployment/qwenContentReleaseWorkflow.test.ts`: source contract for workflow safety and ordering.
- Create `.github/workflows/qwen-content-release.yml`: manual remote generation and validated automatic publication.
- Modify `docs/runbooks/qwen-content-update.md`: document one-click operation, failure behavior, and rollback.

### Task 1: Harden AI generation and metadata integrity

**Files:**
- Modify: `scripts/content-agent/qwenPipeline.ts`
- Modify: `tests/contentAgent/qwenPipeline.test.ts`

- [ ] **Step 1: Write failing prompt and metadata tests**

Update `responseQueue` to accept a requested version. Add prompt assertions:

```ts
const prompt = calls[0][0].map(({ content }) => content).join(" ");
expect(prompt).toContain("完整翻译子场景");
expect(prompt).toContain("不得整批使用同一种开头");
expect(prompt).toContain("只允许修改 english 和 chinese");
expect(prompt).toContain("2026.08.3");
```

Add a table test that changes `subcategory`, `cefrLevel`, `intent`, `parentPhraseId`, or `unlockOrder` in the first returned phrase and expects `buildQwenCandidate` to reject with `元数据`. Assert every successful output phrase carries `contentVersion: "2026.08.3"` and `qualityVersion: "qwen-plus-review-v2"`.

- [ ] **Step 2: Run the test and verify RED**

```bash
npm test -- tests/contentAgent/qwenPipeline.test.ts
```

Expected: prompt assertions fail and metadata drift is accepted by the old `assertBatch`.

- [ ] **Step 3: Normalize target metadata**

In `buildQwenCandidate`, create and use a target source:

```ts
const sourceContent = options.sourceContent ?? generateSystemContent();
const targetSource = {
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
```

Use `targetSource.phrases` for every category batch.

- [ ] **Step 4: Strengthen generation and review prompts**

Add this requirement to the generation message:

```ts
`只允许修改 english 和 chinese；其他字段必须逐字保留。中文必须完整翻译子场景，不得遗漏英文开头中的场景信息。英文必须使用自然多样的口语句式，不得整批使用同一种开头。使用版本 ${options.version} 和质检版本 ${options.qualityVersion}。`
```

The independent review message must check `中英文完整一致性、子场景是否完整翻译、同批句式与开头是否机械重复`.

- [ ] **Step 5: Enforce immutable metadata**

Extend `assertBatch` to compare each returned phrase to its source after removing only `english` and `chinese`:

```ts
const immutable = ({ english: _english, chinese: _chinese, ...metadata }: SystemContentPhrase) => metadata;
if (JSON.stringify(immutable(actual)) !== JSON.stringify(immutable(expected))) {
  throw new Error(`${category} 批次元数据与输入模板不一致`);
}
```

Keep existing exact ID, category, and core-count checks.

- [ ] **Step 6: Run GREEN checks**

```bash
npm test -- tests/contentAgent/qwenPipeline.test.ts tests/contentAgent/generator.test.ts tests/contentAgent/publisher.test.ts
npx eslint scripts/content-agent/qwenPipeline.ts tests/contentAgent/qwenPipeline.test.ts
git diff --check
```

Expected: all commands exit 0.

- [ ] **Step 7: Commit Task 1**

```bash
git add scripts/content-agent/qwenPipeline.ts tests/contentAgent/qwenPipeline.test.ts
git commit -m "fix: harden AI content generation"
```

### Task 2: Define the automatic workflow contract

**Files:**
- Create: `tests/deployment/qwenContentReleaseWorkflow.test.ts`

- [ ] **Step 1: Write the failing workflow test**

Create a node-environment test that reads `.github/workflows/qwen-content-release.yml` and asserts:

```ts
// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const workflow = () => readFileSync(resolve(process.cwd(), ".github/workflows/qwen-content-release.yml"), "utf8");

describe("Qwen content release workflow", () => {
  it("is manual, serialized, and reads Qwen credentials only on the server", () => {
    const source = workflow();
    expect(source).toContain("workflow_dispatch:");
    expect(source).toContain("group: phrase-bank-qwen-content");
    expect(source).toContain("cancel-in-progress: false");
    expect(source).toContain("contents: write");
    expect(source).toContain("CONTENT_VERSION: 2026.08.3");
    expect(source).toContain("--env-file /etc/phrase-bank/qwen-content.env");
    expect(source).not.toContain("secrets.DASHSCOPE");
    expect(source).not.toContain("DASHSCOPE_API_KEY=");
  });

  it("validates before committing and never force-pushes", () => {
    const source = workflow();
    expect(source).toContain("candidate-$CONTENT_VERSION.json");
    expect(source).toContain("report-$CONTENT_VERSION.json");
    expect(source).toContain("npm run content:publish -- --version $CONTENT_VERSION");
    expect(source).toContain("npm test");
    expect(source).toContain("npm run lint");
    expect(source).toContain("npm run build");
    expect(source).toContain("git diff --cached --check");
    expect(source).toContain("git push origin HEAD:main");
    expect(source.indexOf("npm test")).toBeLessThan(source.indexOf("git push origin HEAD:main"));
    expect(source).not.toContain("git push --force");
  });

  it("rejects an unsafe server environment and main-branch drift", () => {
    const source = workflow();
    expect(source).toContain("stat -c '%a' /etc/phrase-bank/qwen-content.env");
    expect(source).toContain('test "$env_mode" = "600"');
    expect(source).toContain("git status --porcelain --untracked-files=no");
    expect(source).toContain("git rev-parse origin/main");
    expect(source).toContain("main advanced during Qwen generation");
  });
});
```

- [ ] **Step 2: Run RED and commit the contract**

```bash
npm test -- tests/deployment/qwenContentReleaseWorkflow.test.ts
git add tests/deployment/qwenContentReleaseWorkflow.test.ts
git commit -m "test: define automatic Qwen release contract"
```

Expected test result before commit: `ENOENT` because the workflow does not exist.

### Task 3: Implement the secure manual workflow

**Files:**
- Create: `.github/workflows/qwen-content-release.yml`
- Modify: `docs/runbooks/qwen-content-update.md`

- [ ] **Step 1: Create workflow metadata and SSH setup**

Use this header and setup:

```yaml
name: Generate and deploy Qwen content
on:
  workflow_dispatch:
permissions:
  contents: write
concurrency:
  group: phrase-bank-qwen-content
  cancel-in-progress: false
env:
  CONTENT_VERSION: 2026.08.3
jobs:
  generate-publish:
    runs-on: ubuntu-latest
    timeout-minutes: 180
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
```

Configure `~/.ssh/tencent_qwen` exactly like the existing deploy workflow, using only `TENCENT_HOST` and `TENCENT_SSH_KEY` secrets.

- [ ] **Step 2: Add remote generation**

Pass the fixed version into the remote shell without interpolating the Qwen environment file:

```bash
ssh -i ~/.ssh/tencent_qwen "$TENCENT_USER@$TENCENT_HOST" \
  "CONTENT_VERSION='$CONTENT_VERSION' bash -se" <<'REMOTE'
```

The quoted remote script must run:

```bash
set -euo pipefail
cd /opt/phrase-bank
test -f /etc/phrase-bank/qwen-content.env
env_mode=$(stat -c '%a' /etc/phrase-bank/qwen-content.env)
test "$env_mode" = "600"
test -z "$(git status --porcelain --untracked-files=no)"
git fetch origin main
git checkout main
git pull --ff-only origin main
docker run --rm \
  --env-file /etc/phrase-bank/qwen-content.env \
  -v "$PWD:/workspace" -w /workspace node:22-bookworm-slim \
  sh -lc "npm ci && npm run content:qwen -- --version '$CONTENT_VERSION'"
REMOTE
```

Do not print the environment file and do not use `set -x`.

- [ ] **Step 3: Copy only candidate and report**

Create local `.content-agent`, then use two explicit `scp` commands for:

```text
/opt/phrase-bank/.content-agent/candidate-2026.08.3.json
/opt/phrase-bank/.content-agent/report-2026.08.3.json
```

Do not use recursive SCP or copy `/etc/phrase-bank`.

- [ ] **Step 4: Publish, test, and reject branch drift**

Run in this exact order:

```bash
npm run content:publish -- --version $CONTENT_VERSION
npm test -- tests/contentAgent tests/deployment/qwenSecrets.test.ts tests/deployment/qwenContentReleaseWorkflow.test.ts
npm test
npm run lint
npm run build
git diff --check
git fetch origin main
test "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" || { echo "main advanced during Qwen generation"; exit 1; }
```

- [ ] **Step 5: Commit only generated release files**

```bash
git add "public/content/system-content-$CONTENT_VERSION.json" app/domain/bundledSystemContent.ts
git diff --cached --quiet && { echo "Qwen release produced no content change"; exit 1; }
git diff --cached --check
git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git commit -m "content: publish Qwen phrase library $CONTENT_VERSION"
git push origin HEAD:main
```

The push triggers the existing deployment workflow. This workflow must not run `docker compose up`.

- [ ] **Step 6: Update the runbook**

Add a recommended section explaining that the user opens `Generate and deploy Qwen content` in GitHub Actions and clicks `Run workflow`; failures do not publish, and the Key remains only in `/etc/phrase-bank/qwen-content.env`. Keep the existing manual recovery procedure.

- [ ] **Step 7: Verify GREEN and commit Task 3**

```bash
npm test -- tests/deployment/qwenContentReleaseWorkflow.test.ts tests/deployment/qwenSecrets.test.ts tests/contentAgent/qwenPipeline.test.ts
npx eslint tests/deployment/qwenContentReleaseWorkflow.test.ts scripts/content-agent/qwenPipeline.ts tests/contentAgent/qwenPipeline.test.ts
git diff --check
git add .github/workflows/qwen-content-release.yml docs/runbooks/qwen-content-update.md
git commit -m "feat: automate reviewed Qwen content releases"
```

Expected: all commands exit 0.

### Task 4: Verify, merge, and push workflow infrastructure

**Files:**
- Verify all Task 1–3 changes.

- [ ] **Step 1: Run focused and full verification**

```bash
npm test -- tests/contentAgent tests/deployment/qwenSecrets.test.ts tests/deployment/qwenContentReleaseWorkflow.test.ts tests/services/systemContentInstaller.test.ts tests/storage/repository.test.ts
npm test
npm run lint
npm run build
git diff --check
git status --short
```

Expected: zero failed tests, all checks exit 0, and the feature worktree is clean.

- [ ] **Step 2: Fast-forward main without touching user files**

From the original repository, preserve unrelated changes to `findings.md`, `progress.md`, `task_plan.md`, and `.superpowers/`, then run:

```bash
git merge --ff-only feature/qwen-auto-release
npm test -- tests/contentAgent tests/deployment/qwenContentReleaseWorkflow.test.ts
```

- [ ] **Step 3: Push infrastructure and monitor its ordinary deploy**

```bash
git -c http.proxy=http://127.0.0.1:4780 -c https.proxy=http://127.0.0.1:4780 push github main
```

Require both jobs in the resulting `Test and deploy` run to succeed before triggering paid generation.

### Task 5: Generate, publish, deploy, and verify `2026.08.3`

**Files generated by workflow:**
- `public/content/system-content-2026.08.3.json`
- `app/domain/bundledSystemContent.ts`

- [ ] **Step 1: Trigger exactly one generation run**

```bash
gh workflow run qwen-content-release.yml --repo justirycn/phrase-bank --ref main
```

Expected: one `Generate and deploy Qwen content` run enters `in_progress`.

- [ ] **Step 2: Monitor generation without duplicate triggers**

Confirm progress reaches generation/review completion, publish, focused tests, full tests, lint, build, and push. If any stage fails, stop; do not publish partial `.content-agent` files or trigger a second paid run until the failure is diagnosed.

- [ ] **Step 3: Monitor the deployment from the generated content commit**

Require both test and deploy jobs in the subsequent `Test and deploy` run to succeed. Record the generated commit SHA and both run URLs.

- [ ] **Step 4: Verify public content**

```bash
curl --fail --silent --show-error -I https://phrase.archdemy.com/content/system-content-2026.08.3.json
```

Expected: HTTP 200 and JSON content type. Download it and verify version `2026.08.3`, 600 cores, 2,000 phrases, and no deterministic quality-gate errors.

- [ ] **Step 5: Verify application upgrade**

Open `https://phrase.archdemy.com/`, sign in, reload once, and confirm the app opens, existing learned state remains, a new five-phrase group spans different subcategories, and sampled business/supply-chain Chinese includes the full scene context.

- [ ] **Step 6: Report evidence**

Report the generated commit SHA, workflow and deploy URLs, public package checks, sampled content quality, and limitations. Do not claim success if generation, deployment, or public verification is incomplete.
