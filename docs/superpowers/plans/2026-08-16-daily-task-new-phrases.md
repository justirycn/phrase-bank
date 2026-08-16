# Daily Review and New Phrase Task Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make “继续今日任务” complete due review followed by a configurable daily new-phrase target, while keeping autonomous learning locked until the task is complete and preserving all three independent session checkpoints.

**Architecture:** Add a pure daily-task domain summary, extend learning sessions with a `daily | autonomous` purpose, and maintain one active pointer per learning purpose. Reuse the existing review and new-phrase state machines, but orchestrate them through distinct `practice`, `daily-learn`, and `learn` screens so daily review automatically hands off to daily learning without letting autonomous progress overwrite either checkpoint.

**Tech Stack:** React 19, TypeScript, Vitest/Testing Library, IndexedDB through `idb`, cloud snapshot repository, vinext/Vite, CSS.

---

## File map

- Create `app/domain/dailyTask.ts`: Shanghai-day counting, task-stage derivation, daily batch size, and autonomous gate.
- Create `tests/domain/dailyTask.test.ts`: pure boundary coverage for review/new goals, target changes, and inventory shortage.
- Modify `app/domain/types.ts`: `LearningSessionPurpose`, `dailyNewPhraseGoal`, and session purpose.
- Modify `app/domain/learningSelection.ts`: accept an explicit batch target while retaining autonomous default 5.
- Modify `app/storage/backup.ts`: normalize old preferences and purpose-less learning sessions without a backup-version bump.
- Modify `app/storage/repository.ts`: purpose-aware active-learning lookup.
- Modify `app/storage/indexedDbRepository.ts`: independent daily/autonomous pointers and one-active-per-purpose enforcement.
- Modify `app/storage/cloudRepository.ts`: preserve the extended snapshot through existing sync boundaries.
- Modify `app/services/homeData.ts`: load both active learning purposes and the extended preferences.
- Modify `app/hooks/useNewPhraseLearning.ts`: purpose-aware restore/create and automatic daily group chaining.
- Modify `app/components/screens/LearningScreen.tsx`: daily/autonomous mode and daily group orchestration.
- Modify `app/components/NewPhraseLearning.tsx`: daily labels, inventory shortage, goal completion, and autonomous labels.
- Modify `app/components/screens/PracticeScreen.tsx`: finish review once and hand off to daily learning.
- Modify `app/PhraseBankApp.tsx`: derive daily task, route sequential stages, and gate autonomous learning.
- Modify `app/components/TrainingHome.tsx`: two-part daily progress and locked autonomous entry.
- Modify `app/components/screens/SettingsScreen.tsx`: editable daily new-phrase goal.
- Modify `app/globals.css`: locked/complete states and narrow-screen wrapping.
- Modify corresponding domain, storage, hook, component, app, cloud, home-data, mobile-style, benchmark, and deployment-evidence tests.

### Task 1: Define daily-task rules and compatible persisted types

**Files:**
- Create: `app/domain/dailyTask.ts`
- Create: `tests/domain/dailyTask.test.ts`
- Modify: `app/domain/types.ts`
- Modify: `app/domain/learningSelection.ts`
- Modify: `tests/domain/learningSelection.test.ts`
- Modify: `app/storage/backup.ts`
- Modify: `tests/storage/backup.test.ts`

- [ ] **Step 1: Write failing domain and backup tests**

Add table-driven tests proving the task is review-first, defaults to 10 new phrases, clamps batches to 5, unlocks autonomous only when both stages are complete, and preserves shortage as incomplete:

```ts
expect(deriveDailyTask({ dueCount: 2, activeReview: false, newCompletedToday: 0, newGoal: 10, availableNew: 20 }))
  .toMatchObject({ stage: "review", newRemaining: 10, complete: false, autonomousUnlocked: false });
expect(deriveDailyTask({ dueCount: 0, activeReview: false, newCompletedToday: 6, newGoal: 10, availableNew: 20 }))
  .toMatchObject({ stage: "learning", newRemaining: 4, nextBatchSize: 4, complete: false });
expect(deriveDailyTask({ dueCount: 0, activeReview: false, newCompletedToday: 10, newGoal: 10, availableNew: 20 }))
  .toMatchObject({ stage: "complete", newRemaining: 0, complete: true, autonomousUnlocked: true });
expect(deriveDailyTask({ dueCount: 0, activeReview: false, newCompletedToday: 3, newGoal: 10, availableNew: 0 }))
  .toMatchObject({ stage: "learning", newRemaining: 7, nextBatchSize: 0, inventoryShortage: 7 });
```

Add backup tests with a version-5 snapshot that contains `{ dailyMasteryGoal: 12 }` and a purpose-less active learning session. Assert normalization produces `dailyNewPhraseGoal: 10` and `purpose: "autonomous"`. Add invalid new-goal cases for `0`, `51`, and `1.5`.

- [ ] **Step 2: Run the focused tests and witness RED**

Run:

```powershell
npm.cmd test -- tests/domain/dailyTask.test.ts tests/domain/learningSelection.test.ts tests/storage/backup.test.ts
```

Expected: FAIL because `deriveDailyTask`, `dailyNewPhraseGoal`, session `purpose`, and explicit batch targeting do not exist.

- [ ] **Step 3: Add the pure domain contract and type defaults**

In `app/domain/types.ts` add:

```ts
export type LearningSessionPurpose = "daily" | "autonomous";

export interface AppPreferences {
  dailyMasteryGoal: number;
  dailyNewPhraseGoal: number;
}

export const DEFAULT_DAILY_MASTERY_GOAL = 10;
export const DEFAULT_DAILY_NEW_PHRASE_GOAL = 10;

export interface LearningSessionRecord {
  id: string;
  purpose: LearningSessionPurpose;
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

Create `app/domain/dailyTask.ts` with a single explicit input/output boundary:

```ts
export interface DailyTaskInput {
  dueCount: number;
  activeReview: boolean;
  newCompletedToday: number;
  newGoal: number;
  availableNew: number;
  activeDailyLearning?: boolean;
}

export function deriveDailyTask(input: DailyTaskInput) {
  const newRemaining = Math.max(0, input.newGoal - input.newCompletedToday);
  const reviewPending = input.activeReview || input.dueCount > 0;
  const stage = reviewPending ? "review" as const
    : newRemaining > 0 ? "learning" as const
      : "complete" as const;
  return {
    stage,
    reviewPending,
    newRemaining,
    nextBatchSize: Math.min(5, newRemaining, input.availableNew),
    inventoryShortage: reviewPending ? 0 : Math.max(0, newRemaining - input.availableNew),
    complete: stage === "complete",
    autonomousUnlocked: stage === "complete",
  };
}
```

Extend `previewLearningGroup` options with `target?: number`; normalize it to an integer from 0 through 5 and default it to `AUTONOMOUS_LEARNING_GROUP_SIZE`. A target of 0 must return no phrases without changing category rotation.

- [ ] **Step 4: Normalize legacy preferences and sessions**

In `app/storage/backup.ts`, normalize rather than reject compatible old data:

```ts
const validDailyMasteryGoal = (value: number | undefined) => value === undefined
  ? DEFAULT_DAILY_MASTERY_GOAL
  : Number.isInteger(value) && value > 0
    ? value
    : (() => { throw new Error("每日掌握目标无效"); })();

const validDailyNewPhraseGoal = (value: number) => Number.isInteger(value) && value >= 1 && value <= 50
  ? value
  : (() => { throw new Error("每日新句目标必须是 1 到 50 的整数"); })();

const normalizeAppPreferences = (value: Partial<AppPreferences> | undefined): AppPreferences => ({
  dailyMasteryGoal: validDailyMasteryGoal(value?.dailyMasteryGoal),
  dailyNewPhraseGoal: value?.dailyNewPhraseGoal === undefined
    ? DEFAULT_DAILY_NEW_PHRASE_GOAL
    : validDailyNewPhraseGoal(value.dailyNewPhraseGoal),
});

const normalizeLearningSession = (session: LearningSessionRecord | Omit<LearningSessionRecord, "purpose">): LearningSessionRecord => ({
  ...session,
  purpose: "purpose" in session && session.purpose === "daily" ? "daily" : "autonomous",
});
```

Add these bounded Shanghai helpers to `dailyTask.ts`; the counter deliberately excludes phrases marked learned directly from the add screen:

```ts
const shanghaiDate = (value: Date) => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
}).format(value);

export function shanghaiDayRange(now: Date) {
  const [year, month, day] = shanghaiDate(now).split("-").map(Number);
  const from = new Date(Date.UTC(year, month - 1, day) - 8 * 60 * 60 * 1000);
  return { from, to: new Date(from.getTime() + 24 * 60 * 60 * 1000 - 1) };
}

export function countNewPhrasesOnShanghaiDay(events: TrainingEvent[], date: string) {
  return new Set(events.filter((event) => event.source === "new"
    && shanghaiDate(new Date(event.occurredAt)) === date).map((event) => event.phraseId)).size;
}
```

Use these normalizers for v4/v5 parsing, `normalizeLegacyBackup`, and final return values. Validate that normalized snapshots contain no more than one active session per purpose; two active sessions are valid only when their purposes differ.

- [ ] **Step 5: Run focused tests and commit**

Run:

```powershell
npm.cmd test -- tests/domain/dailyTask.test.ts tests/domain/learningSelection.test.ts tests/storage/backup.test.ts
npx.cmd eslint app/domain/dailyTask.ts app/domain/types.ts app/domain/learningSelection.ts app/storage/backup.ts tests/domain/dailyTask.test.ts tests/domain/learningSelection.test.ts tests/storage/backup.test.ts
git diff --check
```

Expected: all focused tests pass and lint/diff checks exit 0.

Commit:

```powershell
git add app/domain/dailyTask.ts app/domain/types.ts app/domain/learningSelection.ts app/storage/backup.ts tests/domain/dailyTask.test.ts tests/domain/learningSelection.test.ts tests/storage/backup.test.ts
git commit -m "feat: define daily review and learning goals"
```

### Task 2: Persist independent daily and autonomous learning sessions

**Files:**
- Modify: `app/storage/repository.ts`
- Modify: `app/storage/indexedDbRepository.ts`
- Modify: `tests/storage/repository.test.ts`
- Modify: `app/storage/cloudRepository.ts`
- Modify: `tests/storage/cloudRepository.test.ts`
- Modify: `app/services/homeData.ts`
- Modify: `tests/services/homeData.test.ts`
- Modify: `tests/support/homeDataBenchmark.ts`
- Modify: `tests/support/homeDataBenchmark.test.ts`

- [ ] **Step 1: Write failing repository and migration tests**

Add real fake-IndexedDB tests that:

```ts
await repo.saveLearningSession(learningSession({ id: "daily", purpose: "daily" }));
await repo.saveLearningSession(learningSession({ id: "autonomous", purpose: "autonomous" }));
expect((await repo.getActiveLearningSession("daily"))?.id).toBe("daily");
expect((await repo.getActiveLearningSession("autonomous"))?.id).toBe("autonomous");
```

Also prove a second active session of the same purpose rejects atomically; completing/deleting one purpose does not alter the other pointer; an existing raw v5 purpose-less session is rewritten as autonomous during `initialize`; import/export/cloud upload preserve both active sessions and preferences.

Update home-data tests to require two bounded pointer reads and return fields `activeDailyLearningSession` and `activeAutonomousLearningSession`.

- [ ] **Step 2: Run tests and witness RED**

Run:

```powershell
npm.cmd test -- tests/storage/repository.test.ts tests/storage/cloudRepository.test.ts tests/services/homeData.test.ts tests/support/homeDataBenchmark.test.ts
```

Expected: FAIL because repository lookup is not purpose-aware and current persistence rejects two active learning sessions globally.

- [ ] **Step 3: Implement purpose-aware repository methods and metadata pointers**

Change the repository contract to:

```ts
getActiveLearningSession(purpose: LearningSessionPurpose): Promise<LearningSessionRecord | undefined>;
```

In IndexedDB use explicit keys:

```ts
const ACTIVE_DAILY_LEARNING_SESSION_KEY = "activeDailyLearningSessionId";
const ACTIVE_AUTONOMOUS_LEARNING_SESSION_KEY = "activeAutonomousLearningSessionId";
const learningPointerKey = (purpose: LearningSessionPurpose) => purpose === "daily"
  ? ACTIVE_DAILY_LEARNING_SESSION_KEY
  : ACTIVE_AUTONOMOUS_LEARNING_SESSION_KEY;
```

During `initialize`, include `learningSessions` in the transaction, rewrite every purpose-less record to `purpose: "autonomous"`, build the newest active pointer for each purpose, and remove the legacy `activeLearningSessionId` key. Do not bump the database version because no store or index shape changes.

In `saveLearningSession`, reject only `otherActive` records with the same purpose. In `completeLearningSession`, `submitFirstLearningReview`, phrase deletion cleanup, and snapshot import, update only the pointer matching the session purpose. The active read remains constant work: one metadata `get` plus one primary-key session `get`.

- [ ] **Step 4: Load and synchronize both purposes**

Update `loadHomeData` to call:

```ts
repository.getActiveLearningSession("daily"),
repository.getActiveLearningSession("autonomous"),
```

Return both named fields. Update benchmark instrumentation to record two requests and at most one returned row per purpose. CloudRepository needs no new sync algorithm, but its tests must prove the exported snapshot contains both sessions and the extended preferences after a successful upload and after a failed-upload retry.

- [ ] **Step 5: Run focused tests and commit**

Run:

```powershell
npm.cmd test -- tests/storage/repository.test.ts tests/storage/cloudRepository.test.ts tests/services/homeData.test.ts tests/support/homeDataBenchmark.test.ts
npx.cmd eslint app/storage/repository.ts app/storage/indexedDbRepository.ts app/storage/cloudRepository.ts app/services/homeData.ts tests/storage/repository.test.ts tests/storage/cloudRepository.test.ts tests/services/homeData.test.ts tests/support/homeDataBenchmark.ts tests/support/homeDataBenchmark.test.ts
git diff --check
```

Commit:

```powershell
git add app/storage/repository.ts app/storage/indexedDbRepository.ts app/storage/cloudRepository.ts app/services/homeData.ts tests/storage/repository.test.ts tests/storage/cloudRepository.test.ts tests/services/homeData.test.ts tests/support/homeDataBenchmark.ts tests/support/homeDataBenchmark.test.ts
git commit -m "feat: persist separate daily learning sessions"
```

### Task 3: Make new-phrase learning purpose-aware and chain daily groups

**Files:**
- Modify: `app/hooks/useNewPhraseLearning.ts`
- Modify: `tests/hooks/useNewPhraseLearning.test.tsx`
- Modify: `app/components/screens/LearningScreen.tsx`
- Modify: `app/components/NewPhraseLearning.tsx`
- Modify: `tests/components/newPhraseLearning.test.tsx`

- [ ] **Step 1: Write failing hook and component tests**

Add hook tests for these exact flows:

1. `purpose: "daily", dailyGoal: 10` selects five phrases, completes them, creates a second distinct daily session of five, and finishes as `goal-complete` after ten distinct current-Shanghai-day `source: "new"` events.
2. A daily group with only three available unseen phrases enters `empty` with `dailyRemaining: 7` after those three finish.
3. Daily initialization restores only the daily active session; autonomous initialization restores only autonomous.
4. A purpose-less migrated session is restored only as autonomous.
5. Repository replacement and unmount discard late results for both purposes.

Add component tests that assert exact labels `今日任务 · 新句学习`, `自主学习 · 先学后测`, `自主学习 · 小测`, inventory text `还差 7 句，可去句库添加`, and the daily goal completion page.

- [ ] **Step 2: Run tests and witness RED**

Run:

```powershell
npm.cmd test -- tests/hooks/useNewPhraseLearning.test.tsx tests/components/newPhraseLearning.test.tsx
```

Expected: FAIL because hook options, `goal-complete`, purpose-specific reads, and daily UI do not exist.

- [ ] **Step 3: Extend the hook contract**

Add these options/controller fields:

```ts
export interface UseNewPhraseLearningOptions {
  repository: PhraseRepository;
  speech: Pick<BrowserSpeechService, "speak" | "cancel">;
  purpose: LearningSessionPurpose;
  dailyGoal?: number;
  now?: () => Date;
  idFactory?: () => string;
}

export type NewLearningPhase = "loading" | "study" | "test" | "complete" | "goal-complete" | "empty" | "error";

export interface NewPhraseLearningController {
  purpose: LearningSessionPurpose;
  sessionId?: string;
  phase: NewLearningPhase;
  current?: Phrase;
  examples: Phrase[];
  studyIndex: number;
  testIndex: number;
  total: number;
  revealed: boolean;
  error?: string;
  busy: boolean;
  dailyRemaining: number;
  replay(): Promise<void>;
  nextStudyPhrase(): Promise<void>;
  reveal(): Promise<void>;
  grade(result: ReviewResult): Promise<void>;
  retry(): void;
}
```

Initialization must call `getActiveLearningSession(purpose)`, write `purpose` into new sessions, and for daily purpose read the bounded current Shanghai day event range and compute:

```ts
const range = shanghaiDayRange(started);
const events = await repository.listTrainingEvents(range.from, range.to);
const newCompletedToday = countNewPhrasesOnShanghaiDay(events, date);
const dailyRemaining = Math.max(0, (dailyGoal ?? DEFAULT_DAILY_NEW_PHRASE_GOAL) - newCompletedToday);
```

If daily remaining is zero, enter `goal-complete` without creating a session. Otherwise select the bounded batch with:

```ts
const preview = previewLearningGroup(
  phrases,
  states,
  categories.map((category) => category.id),
  { date, target: Math.min(5, dailyRemaining) },
);
```

- [ ] **Step 4: Chain daily groups without exposing an intermediate completion page**

Keep completion durable: finish the current session first. For daily purpose, `LearningScreen` observes `phase === "complete"` and invokes `controller.retry()` exactly once per `controller.sessionId`. Retry re-reads current-day events; it creates the next daily group or returns `goal-complete`. Guard the effect with a ref containing the completed session ID so StrictMode cannot issue two retries.

For autonomous purpose, retain the existing completion page and “再学 5 句”. For daily purpose, render:

```tsx
<span className="task-mode task-mode-daily-learning">今日任务 · 新句学习</span>
```

On `goal-complete`, invoke an idempotent `onDailyGoalComplete` refresh callback and show “今日任务已完成” with “回到首页” and “开始自主学习” actions. On `empty` with positive `dailyRemaining`, show the exact shortage count. Preserve all existing busy, idempotency, transaction, speech, unmount, and repository-generation guards. Extend `LearningScreen` and `NewPhraseLearning` props with `onStartAutonomous` only for the daily goal-complete branch.

- [ ] **Step 5: Run focused tests and commit**

Run:

```powershell
npm.cmd test -- tests/hooks/useNewPhraseLearning.test.tsx tests/components/newPhraseLearning.test.tsx
npx.cmd eslint app/hooks/useNewPhraseLearning.ts app/components/screens/LearningScreen.tsx app/components/NewPhraseLearning.tsx tests/hooks/useNewPhraseLearning.test.tsx tests/components/newPhraseLearning.test.tsx
git diff --check
```

Commit:

```powershell
git add app/hooks/useNewPhraseLearning.ts app/components/screens/LearningScreen.tsx app/components/NewPhraseLearning.tsx tests/hooks/useNewPhraseLearning.test.tsx tests/components/newPhraseLearning.test.tsx
git commit -m "feat: chain daily new phrase groups"
```

### Task 4: Orchestrate review-first daily tasks in the app

**Files:**
- Modify: `app/components/screens/PracticeScreen.tsx`
- Modify: `tests/components/speakingPractice.test.tsx`
- Modify: `app/PhraseBankApp.tsx`
- Modify: `tests/components/app.test.tsx`
- Modify: `tests/components/lazyScreens.test.tsx`

- [ ] **Step 1: Write failing integrated flow tests**

Create app tests for:

- due review present: clicking “继续今日任务” opens `今日复习 · 中文回忆`; after the final persisted grade, the app finishes the review session and automatically renders `今日任务 · 新句学习`;
- no due review: clicking the same entry opens daily learning directly;
- an active daily-learning checkpoint wins after review is complete, while an active autonomous checkpoint remains untouched and hidden;
- repository A pending review completion followed by repository B replacement cannot navigate B or consume B's daily queue;
- leaving during review, daily learning, and autonomous learning restores each exact cursor independently.

Update lazy-screen tests so the new `daily-learn` route still loads the Learning screen chunk and chunk-retry behavior remains recoverable.

- [ ] **Step 2: Run tests and witness RED**

Run:

```powershell
npm.cmd test -- tests/components/app.test.tsx tests/components/speakingPractice.test.tsx tests/components/lazyScreens.test.tsx
```

Expected: FAIL because the app has no daily-learning route or automatic review handoff.

- [ ] **Step 3: Add an idempotent review completion callback**

Extend `PracticeScreen` with `completionKey: string` and `onComplete: () => Promise<void>`. When `controller.phase` becomes complete, use a ref keyed by `completionKey` to perform exactly once:

```ts
await controller.finish();
if (generation === generationRef.current) await onComplete();
```

Keep pause behavior as “save and return home”. A failed finish keeps the completion state visible and exposes the existing retry/error path; it must not enter daily learning early.

- [ ] **Step 4: Route daily stages explicitly**

Extend `Screen` with `daily-learn`. Derive `newCompletedToday`, available unseen count, and `dailyTask` with the pure domain helper. Route:

```ts
const continueToday = () => {
  if (dailyTask.stage === "review") return startTraining("standard");
  if (dailyTask.stage === "learning") return go("daily-learn");
};
```

After review completion, refresh current-repository home data under the existing repository-generation guard, then route to `daily-learn` only if daily learning remains. Render LearningScreen with `purpose="daily"` and `dailyGoal`; render the existing `learn` screen with `purpose="autonomous"`.

Key both learning screens by repository identity plus purpose. Do not allow an old repository callback to refresh or navigate the replacement repository.

- [ ] **Step 5: Run focused tests and commit**

Run:

```powershell
npm.cmd test -- tests/components/app.test.tsx tests/components/speakingPractice.test.tsx tests/components/lazyScreens.test.tsx
npx.cmd eslint app/components/screens/PracticeScreen.tsx app/PhraseBankApp.tsx tests/components/app.test.tsx tests/components/speakingPractice.test.tsx tests/components/lazyScreens.test.tsx
git diff --check
```

Commit:

```powershell
git add app/components/screens/PracticeScreen.tsx app/PhraseBankApp.tsx tests/components/app.test.tsx tests/components/speakingPractice.test.tsx tests/components/lazyScreens.test.tsx
git commit -m "feat: run review before daily learning"
```

### Task 5: Present daily progress, autonomous gating, and settings

**Files:**
- Modify: `app/components/TrainingHome.tsx`
- Modify: `tests/components/trainingHome.test.tsx`
- Modify: `app/components/screens/SettingsScreen.tsx`
- Modify: `tests/components/app.test.tsx`
- Modify: `app/globals.css`
- Modify: `tests/components/mobileStyles.test.ts`

- [ ] **Step 1: Write failing home, settings, and CSS tests**

Assert the home entry exposes exact combinations:

```tsx
expect(dailyButton).toHaveTextContent("到期复习 3 句 · 今日新句 6 / 10");
expect(autonomousButton).toBeDisabled();
expect(autonomousButton).toHaveTextContent("完成今日任务后开放");
```

After both stages complete, assert the daily button shows `今日任务已完成`, autonomous becomes enabled, and its active autonomous checkpoint text wins over a fresh preview.

Add settings tests that save `{ dailyMasteryGoal: 18, dailyNewPhraseGoal: 15 }`, reject 0/51/non-integer new goals, preserve the edited value after a failed save, and recompute the home gate after a successful retry.

Add mobile CSS contract tests for disabled contrast, two-line progress wrapping, the daily-learning task-mode pill, 390px layout, safe-area bottom reserve, 200%-equivalent narrow container, and no reintroduction of a third home entry.

- [ ] **Step 2: Run tests and witness RED**

Run:

```powershell
npm.cmd test -- tests/components/trainingHome.test.tsx tests/components/app.test.tsx tests/components/mobileStyles.test.ts
```

Expected: FAIL because the two-part status, autonomous gate, new preference control, and styles are absent.

- [ ] **Step 3: Implement the home contract**

Pass `dailyNewPhraseGoal`, `newCompletedToday` (the existing distinct current-day `source: "new"` event count), `dailyTask`, active daily-learning remaining, and active autonomous remaining into TrainingHome. Keep exactly two buttons:

```tsx
const dailyTaskLabel = dailyTask.stage === "complete"
  ? "今日任务已完成"
  : dailyTask.stage === "review"
    ? activeReview
      ? `继续复习 · 剩余 ${reviewRemaining} 句`
      : `到期复习 ${dueCount} 句 · 今日新句 ${newCompletedToday} / ${dailyNewPhraseGoal}`
    : activeDailyLearning
      ? `继续今日新句 · 剩余 ${dailyLearningRemaining} 句`
      : dailyTask.inventoryShortage > 0
        ? `今日新句 ${newCompletedToday} / ${dailyNewPhraseGoal} · 还差 ${dailyTask.inventoryShortage} 句`
        : `到期复习已完成 · 今日新句 ${newCompletedToday} / ${dailyNewPhraseGoal}`;
const autonomousLabel = !dailyTask.autonomousUnlocked
  ? "完成今日任务后开放"
  : activeAutonomous
    ? `继续上次 · 剩余 ${autonomousRemaining} 句`
    : nextAutonomousCount > 0
      ? `开始学习 ${nextAutonomousCount} 句`
      : "暂无新句，可去句库添加";

<button className="continue-start" disabled={dailyTask.complete} onClick={onContinue}>
  <span><AppIcon name="dueReview" size={24} /><b>继续今日任务</b><small>{dailyTaskLabel}</small></span>
  <AppIcon name="forward" size={22} />
</button>
<button className="learning-start" disabled={!dailyTask.autonomousUnlocked || (!activeAutonomous && nextAutonomousCount === 0)} onClick={onStartLearning}>
  <span><AppIcon name="library" size={24} /><b>自主学习</b><small>{autonomousLabel}</small></span>
  <AppIcon name="forward" size={22} />
</button>
```

The daily button must remain enabled for inventory shortage so the user can open the truthful shortage screen. The autonomous button uses native `disabled` before completion, not a click guard alone.

- [ ] **Step 4: Implement the settings control safely**

SettingsScreen must keep a single draft containing both preferences and save the full object:

```ts
await repository.saveAppPreferences({
  dailyMasteryGoal: masteryValue,
  dailyNewPhraseGoal: newPhraseValue,
});
```

Validate `dailyNewPhraseGoal` as an integer from 1 through 50 before writing. On failure keep both draft strings, show the existing alert, and do not call refresh or success notice. On success refresh once and show a success notice.

- [ ] **Step 5: Add scoped responsive styles and run tests**

Keep the existing green review button and warm learning button. Add only scoped selectors for `.daily-task-breakdown`, `.learning-start:disabled`, and `.task-mode-daily-learning`; use `min-width: 0`, `overflow-wrap: anywhere`, existing safe-area padding, and existing reduced-motion rules.

Run:

```powershell
npm.cmd test -- tests/components/trainingHome.test.tsx tests/components/app.test.tsx tests/components/mobileStyles.test.ts
npx.cmd eslint app/components/TrainingHome.tsx app/components/screens/SettingsScreen.tsx app/PhraseBankApp.tsx tests/components/trainingHome.test.tsx tests/components/app.test.tsx tests/components/mobileStyles.test.ts
git diff --check
```

Commit:

```powershell
git add app/components/TrainingHome.tsx app/components/screens/SettingsScreen.tsx app/PhraseBankApp.tsx app/globals.css tests/components/trainingHome.test.tsx tests/components/app.test.tsx tests/components/mobileStyles.test.ts
git commit -m "feat: show daily review and new phrase progress"
```

### Task 6: Prove cross-day behavior, compatibility, and release evidence

**Files:**
- Modify: `tests/domain/review.test.ts`
- Modify: `tests/hooks/useNewPhraseLearning.test.tsx`
- Modify: `tests/storage/repository.test.ts`
- Modify: `tests/storage/cloudRepository.test.ts`
- Modify: `tests/components/app.test.tsx`
- Modify: `tests/deployment/homeAuditArtifacts.test.ts`
- Modify: `tests/deployment/homeBeforeAfter.test.ts`
- Modify: `docs/audits/home-heatmap-performance/metrics.json`
- Modify: `docs/audits/home-heatmap-performance/README.md`

- [ ] **Step 1: Add the final cross-boundary regressions**

Add exact Asia/Shanghai boundary tests:

- first test at `2026-08-16T15:59:59.999Z` is not due on Shanghai Aug 16;
- first test at that instant can become due on Shanghai Aug 17 under the existing schedule;
- first test at `2026-08-16T16:00:00.000Z` counts toward Aug 17's daily target, not Aug 16's;
- an unfinished Aug 16 daily session restored Aug 17 counts only phrases first-tested on Aug 17 toward Aug 17's target;
- an unfinished autonomous session survives while Aug 17 review and daily-learning sessions complete;
- identical cloud retry does not duplicate a first test, pointer, event, or daily count.

Add import tests for old v5 snapshots with one purpose-less active session and old preferences; assert normalized export has autonomous purpose, both goal fields, and no data loss.

- [ ] **Step 2: Run the complete focused contract**

Run:

```powershell
npm.cmd test -- tests/domain/dailyTask.test.ts tests/domain/learningSelection.test.ts tests/domain/review.test.ts tests/hooks/useNewPhraseLearning.test.tsx tests/storage/backup.test.ts tests/storage/repository.test.ts tests/storage/cloudRepository.test.ts tests/services/homeData.test.ts tests/components/newPhraseLearning.test.tsx tests/components/speakingPractice.test.tsx tests/components/trainingHome.test.tsx tests/components/app.test.tsx tests/components/lazyScreens.test.tsx tests/components/mobileStyles.test.ts
```

Expected: all files pass with zero failures.

- [ ] **Step 3: Run canonical performance evidence safely**

Before the benchmark, verify the app tree is clean and `C:\Temp\phb-*` count is zero. Run:

```powershell
npm.cmd run benchmark:home-before-after
```

Expected: exit 0; runner reports `verifiedResidueCount: 0`, no worktree registration, bounded active session rows of at most one daily plus one autonomous, and writes current metrics atomically. If cleanup fails or any temp directory remains, stop immediately and do not retry with a stronger deletion method.

Update the audit README only with the exact generated source tree, build bytes, request/row counts, and observed service-ready timing.

- [ ] **Step 4: Run final verification**

Run fresh:

```powershell
npm.cmd run test:home-performance
npm.cmd test
npm.cmd run lint
npm.cmd run build
git diff --check
git status --short
```

Expected: performance gate passes; full test suite has zero failures; lint/build/diff checks exit 0; only the intended audit evidence files remain changed before commit.

- [ ] **Step 5: Commit release evidence**

```powershell
git add docs/audits/home-heatmap-performance/README.md docs/audits/home-heatmap-performance/metrics.json tests/deployment/homeAuditArtifacts.test.ts tests/deployment/homeBeforeAfter.test.ts
git commit -m "test: refresh daily task evidence"
git status --short --branch
```

Expected: final feature worktree is clean.

## Final review checklist

- Daily entry always chooses review before new learning.
- Daily goal defaults to 10 and accepts only integers 1–50.
- Daily batches never exceed 5 and chain until the target is met.
- Autonomous learning is natively disabled until review and daily new goals are both complete.
- Daily, autonomous, and review checkpoints coexist without replacement or stale-result pollution.
- Purpose-less sessions migrate to autonomous; old preferences gain the default new goal.
- First learning remains unavailable for same-day review and becomes eligible only on a later Shanghai day under the existing schedule.
- Inventory shortage is truthful and does not unlock autonomous learning.
- Cloud retry, repository replacement, unmount, double submission, and refresh preserve idempotency.
- Home-data startup remains bounded and build budgets remain green.
