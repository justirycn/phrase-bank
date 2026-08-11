# New Phrase Learning and Practice Rotation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a resumable 15-core-per-day guided learning flow and make review/quick practice select only learned content with reliable same-day rotation.

**Architecture:** Extend phrase learning state with an explicit first-learning lifecycle, introduce a pure five-core learning selector and a dedicated persisted learning session, then keep the existing review scheduler as the single source of spaced-repetition dates. UI orchestration stays in focused `TrainingHome`, `NewPhraseLearning`, and hook modules; IndexedDB owns atomic first-test progress and backward-compatible migration.

**Tech Stack:** TypeScript, React 19, vinext, IndexedDB via `idb`, Vitest, Testing Library, Web Speech API, CSS safe-area media queries.

---

## File map

- `app/domain/types.ts`: learning-stage, learning-session, and backup-v4 contracts.
- `app/domain/learningSelection.ts`: pure theme/day five-core selection.
- `app/domain/trainingSelection.ts`: learned-only review and quick rotation rules.
- `app/storage/repository.ts`: persistence interface for learning state/session operations.
- `app/storage/indexedDbRepository.ts`: DB v4 migration and atomic first-test/session writes.
- `app/storage/backup.ts`: v1-v4 normalization and validation.
- `app/hooks/useNewPhraseLearning.ts`: resumable study/test controller.
- `app/components/NewPhraseLearning.tsx`: core, examples, speech, and first-test UI.
- `app/components/TrainingHome.tsx`: separate learn/review/quick entries and daily new progress.
- `app/PhraseBankApp.tsx`: route wiring, personal-sentence preference, and library stage filters.
- `app/globals.css`: iPhone-safe learning and home layouts.
- `tests/domain/learningSelection.test.ts`: daily theme and personal-priority rules.
- `tests/domain/trainingSelection.test.ts`: learned-only and same-day quick rotation.
- `tests/storage/repository.test.ts`, `tests/storage/backup.test.ts`: migration, atomicity, and compatibility.
- `tests/hooks/useNewPhraseLearning.test.tsx`: resume and phase transitions.
- `tests/components/newPhraseLearning.test.tsx`, `tests/components/app.test.tsx`: accessible end-to-end component behavior.
- `tests/components/mobileStyles.test.ts`: safe-area, targets, wrapping, and zoom contracts.

### Task 1: Define the learning lifecycle and five-core selector

**Files:**
- Modify: `app/domain/types.ts`
- Create: `app/domain/learningSelection.ts`
- Create: `tests/domain/learningSelection.test.ts`
- Modify: `tests/domain/trainingTypes.test.ts`

- [ ] **Step 1: Write failing selector and type-contract tests**

```ts
import { describe, expect, it } from "vitest";
import { selectLearningGroup } from "../../app/domain/learningSelection";
import type { Phrase, PhraseLearningState } from "../../app/domain/types";

it("selects newest unseen personal phrases before the daily system theme", () => {
  const selected = selectLearningGroup(phrases, states, {
    date: "2026-08-10", themeCategoryId: "travel", target: 5,
  });
  expect(selected).toHaveLength(5);
  expect(selected.slice(0, 2).map(({ origin }) => origin)).toEqual(["personal", "personal"]);
  expect(selected.slice(2).every(({ categoryId }) => categoryId === "travel")).toBe(true);
});

it("excludes learned, mastered, retired, example, and already reserved phrases", () => {
  expect(selectLearningGroup(phrases, states, {
    date: "2026-08-10", themeCategoryId: "travel", target: 5,
    reservedPhraseIds: new Set(["reserved"]),
  }).map(({ id }) => id)).toEqual(["eligible"]);
});

it("fills a short theme from other system core categories deterministically", () => {
  const first = selectLearningGroup(phrases, [], { date: "2026-08-10", themeCategoryId: "travel", target: 5 });
  const second = selectLearningGroup(phrases, [], { date: "2026-08-10", themeCategoryId: "travel", target: 5 });
  expect(first).toEqual(second);
  expect(first).toHaveLength(5);
});
```

Add a compile-time fixture that constructs every new union value and all required fields.

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `npm test -- tests/domain/learningSelection.test.ts tests/domain/trainingTypes.test.ts`

Expected: FAIL because `LearningStage`, `LearningSessionRecord`, and `selectLearningGroup` do not exist.

- [ ] **Step 3: Add exact domain contracts**

```ts
export type LearningStage = "unseen" | "learning" | "learned" | "mastered";
export type LearningPhase = "study" | "test";

export interface PhraseLearningState {
  phraseId: string;
  stage: LearningStage;
  firstSeenAt?: string;
  firstTestedAt?: string;
  firstResult?: ReviewResult;
  consecutiveGood: number;
  masteredDates: string[];
  unlockedAt?: string;
  updatedAt: string;
}

export interface LearningSessionRecord {
  id: string;
  date: string;
  themeCategoryId: string;
  phraseIds: string[];
  studyIndex: number;
  testIndex: number;
  phase: LearningPhase;
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
}
```

Add `BackupEnvelopeV4` with `learningSessions: LearningSessionRecord[]` and update `BackupEnvelope` to include v4.

- [ ] **Step 4: Implement deterministic learning selection**

```ts
export function selectLearningGroup(
  phrases: Phrase[],
  states: PhraseLearningState[],
  options: LearningSelectionOptions,
): Phrase[] {
  const stateById = new Map(states.map((state) => [state.phraseId, state]));
  const eligible = phrases.filter((phrase) => {
    const personalStandalone = (phrase.origin ?? "personal") === "personal" && (phrase.kind ?? "standalone") === "standalone";
    const systemCore = phrase.origin === "system" && phrase.kind === "core";
    return !phrase.retiredAt && (personalStandalone || systemCore);
  }).filter((phrase) =>
    (stateById.get(phrase.id)?.stage ?? "unseen") === "unseen"
    && !options.reservedPhraseIds?.has(phrase.id)
  );
  const personal = eligible.filter(isPersonal).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const themed = stableOrder(eligible.filter((phrase) => !isPersonal(phrase) && phrase.categoryId === options.themeCategoryId), options.date);
  const fallback = stableOrder(eligible.filter((phrase) => !isPersonal(phrase) && phrase.categoryId !== options.themeCategoryId), options.date);
  return unique([...personal, ...themed, ...fallback]).slice(0, options.target);
}
```

Use explicit parentheses around the origin/kind condition so only personal standalone and system core phrases are eligible. Export `LearningSelectionOptions`; keep hashing local and deterministic.

- [ ] **Step 5: Run focused tests and commit**

Run: `npm test -- tests/domain/learningSelection.test.ts tests/domain/trainingTypes.test.ts`

Expected: PASS.

```bash
git add app/domain/types.ts app/domain/learningSelection.ts tests/domain/learningSelection.test.ts tests/domain/trainingTypes.test.ts
git commit -m "feat: define guided phrase learning lifecycle"
```

### Task 2: Persist learning sessions and migrate backups atomically

**Files:**
- Modify: `app/storage/repository.ts`
- Modify: `app/storage/indexedDbRepository.ts`
- Modify: `app/storage/backup.ts`
- Modify: `tests/storage/repository.test.ts`
- Modify: `tests/storage/backup.test.ts`

- [ ] **Step 1: Write failing DB v4, migration, and atomic first-test tests**

```ts
it("migrates reviewed phrases to learned and untouched system cores to unseen", async () => {
  const repository = await openMigratedV3Repository();
  const states = new Map((await repository.listPhraseLearningStates()).map((state) => [state.phraseId, state]));
  expect(states.get("reviewed")?.stage).toBe("learned");
  expect(states.get("system-new")?.stage).toBe("unseen");
});

it("atomically stores first review, scheduling, learning state, and session cursor", async () => {
  await repository.submitFirstLearningReview(event, { ...session, phase: "test", testIndex: 1 });
  expect(await repository.getPhrase(event.phraseId)).toMatchObject({ lastReviewedAt: event.occurredAt });
  expect(await repository.getPhraseLearningState(event.phraseId)).toMatchObject({ stage: "learned", firstResult: "hard" });
  expect(await repository.getActiveLearningSession()).toMatchObject({ testIndex: 1 });
});

it("keeps the old cursor when the atomic first review fails", async () => {
  await expect(repository.submitFirstLearningReview({ ...event, phraseId: "missing" }, nextSession)).rejects.toThrow();
  expect(await repository.getActiveLearningSession()).toMatchObject({ testIndex: 0 });
});
```

Add backup tests for v1-v3 normalization to v4, v4 round-trip, invalid stages, invalid indices, missing phrase IDs, and duplicate active sessions.

- [ ] **Step 2: Run storage tests and verify RED**

Run: `npm test -- tests/storage/repository.test.ts tests/storage/backup.test.ts`

Expected: FAIL on missing repository methods, DB store, and backup v4.

- [ ] **Step 3: Add repository API and DB v4 store**

```ts
getPhraseLearningState(id: string): Promise<PhraseLearningState | undefined>;
savePhraseLearningState(state: PhraseLearningState): Promise<void>;
saveLearningSession(session: LearningSessionRecord): Promise<void>;
getActiveLearningSession(): Promise<LearningSessionRecord | undefined>;
completeLearningSession(id: string, completedAt: Date): Promise<void>;
submitFirstLearningReview(event: TrainingEvent, nextSession: LearningSessionRecord): Promise<void>;
```

Upgrade IndexedDB to version 4 and create:

```ts
learningSessions: {
  key: string;
  value: LearningSessionRecord;
  indexes: { "by-updated": string };
};
```

During upgrade, scan phrases, review logs, training events, and existing learning states. Preserve `masteredDates`/`unlockedAt`; set reviewed phrases to `learned` or `mastered`, untouched phrases to `unseen`, and initialize `consecutiveGood` to current mastery evidence.

- [ ] **Step 4: Implement the atomic first-test transaction**

Use one `readwrite` transaction over `trainingEvents`, `phrases`, `reviewLogs`, `phraseLearningState`, and `learningSessions`. Reuse `scheduleReview`; write the event ID idempotently; mark `firstTestedAt`, `firstResult`, and `stage`; then persist the proposed session cursor. If any object is missing or inconsistent, abort before visible progress can advance.

```ts
if (await eventStore.get(event.id)) return;
const phrase = await phraseStore.get(event.phraseId);
if (!phrase || nextSession.phraseIds[nextSession.testIndex - 1] !== phrase.id) {
  tx.abort();
  throw new Error("首次测试进度不一致");
}
```

- [ ] **Step 5: Upgrade backup parsing/export/import**

Normalize v1-v3 to v4 with `learningSessions: []`. Validate every learning-stage discriminant, timestamp, counter, phrase link, phase, cursor bound, and completed state. Include `learningSessions` in the existing single-transaction export/import so backups cannot be torn.

- [ ] **Step 6: Run storage tests and commit**

Run: `npm test -- tests/storage/repository.test.ts tests/storage/backup.test.ts`

Expected: PASS.

```bash
git add app/storage/repository.ts app/storage/indexedDbRepository.ts app/storage/backup.ts tests/storage/repository.test.ts tests/storage/backup.test.ts
git commit -m "feat: persist resumable phrase learning sessions"
```

### Task 3: Restrict practice to learned content and rotate quick groups

**Files:**
- Modify: `app/domain/trainingSelection.ts`
- Modify: `app/hooks/useTrainingSession.ts`
- Modify: `tests/domain/trainingSelection.test.ts`
- Modify: `tests/hooks/useTrainingSession.test.tsx`

- [ ] **Step 1: Write failing learned-only and repeat-gap tests**

```ts
it("never selects unseen or learning phrases for review modes", () => {
  const result = selectTrainingGroup(phrases, {
    mode: "quick", now, seed: "rotation-4", newIntroducedToday: 0,
    learningStates: states,
  });
  expect(result.map(({ phrase }) => phrase.id)).toEqual(["learned-due", "learned-weak", "mastered-old"]);
});

it("does not repeat good phrases today and delays weak repeats by one group", () => {
  const result = selectTrainingGroup(phrases, {
    mode: "quick", now, seed: "rotation-5", newIntroducedToday: 0,
    learningStates: states,
    practicedTodayIds: new Set(["good-today", "hard-last-group"]),
    goodTodayIds: new Set(["good-today"]),
    previousGroupIds: new Set(["hard-last-group"]),
  });
  expect(result.map(({ phrase }) => phrase.id)).not.toContain("good-today");
  expect(result.map(({ phrase }) => phrase.id)).not.toContain("hard-last-group");
});
```

Add a hook test that completes two quick sessions on the same Shanghai date and proves the second queue differs, while a third session may reintroduce a prior `again`/`hard` phrase only after the gap.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npm test -- tests/domain/trainingSelection.test.ts tests/hooks/useTrainingSession.test.tsx`

Expected: FAIL because selection still treats unreviewed phrases as `new` practice content and lacks gap inputs.

- [ ] **Step 3: Replace quick eligibility and seed construction**

Extend `TrainingSelectionOptions`:

```ts
goodTodayIds?: ReadonlySet<string>;
previousGroupIds?: ReadonlySet<string>;
rotationCursor?: number;
```

Filter the practice universe first:

```ts
const practiceEligible = unique.filter((phrase) => {
  const stage = states.get(phrase.id)?.stage;
  return stage === "learned" || stage === "mastered";
});
```

Never backfill from unseen content. Order due, weak, old, and mature pools with `${seed}:${rotationCursor}`; exclude `goodTodayIds` completely and exclude `previousGroupIds` until all fresh eligible candidates are exhausted. Return a short queue when fewer than three candidates qualify.

- [ ] **Step 4: Derive rotation inputs from persisted events/sessions**

In `useTrainingSession`, derive Shanghai-today results and the most recently completed group. Persist a monotonically increasing daily group count as the rotation cursor. Keep active-session restore unchanged and do not reselect an already saved queue.

- [ ] **Step 5: Run focused tests and commit**

Run: `npm test -- tests/domain/trainingSelection.test.ts tests/hooks/useTrainingSession.test.tsx`

Expected: PASS.

```bash
git add app/domain/trainingSelection.ts app/hooks/useTrainingSession.ts tests/domain/trainingSelection.test.ts tests/hooks/useTrainingSession.test.tsx
git commit -m "fix: rotate quick practice across learned phrases"
```

### Task 4: Build the resumable new-phrase controller

**Files:**
- Create: `app/hooks/useNewPhraseLearning.ts`
- Create: `tests/hooks/useNewPhraseLearning.test.tsx`

- [ ] **Step 1: Write controller tests before implementation**

Cover: new five-core session creation; same-day theme; personal priority; five study advances; transition to test; atomic grade advancement; reload at both phases; failed save retaining visible cursor; completion; fewer-than-five state; speech failure; unmount cancellation; and no review event during browsing.

```ts
it("studies five phrases before creating any review event", async () => {
  const { result } = renderHook(() => useNewPhraseLearning(options));
  await waitFor(() => expect(result.current.current?.id).toBe("personal-new"));
  for (let index = 0; index < 5; index += 1) await act(() => result.current.nextStudyPhrase());
  expect(result.current.phase).toBe("test");
  expect(repository.submitFirstLearningReview).not.toHaveBeenCalled();
});

it("does not advance visible test progress until the atomic save succeeds", async () => {
  repository.submitFirstLearningReview.mockReturnValue(deferred.promise);
  const grade = result.current.grade("hard");
  expect(result.current.testIndex).toBe(0);
  deferred.resolve();
  await grade;
  expect(result.current.testIndex).toBe(1);
});
```

- [ ] **Step 2: Run the hook test and verify RED**

Run: `npm test -- tests/hooks/useNewPhraseLearning.test.tsx`

Expected: FAIL because the hook does not exist.

- [ ] **Step 3: Implement the controller API**

```ts
export interface NewPhraseLearningController {
  phase: "loading" | "study" | "test" | "complete" | "empty" | "error";
  current?: Phrase;
  examples: Phrase[];
  studyIndex: number;
  testIndex: number;
  total: number;
  revealed: boolean;
  error?: string;
  replay(): Promise<void>;
  nextStudyPhrase(): Promise<void>;
  reveal(): Promise<void>;
  grade(result: ReviewResult): Promise<void>;
  retry(): void;
}
```

Load phrases, states, active learning session, and examples once per run. If an active session exists, restore exact phrase IDs and cursor after filtering deleted phrases with original-prefix cursor mapping. On new session creation, choose the daily theme deterministically from categories that still contain unseen system cores and call `selectLearningGroup` with all active-session reservations.

Use one operation lock; await repository persistence before committing React indices. Speech is fire-and-forget with caught errors and is cancelled before moving to another English phrase.

- [ ] **Step 4: Run hook tests and commit**

Run: `npm test -- tests/hooks/useNewPhraseLearning.test.tsx`

Expected: PASS.

```bash
git add app/hooks/useNewPhraseLearning.ts tests/hooks/useNewPhraseLearning.test.tsx
git commit -m "feat: manage resumable new phrase learning"
```

### Task 5: Create the learning and first-test interface

**Files:**
- Create: `app/components/NewPhraseLearning.tsx`
- Create: `tests/components/newPhraseLearning.test.tsx`
- Modify: `app/components/AppIcon.tsx`

- [ ] **Step 1: Write failing accessible UI tests**

```tsx
it("shows English, Chinese, context, pronunciation, and two examples during study", () => {
  render(<NewPhraseLearning controller={studyController} onHome={vi.fn()} />);
  expect(screen.getByRole("heading", { name: phrase.english })).toBeVisible();
  expect(screen.getByText(phrase.chinese)).toBeVisible();
  expect(screen.getByText(phrase.intent!)).toBeVisible();
  expect(screen.getByRole("button", { name: "重听标准发音" })).toBeEnabled();
  expect(screen.getAllByRole("listitem")).toHaveLength(2);
});

it("hides English until reveal during the first test", () => {
  render(<NewPhraseLearning controller={testController} onHome={vi.fn()} />);
  expect(screen.queryByText(phrase.english)).not.toBeInTheDocument();
  expect(screen.getByText(phrase.chinese)).toBeVisible();
});
```

Also test 5/5 transition, grade labels, disabled double-submit, speech warning, empty state, short group, completed group, exit, and retry.

- [ ] **Step 2: Run component test and verify RED**

Run: `npm test -- tests/components/newPhraseLearning.test.tsx`

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement the two-phase component**

Keep a single top-level component with small `StudyCard`, `FirstTest`, and `LearningComplete` children. Use semantic headings, an ordered example list, visible progress, and one primary study action. Reuse Phosphor speaker/close/completion icons through `AppIcon`; do not add Unicode glyph icons.

```tsx
return phase === "study"
  ? <StudyCard phrase={current} examples={examples.slice(0, 2)} onReplay={replay} onNext={nextStudyPhrase} />
  : phase === "test"
    ? <FirstTest phrase={current} revealed={revealed} onReveal={reveal} onGrade={grade} />
    : <LearningComplete learnedCount={total} onHome={onHome} />;
```

- [ ] **Step 4: Run component tests and commit**

Run: `npm test -- tests/components/newPhraseLearning.test.tsx`

Expected: PASS.

```bash
git add app/components/NewPhraseLearning.tsx app/components/AppIcon.tsx tests/components/newPhraseLearning.test.tsx
git commit -m "feat: add guided new phrase learning UI"
```

### Task 6: Wire the home, personal additions, and library filters

**Files:**
- Modify: `app/components/TrainingHome.tsx`
- Modify: `app/PhraseBankApp.tsx`
- Modify: `tests/components/app.test.tsx`

- [ ] **Step 1: Write failing app-flow tests**

Add tests that assert:

```tsx
expect(await screen.findByRole("button", { name: /学习 5 个新句/ })).toBeVisible();
expect(screen.getByRole("button", { name: /今日复习/ })).toHaveTextContent("7 个");
expect(screen.getByRole("button", { name: /三分钟速练/ })).toHaveTextContent("3 个已学表达");
```

Navigate into learning and back; complete a short learning group and observe `5 / 15`; add a personal phrase with default “先学习” and assert it is next; select “跳过学习，进入复习” and assert its state is learned; filter system library by each of the four learning stages.

- [ ] **Step 2: Run app tests and verify RED**

Run: `npm test -- tests/components/app.test.tsx tests/components/newPhraseLearning.test.tsx`

Expected: FAIL on missing controls, route, and filter.

- [ ] **Step 3: Add app routing and home props**

Extend `Screen` with `"learn"`; add a learning run key; pass `newLearnedToday`, `due.length`, `themeName`, and three callbacks to `TrainingHome`. Render `NewPhraseLearningSession` without bottom navigation, analogous to `PracticeSession`, and refresh best-effort only after route state changes so recovery is never blocked by repository errors.

- [ ] **Step 4: Add the personal skip-learning choice**

Extend the add form with a checked-by-default native checkbox:

```tsx
<label className="learning-choice">
  <input type="checkbox" checked={learnFirst} onChange={(event) => setLearnFirst(event.target.checked)} />
  先在“学习新句”里认识这句话
</label>
```

Save the phrase first. If unchecked, call `savePhraseLearningState` with `stage: "learned"`, `firstSeenAt` and `firstTestedAt` equal to the save timestamp, and `consecutiveGood: 0`; do not fabricate a review result or review event.

- [ ] **Step 5: Add stage filters to the system library**

Pass learning states into `Library`, render four accessible filter chips, and derive missing state as `unseen`. Keep category/search pagination behavior unchanged.

- [ ] **Step 6: Run component tests and commit**

Run: `npm test -- tests/components/app.test.tsx tests/components/newPhraseLearning.test.tsx`

Expected: PASS.

```bash
git add app/components/TrainingHome.tsx app/PhraseBankApp.tsx tests/components/app.test.tsx
git commit -m "feat: separate new learning from daily review"
```

### Task 7: Complete iPhone-safe visual styling and CSS contracts

**Files:**
- Modify: `app/globals.css`
- Modify: `tests/components/mobileStyles.test.ts`
- Create: `docs/audits/iphone13pro-learning/README.md`

- [ ] **Step 1: Write failing CSS contract tests**

Assert the live selectors contain:

```ts
expect(rule(".new-learning")).toContain("padding-bottom: calc(");
expect(rule(".learning-actions")).toContain("env(safe-area-inset-bottom)");
expect(rule(".learning-actions button")).toContain("min-height: 44px");
expect(rule(".learning-english")).toContain("overflow-wrap: anywhere");
expect(css).toContain("@media (max-width: 390px)");
expect(css).toContain("@media (prefers-reduced-motion: reduce)");
```

- [ ] **Step 2: Run CSS tests and verify RED**

Run: `npm test -- tests/components/mobileStyles.test.ts`

Expected: FAIL on missing learning selectors.

- [ ] **Step 3: Implement scoped responsive styles**

Use the existing ivory/forest/coral tokens. Give the study card a readable serif English hierarchy, keep examples visually secondary, reserve the actual fixed-action height plus safe area, use 16px form controls, and provide 44px minimum targets. At 390px, use 20-22px horizontal gutters; at 200% zoom, allow all text and grids to stack without horizontal page overflow.

- [ ] **Step 4: Run style and component tests**

Run: `npm test -- tests/components/mobileStyles.test.ts tests/components/newPhraseLearning.test.tsx tests/components/app.test.tsx`

Expected: PASS.

- [ ] **Step 5: Capture and inspect iPhone 13 Pro states**

At a true 390×844 CSS viewport capture: home with 0/15; study phrase with long English; fifth phrase; hidden-answer first test; revealed grades; speech failure; group complete; system-library stage filters. Inspect full-width content, bottom controls, safe area, wrapping, and 200% text zoom. Record each filename and result in `docs/audits/iphone13pro-learning/README.md`.

- [ ] **Step 6: Commit**

```bash
git add app/globals.css tests/components/mobileStyles.test.ts docs/audits/iphone13pro-learning
git commit -m "style: adapt new phrase learning for iPhone"
```

### Task 8: Full regression, deployment, and public acceptance

**Files:**
- Modify only if verification exposes a scoped defect.

- [ ] **Step 1: Run fresh complete verification**

Run:

```bash
npm test
npm run lint
npm run build
git diff --check
```

Expected: all tests pass, lint exits 0, production build succeeds, and diff check is clean. Confirm user-owned `findings.md`, `progress.md`, `task_plan.md`, and `.superpowers/` were never staged.

- [ ] **Step 2: Verify backward compatibility manually in automated fixtures**

Run the v1-v4 backup matrix, DB v3-to-v4 migration, existing active practice restore, system-content update identity preservation, and personal phrase CRUD suites. Expected: all pass without reseeding deleted personal content or changing stable system IDs.

- [ ] **Step 3: Push and monitor deployment**

Push `main` using the configured GitHub deployment key. Wait for both GitHub Actions test and deploy jobs to complete successfully. If deployment fails, inspect the actual failed step before retrying; do not treat public-probe failure as success without direct server/container and HTTPS evidence.

- [ ] **Step 4: Verify production on iPhone and HTTPS**

Confirm `https://phrase.archdemy.com/` returns final 200, the PWA still opens standalone, a new five-core group survives reload, unseen system content cannot appear in quick practice, two quick groups rotate, Safari speech remains audible after a user gesture, and old local data remains present after DB migration.

- [ ] **Step 5: Record final evidence and commit only if documentation changed**

If production evidence is added, commit only those audit files:

```bash
git add docs/audits/iphone13pro-learning
git commit -m "docs: record new learning production acceptance"
```
