# Autonomous Learning and Daily Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the duplicated three-entry home flow with a daily-review entry and an unlimited, resumable five-phrase autonomous-learning entry whose completed phrases first become reviewable on the next Shanghai calendar day.

**Architecture:** Keep the existing persisted `TrainingSessionRecord` and `LearningSessionRecord` boundaries. Remove the daily-new-phrase quota from selection, hook initialization, and the atomic repository write, while retaining a fixed five-phrase group size. Route daily review and autonomous learning independently from `PhraseBankApp`, then expose “learn another group” by reusing the hook’s generation-safe initializer after a completed session.

**Tech Stack:** TypeScript, React 19, Vitest, Testing Library, IndexedDB via `idb`, vinext/Vite, ESLint.

**Design reference:** `docs/superpowers/specs/2026-08-14-autonomous-learning-daily-review-design.md`

---

## File map

- `app/domain/learningSelection.ts`: owns the fixed autonomous group size and deterministic unseen-phrase preview.
- `app/hooks/useNewPhraseLearning.ts`: restores or creates one learning group without consulting a daily quota.
- `app/storage/indexedDbRepository.ts`: atomically records first-learning reviews without a fifteenth/sixteenth daily gate.
- `app/storage/cloudRepository.ts`: remains a thin sync wrapper; its existing failed-upload retry suite verifies the local atomic result is uploaded once on retry.
- `app/components/NewPhraseLearning.tsx`: presents autonomous-learning copy and starts another group from the complete state.
- `app/components/screens/LearningScreen.tsx`: wires the quota-free hook.
- `app/components/TrainingHome.tsx`: renders exactly two home entries and their independent states.
- `app/PhraseBankApp.tsx`: derives preview data and routes daily review independently from active learning.
- `app/components/screens/AddPhraseScreen.tsx`: uses the new “自主学习” product name.
- `app/globals.css`: keeps the two entries responsive and applies the review color/icon treatment to the daily-task entry.
- Tests under `tests/domain`, `tests/hooks`, `tests/storage`, and `tests/components` lock each boundary before production changes.

### Task 1: Make learning preview a fixed five-phrase autonomous group

**Files:**
- Modify: `app/domain/learningSelection.ts`
- Test: `tests/domain/learningSelection.test.ts`

- [ ] **Step 1: Write the failing preview contract**

Replace the quota-shaped preview test with a fixed-group contract and add a short-inventory assertion:

```ts
import {
  AUTONOMOUS_LEARNING_GROUP_SIZE,
  previewLearningGroup,
  selectLearningGroup,
} from "../../app/domain/learningSelection";

it("previews one fixed autonomous group without a daily remaining input", () => {
  const phrases = Array.from({ length: 8 }, (_, index) =>
    phrase(`work-${index}`, { categoryId: "work" }),
  );

  const preview = previewLearningGroup(
    phrases,
    [],
    ["daily", "travel", "work"],
    { date: "2026-08-10" },
  );

  expect(AUTONOMOUS_LEARNING_GROUP_SIZE).toBe(5);
  expect(preview.themeCategoryId).toBe("work");
  expect(preview.phrases).toHaveLength(5);
});

it("returns the actual short autonomous group when fewer than five remain", () => {
  const preview = previewLearningGroup(
    [phrase("one"), phrase("two")],
    [],
    ["travel"],
    { date: "2026-08-10" },
  );

  expect(preview.phrases.map(({ id }) => id)).toEqual(["one", "two"]);
});
```

- [ ] **Step 2: Run the domain test and witness RED**

Run: `npm test -- tests/domain/learningSelection.test.ts`

Expected: FAIL because `AUTONOMOUS_LEARNING_GROUP_SIZE` does not exist and `previewLearningGroup` still requires `remaining`.

- [ ] **Step 3: Replace the daily-limit preview API with a group-size API**

In `app/domain/learningSelection.ts`, delete `DAILY_NEW_PHRASE_LIMIT`, add the autonomous constant, remove `remaining`, and always cap the preview at five:

```ts
export const AUTONOMOUS_LEARNING_GROUP_SIZE = 5;

export function previewLearningGroup(
  phrases: Phrase[],
  states: PhraseLearningState[],
  categoryIds: readonly string[],
  options: { date: string },
): LearningGroupPreview {
  const validCategories = new Set(categoryIds);
  const stateById = new Map(states.map((state) => [state.phraseId, state]));
  const unseen = (phrase: Phrase) => !phrase.retiredAt
    && (stateById.get(phrase.id)?.stage ?? "unseen") === "unseen"
    && validCategories.has(phrase.categoryId);
  const systemThemes = [...new Set(
    phrases
      .filter((phrase) => phrase.origin === "system" && phrase.kind === "core" && unseen(phrase))
      .map((phrase) => phrase.categoryId),
  )].sort();
  const personal = phrases
    .filter((phrase) => (phrase.origin ?? "personal") === "personal"
      && (phrase.kind ?? "standalone") === "standalone"
      && unseen(phrase))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || left.id.localeCompare(right.id));
  const themeCategoryId = systemThemes.length > 0
    ? systemThemes[dateRotationIndex(options.date, systemThemes.length)]
    : personal[0]?.categoryId;
  if (!themeCategoryId) return { themeCategoryId, phrases: [] };
  return {
    themeCategoryId,
    phrases: selectLearningGroup(phrases, states, {
      date: options.date,
      themeCategoryId,
      target: AUTONOMOUS_LEARNING_GROUP_SIZE,
    }),
  };
}
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `npm test -- tests/domain/learningSelection.test.ts`

Expected: all learning-selection tests PASS; deterministic theme rotation, personal priority, deduplication, and short groups remain covered.

- [ ] **Step 5: Commit the selection boundary**

```bash
git add app/domain/learningSelection.ts tests/domain/learningSelection.test.ts
git commit -m "refactor: define autonomous learning groups"
```

### Task 2: Remove the repository’s fifteenth-phrase hard stop

**Files:**
- Modify: `app/storage/indexedDbRepository.ts`
- Test: `tests/storage/repository.test.ts`

- [ ] **Step 1: Turn the old cap test into an unlimited atomic-write regression**

Replace `enforces the Shanghai-day first-learning hard cap atomically after allowing the fifteenth` with this behavior:

```ts
import { createNewPhrase, isReviewDueOnShanghaiDay } from "../../app/domain/review";

it("atomically accepts a sixteenth first-learning review on the same Shanghai day", async () => {
  const phraseId = "starter-daily-not-sure";
  for (let index = 0; index < 15; index += 1) {
    await repo.savePhraseLearningState({
      phraseId: `counted-${index}`,
      stage: "learned",
      firstTestedAt: "2026-08-10T16:00:30.000Z",
      consecutiveGood: 0,
      masteredDates: [],
      updatedAt: "2026-08-10T16:00:30.000Z",
    });
  }
  const session = learningSession({ id: "sixteenth-session", phraseIds: [phraseId] });
  await beginTestingSession(session);
  const event: TrainingEvent = {
    id: "sixteenth-event",
    sessionId: session.id,
    phraseId,
    source: "new",
    result: "good",
    usedPronunciationHint: false,
    recorded: false,
    activeSeconds: 1,
    occurredAt: "2026-08-10T16:02:00.000Z",
  };

  await repo.submitFirstLearningReview(event, {
    ...session,
    testIndex: 1,
    updatedAt: event.occurredAt,
  });

  expect((await repo.listTrainingEvents()).filter(({ id }) => id === event.id)).toHaveLength(1);
  expect((await repo.exportSnapshot()).reviewLogs.filter(({ phraseId: id }) => id === phraseId)).toHaveLength(1);
  expect(await repo.getPhraseLearningState(phraseId)).toMatchObject({
    stage: "learned",
    firstTestedAt: event.occurredAt,
  });
  expect(await repo.getActiveLearningSession()).toMatchObject({ testIndex: 1 });
});
```

Keep the existing `uses the same next-day failure schedule for the first learning review` test. Extend it with:

```ts
expect(isReviewDueOnShanghaiDay("2026-08-11T08:05:00.000Z", new Date("2026-08-10T15:59:59.999Z"))).toBe(false);
expect(isReviewDueOnShanghaiDay("2026-08-11T08:05:00.000Z", new Date("2026-08-10T16:00:00.000Z"))).toBe(true);
```

- [ ] **Step 2: Run the repository regression and witness RED**

Run: `npm test -- tests/storage/repository.test.ts`

Expected: FAIL with `今日学习新句已达到15句上限` on the sixteenth write.

- [ ] **Step 3: Remove only the quota gate from the atomic transaction**

In `app/storage/indexedDbRepository.ts`:

- remove the `DAILY_NEW_PHRASE_LIMIT` import;
- delete the `stateStore.getAll()` / `testedToday` block inside `submitFirstLearningReview`;
- retain phrase/session/cursor validation, duplicate-event catch-up, `scheduleReview`, learning-state update, example unlock, event write, session write, active-session metadata write, transaction abort handling, and idempotency checks unchanged.

The transaction should proceed directly from loading `currentState` to scheduling and persisting:

```ts
const currentState = await stateStore.get(phrase.id);
const scheduled = scheduleReview(phrase, event.result, reviewTime);
await phraseStore.put(scheduled.phrase);
await tx.objectStore("reviewLogs").put(scheduled.log);
const nextState = reviewedState(currentState, phrase.id, event.result, reviewTime);
await stateStore.put(nextState);
```

- [ ] **Step 4: Run repository tests and verify GREEN**

Run: `npm test -- tests/storage/repository.test.ts`

Expected: all repository tests PASS, including duplicate-event idempotency, rollback, cloud-compatible snapshot export, and next-Shanghai-day review availability.

- [ ] **Step 5: Commit the storage change**

```bash
git add app/storage/indexedDbRepository.ts tests/storage/repository.test.ts
git commit -m "fix: allow unlimited autonomous learning"
```

### Task 3: Remove daily quota logic from the learning hook

**Files:**
- Modify: `app/hooks/useNewPhraseLearning.ts`
- Modify: `app/components/screens/LearningScreen.tsx`
- Test: `tests/hooks/useNewPhraseLearning.test.tsx`

- [ ] **Step 1: Replace quota tests with autonomous-group tests**

Delete tests that assert `13 -> 2`, `15 -> empty`, Shanghai-day quota counting, and configured `dailyLimit` normalization. Add:

```ts
it("creates a full autonomous group after fifteen other phrases were first-tested today", async () => {
  const items = Array.from({ length: 7 }, (_, index) => phrase(`new-${index}`));
  const store = memoryRepository({
    phrases: items,
    states: [
      ...Array.from({ length: 15 }, (_, index) => tested(`learned-${index}`, timestamp)),
      ...items.map((item) => unseen(item.id)),
    ],
  });

  const hook = renderLearning(store);

  await waitFor(() => expect(hook.result.current.phase).toBe("study"));
  expect(hook.result.current.total).toBe(5);
  expect(store.sessions[0].phraseIds).toHaveLength(5);
});

it("restores an active autonomous group without consulting today’s completed count", async () => {
  const items = [phrase("a"), phrase("b")];
  const active: LearningSessionRecord = {
    id: "active",
    date: "2026-08-10",
    themeCategoryId: "daily",
    phraseIds: items.map(({ id }) => id),
    studyIndex: 1,
    testIndex: 0,
    phase: "study",
    startedAt: timestamp,
    updatedAt: timestamp,
  };
  const store = memoryRepository({
    phrases: items,
    states: [
      ...Array.from({ length: 20 }, (_, index) => tested(`learned-${index}`, timestamp)),
      ...items.map((item) => unseen(item.id)),
    ],
    active,
  });

  const hook = renderLearning(store);

  await waitFor(() => expect(hook.result.current.current?.id).toBe("b"));
  expect(hook.result.current).toMatchObject({ phase: "study", studyIndex: 1, total: 2 });
  expect(store.repository.saveLearningSession).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the hook test and witness RED**

Run: `npm test -- tests/hooks/useNewPhraseLearning.test.tsx`

Expected: the first test reaches `empty` because the current hook computes zero daily slots.

- [ ] **Step 3: Simplify the hook to create one fixed group**

In `app/hooks/useNewPhraseLearning.ts`:

- import only `previewLearningGroup` from `learningSelection`;
- remove `dailyLimit` from `UseNewPhraseLearningOptions`;
- delete `DEFAULT_DAILY_LIMIT` and `normalizeDailyLimit`;
- remove `dailyLimit` destructuring and `normalizedDailyLimit`;
- delete the `testedToday` and `remaining` calculation;
- call `previewLearningGroup(phrases, states, categoryIds, { date })` directly.

The new-session branch should read:

```ts
const started = readNow();
const date = shanghaiDate(started);
const preview = previewLearningGroup(
  phrases,
  states,
  categories.map((item) => item.id),
  { date },
);
const { themeCategoryId } = preview;
if (!themeCategoryId || preview.phrases.length === 0) {
  replacePhase("empty");
  setOperation(false);
  return;
}
const selected = preview.phrases;
```

In `app/components/screens/LearningScreen.tsx`, remove the quota import and call:

```ts
const controller = useNewPhraseLearning({ repository, speech });
```

- [ ] **Step 4: Run hook and repository suites and verify GREEN**

Run: `npm test -- tests/hooks/useNewPhraseLearning.test.tsx tests/storage/repository.test.ts`

Expected: both suites PASS; retry, generation isolation, atomic review, completion, and resume tests remain green.

- [ ] **Step 5: Commit the hook boundary**

```bash
git add app/hooks/useNewPhraseLearning.ts app/components/screens/LearningScreen.tsx tests/hooks/useNewPhraseLearning.test.tsx
git commit -m "feat: make new phrase learning autonomous"
```

### Task 4: Offer another group from the completed learning screen

**Files:**
- Modify: `app/components/NewPhraseLearning.tsx`
- Test: `tests/components/newPhraseLearning.test.tsx`
- Test: `tests/hooks/useNewPhraseLearning.test.tsx`

- [ ] **Step 1: Write component and integrated continuation tests**

Add a component test:

```ts
it("starts another autonomous group from the complete state", async () => {
  const user = userEvent.setup();
  const value = controller({ phase: "complete", current: undefined, total: 5 });
  render(<NewPhraseLearning controller={value} onHome={vi.fn()} />);

  expect(screen.getByRole("heading", { name: "本组学习完成" })).toBeVisible();
  await user.click(screen.getByRole("button", { name: "再学 5 句" }));

  expect(value.retry).toHaveBeenCalledOnce();
});
```

Extend the terminal busy test so both complete-state buttons are disabled. Add a hook test proving the initializer behind that button creates the next group after completion:

```ts
it("initializes the next autonomous group after a completed group", async () => {
  const items = [phrase("first")];
  const store = memoryRepository({ phrases: items, states: [unseen("first")] });
  const hook = renderLearning(store);

  await waitFor(() => expect(hook.result.current.phase).toBe("study"));
  await act(() => hook.result.current.nextStudyPhrase());
  await act(() => hook.result.current.reveal());
  await act(() => hook.result.current.grade("good"));
  expect(hook.result.current.phase).toBe("complete");

  items.push(phrase("second"));
  store.states.push(unseen("second"));
  act(() => hook.result.current.retry());

  await waitFor(() => expect(hook.result.current.current?.id).toBe("second"));
  expect(hook.result.current).toMatchObject({ phase: "study", studyIndex: 0, total: 1 });
});
```

- [ ] **Step 2: Run the component tests and witness RED**

Run: `npm test -- tests/components/newPhraseLearning.test.tsx tests/hooks/useNewPhraseLearning.test.tsx`

Expected: FAIL because the complete state has only “返回首页”, and screen copy still says “新句学习”.

- [ ] **Step 3: Add autonomous copy and the next-group action**

In `app/components/NewPhraseLearning.tsx`:

- change the mode pills to `自主学习 · 先学后测` and `自主学习 · 小测`;
- change loading copy to `正在准备自主学习内容`;
- change empty heading/body to `暂无新句` and `可以去句库添加新的表达，再回来继续学习。`;
- keep the close action, bilingual study phase, Chinese-only test prompt, speech, grades, status handling, and mounted/pending guards unchanged;
- render two complete actions:

```tsx
<div className="new-learning-state-actions">
  <button type="button" disabled={disabled} onClick={exit}>返回首页</button>
  <button
    type="button"
    className="primary"
    disabled={disabled}
    onClick={() => { void run(controller.retry); }}
  >
    再学 5 句
  </button>
</div>
```

The same `run()` lock must prevent a double click from creating concurrent sessions.

- [ ] **Step 4: Run component and hook tests and verify GREEN**

Run: `npm test -- tests/components/newPhraseLearning.test.tsx tests/hooks/useNewPhraseLearning.test.tsx`

Expected: both suites PASS, including terminal action rejection, pending disablement, unmount guards, and the persisted next-group transition.

- [ ] **Step 5: Commit the learning-screen behavior**

```bash
git add app/components/NewPhraseLearning.tsx tests/components/newPhraseLearning.test.tsx tests/hooks/useNewPhraseLearning.test.tsx
git commit -m "feat: continue autonomous learning groups"
```

### Task 5: Replace the home page with two independent entries

**Files:**
- Modify: `app/components/TrainingHome.tsx`
- Modify: `app/PhraseBankApp.tsx`
- Modify: `app/components/screens/AddPhraseScreen.tsx`
- Modify: `app/globals.css`
- Test: `tests/components/trainingHome.test.tsx`
- Test: `tests/components/app.test.tsx`
- Test: `tests/components/mobileStyles.test.ts`

- [ ] **Step 1: Write the two-entry and routing regressions**

Update `tests/components/trainingHome.test.tsx` so it asserts:

```ts
const daily = screen.getByRole("button", { name: /继续今日任务/ });
const autonomous = screen.getByRole("button", { name: /自主学习/ });
expect(screen.queryByRole("button", { name: /到期复习/ })).not.toBeInTheDocument();

expect(daily).toBeDisabled();
expect(daily).toHaveTextContent("今日复习已完成");
expect(autonomous).toHaveTextContent("暂无新句，可去句库添加");

rerender(<TrainingHome {...base} dueCount={4} nextLearningCount={5} />);
expect(screen.getByRole("button", { name: /继续今日任务/ })).toHaveTextContent("今天到期 4 句");
expect(screen.getByRole("button", { name: /自主学习/ })).toHaveTextContent("开始学习 5 句");

rerender(<TrainingHome {...base} activeReview reviewRemaining={2} activeLearning activeRemaining={3} nextLearningCount={5} />);
expect(screen.getByRole("button", { name: /继续今日任务/ })).toHaveTextContent("继续未完成 · 剩余 2 句");
expect(screen.getByRole("button", { name: /自主学习/ })).toHaveTextContent("继续上次 · 剩余 3 句");
```

Add app-level tests proving:

1. an active learning session with no due review leaves “继续今日任务” disabled and is resumed only through “自主学习”;
2. due phrases open through “继续今日任务”;
3. the old “到期复习” button is absent;
4. no unseen phrases disables “自主学习” while an active learning session keeps it enabled;
5. completing more than 15 first-learning events still leaves the next autonomous group available.

Use the existing `MemoryRepository`, `makePhrase`, and `learnedState` fixtures with these concrete assertions:

```ts
it("keeps active autonomous learning separate from an empty daily review", async () => {
  const user = userEvent.setup();
  const repo = new MemoryRepository();
  const now = new Date().toISOString();
  repo.phrases = [makePhrase({ id: "active-a" }), makePhrase({ id: "active-b" })];
  repo.learningSessions = [{
    id: "active-learning",
    date: "2026-08-10",
    themeCategoryId: "daily",
    phraseIds: ["active-a", "active-b"],
    studyIndex: 1,
    testIndex: 0,
    phase: "study",
    startedAt: now,
    updatedAt: now,
  }];
  render(<PhraseBankApp repository={repo as never} />);

  expect(await screen.findByRole("button", { name: /继续今日任务/ })).toBeDisabled();
  expect(screen.getByRole("button", { name: /继续今日任务/ })).toHaveTextContent("今日复习已完成");
  const autonomous = screen.getByRole("button", { name: /自主学习/ });
  expect(autonomous).toHaveTextContent("继续上次 · 剩余 1 句");
  await user.click(autonomous);
  expect(await screen.findByText(repo.phrases[1].english)).toBeVisible();
});

it("opens due review only from the daily task entry", async () => {
  const user = userEvent.setup();
  const repo = new MemoryRepository();
  repo.phrases = [makePhrase({ id: "due", nextReviewAt: new Date(0).toISOString() })];
  repo.learningStates = [learnedState("due")];
  render(<PhraseBankApp repository={repo as never} />);

  const daily = await screen.findByRole("button", { name: /继续今日任务/ });
  expect(daily).toHaveTextContent("今天到期 1 句");
  expect(screen.queryByRole("button", { name: /到期复习/ })).not.toBeInTheDocument();
  await user.click(daily);
  expect(await screen.findByText(repo.phrases[0].chinese)).toBeVisible();
});

it("keeps autonomous learning available after more than fifteen phrases today", async () => {
  const repo = new MemoryRepository();
  const now = new Date().toISOString();
  repo.phrases = Array.from({ length: 5 }, (_, index) => makePhrase({ id: `new-${index}` }));
  repo.learningStates = [
    ...Array.from({ length: 16 }, (_, index) => ({
      ...learnedState(`done-${index}`),
      firstTestedAt: now,
    })),
  ];
  render(<PhraseBankApp repository={repo as never} />);

  const autonomous = await screen.findByRole("button", { name: /自主学习/ });
  expect(autonomous).toBeEnabled();
  expect(autonomous).toHaveTextContent("开始学习 5 句");
});

it("disables autonomous learning when no unseen content remains", async () => {
  const repo = new MemoryRepository();
  repo.phrases = [makePhrase({ id: "already-learned" })];
  repo.learningStates = [learnedState("already-learned")];
  render(<PhraseBankApp repository={repo as never} />);

  const autonomous = await screen.findByRole("button", { name: /自主学习/ });
  expect(autonomous).toBeDisabled();
  expect(autonomous).toHaveTextContent("暂无新句，可去句库添加");
});
```

Update the mobile CSS contract to name two entries and require both buttons to stay full-width at 390px:

```ts
it("stacks both home entries cleanly on the iPhone width", async () => {
  const css = await readFile("app/globals.css", "utf8");
  expect(css).toMatch(/\.training-entry\s*\{[^}]*grid-template-columns:\s*1fr/);
  expect(css).toMatch(/\.training-entry button\s*\{[^}]*width:\s*100%[^}]*min-width:\s*0[^}]*overflow-wrap:\s*anywhere/s);
  expect(css).toMatch(/\.continue-start\s*\{[^}]*background:\s*#267453/s);
  expect(css).toMatch(/\.learning-start\s*\{[^}]*min-height:\s*88px/s);
  expect(css).not.toMatch(/\.standard-start\s*\{/);
});
```

- [ ] **Step 2: Run home/app/mobile tests and witness RED**

Run: `npm test -- tests/components/trainingHome.test.tsx tests/components/app.test.tsx tests/components/mobileStyles.test.ts`

Expected: failures for the third button, old routing priority, daily `/ 15` copy, and missing disabled states.

- [ ] **Step 3: Implement independent home routing and two-entry markup**

In `app/PhraseBankApp.tsx`:

- remove `DAILY_NEW_PHRASE_LIMIT` from imports;
- call `previewLearningGroup(phrases, learningStates, categories.map((category) => category.id), { date: today })`;
- remove active-learning handling and the learning fallback from `continueToday`;
- make `continueToday` start standard review only when `activeTrainingSession || eligibleDue.length > 0`;
- continue passing active-learning details only to the autonomous entry;
- remove `onStartStandard` from `TrainingHome`;
- change the lazy-screen label for `learn` to `自主学习`.

Use this routing shape:

```ts
const continueToday = () => {
  if (activeTrainingSession || eligibleDue.length > 0) startTraining("standard");
};
```

In `app/components/TrainingHome.tsx`:

- remove the `onStartStandard` prop and the `.standard-start` button;
- set `disabled={!activeReview && dueCount === 0}` on daily review;
- use `AppIcon name="dueReview"` in daily review;
- set `disabled={!activeLearning && nextLearningCount === 0}` on autonomous learning;
- render exact state priority shown in the RED test;
- replace the introductory sentence with `先完成今天到期的复习；想多学时，再开启自主学习。`;
- retain daily outcome, weekly summary, and heatmap sections unchanged.

Use this markup shape:

```tsx
<div className="training-entry">
  <button
    className="continue-start"
    onClick={onContinue}
    disabled={!activeReview && dueCount === 0}
  >
    <span>
      <AppIcon name="dueReview" data-icon="due-review" size={24} />
      <b>继续今日任务</b>
      <small>{activeReview
        ? `继续未完成 · 剩余 ${reviewRemaining ?? 0} 句`
        : dueCount > 0 ? `今天到期 ${dueCount} 句` : "今日复习已完成"}</small>
    </span>
    <AppIcon name="forward" size={22} />
  </button>
  <button
    className="learning-start"
    onClick={onStartLearning}
    disabled={!activeLearning && nextLearningCount === 0}
  >
    <span>
      <AppIcon name="library" size={24} />
      <b>自主学习</b>
      <small>{activeLearning
        ? `继续上次 · 剩余 ${activeRemaining ?? nextLearningCount} 句`
        : nextLearningCount > 0
          ? `开始学习 ${nextLearningCount} 句${themeName ? ` · ${themeName}` : ""}`
          : "暂无新句，可去句库添加"}</small>
    </span>
    <AppIcon name="forward" size={22} />
  </button>
</div>
```

In `app/components/screens/AddPhraseScreen.tsx`, replace the checkbox copy with `先在“自主学习”里认识这句话`.

In `app/globals.css`:

- remove `.standard-start` from home-entry selector lists;
- apply review green `#267453` to `.continue-start`;
- retain full-width, `min-width: 0`, `overflow-wrap: anywhere`, 88px minimum height, safe area, and reduced-motion rules;
- retain `.standard-start` only if another live component still uses it; verify with `rg -n 'standard-start' app` before deleting dead CSS.

- [ ] **Step 4: Run the integrated focused suite and verify GREEN**

Run:

```bash
npm test -- tests/domain/learningSelection.test.ts tests/hooks/useNewPhraseLearning.test.tsx tests/storage/repository.test.ts tests/storage/cloudRepository.test.ts tests/components/newPhraseLearning.test.tsx tests/components/trainingHome.test.tsx tests/components/app.test.tsx tests/components/mobileStyles.test.ts
```

Expected: all focused tests PASS; home exposes exactly two entries, session ownership is independent, groups remain five, sixteenth learning succeeds, failed cloud upload retry remains idempotent, and mobile contracts remain green.

- [ ] **Step 5: Commit the home experience**

```bash
git add app/PhraseBankApp.tsx app/components/TrainingHome.tsx app/components/screens/AddPhraseScreen.tsx app/globals.css tests/components/trainingHome.test.tsx tests/components/app.test.tsx tests/components/mobileStyles.test.ts
git commit -m "feat: separate daily review from autonomous learning"
```

### Task 6: Verify integration, performance evidence, and release readiness

**Files:**
- Modify when generated values change: `docs/audits/home-heatmap-performance/metrics.json`
- Modify when generated values change: `docs/audits/home-heatmap-performance/README.md`

- [ ] **Step 1: Run scoped static checks**

Run:

```bash
npx eslint app/domain/learningSelection.ts app/hooks/useNewPhraseLearning.ts app/storage/indexedDbRepository.ts app/components/NewPhraseLearning.tsx app/components/screens/LearningScreen.tsx app/components/TrainingHome.tsx app/PhraseBankApp.tsx app/components/screens/AddPhraseScreen.tsx tests/domain/learningSelection.test.ts tests/hooks/useNewPhraseLearning.test.tsx tests/storage/repository.test.ts tests/components/newPhraseLearning.test.tsx tests/components/trainingHome.test.tsx tests/components/app.test.tsx tests/components/mobileStyles.test.ts
git diff --check
```

Expected: both commands exit 0.

- [ ] **Step 2: Run the canonical performance benchmark safely**

Preflight:

```powershell
git status --short
Get-ChildItem -LiteralPath C:\Temp -Force -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -like 'phb-*' }
```

The app tree must be clean and the residue listing must be empty before the run. Then run:

```bash
npm run benchmark:home-before-after
```

Expected: exit 0, `verifiedResidueCount` is 0, `worktreeRegistrationCreated` is false, and current home/initial-JS bytes remain below their stored budgets. If cleanup reports a locked directory, stop immediately; do not retry with a stronger deletion command.

- [ ] **Step 3: Synchronize the audit README with generated metrics**

Read the generated values:

```powershell
$metrics = Get-Content -Raw docs/audits/home-heatmap-performance/metrics.json | ConvertFrom-Json
$metrics.beforeAfter.current
$metrics.build
$metrics.homeDataBenchmark
git rev-parse HEAD:app
```

Update `docs/audits/home-heatmap-performance/README.md` so its stable app source tree and current home chunk, initial JavaScript, HTML/RSC, and percentage changes exactly match `metrics.json`. Do not change the recorded browser/device limitations or claim a new public deployment.

- [ ] **Step 4: Run final gates with fresh evidence**

Run in order:

```bash
npm run test:home-performance
npm test
npm run lint
npm run build
git diff --check
git status --short
```

Expected:

- performance build and budget tests PASS;
- the full Vitest suite has zero failures (document intentional skips);
- lint exits 0;
- production build exits 0 and contains only the expected app/API routes;
- diff check exits 0;
- status contains only the two expected generated audit files before their evidence commit.

- [ ] **Step 5: Commit generated evidence and recheck cleanliness**

```bash
git add docs/audits/home-heatmap-performance/metrics.json docs/audits/home-heatmap-performance/README.md
git commit -m "test: refresh autonomous learning evidence"
git diff --check HEAD^
git status --short
```

Expected: the evidence commit contains only those two audit files, `git diff --check` exits 0, and the feature worktree is clean.

After the evidence commit, rerun the focused eight-file suite from Task 5 so the final HEAD has fresh behavioral verification.
