# Daily Correct Goal and Calendar Due Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the home goal count distinct correct phrases today while making review eligibility use Shanghai calendar days consistently.

**Architecture:** Keep training events and the existing `dailyMasteryGoal` preference as the durable data sources, but expose the preference as a daily-correct target in the UI. Add shared Shanghai-day review helpers in the review domain and use them both for the IndexedDB due query and the training selector so counts and queues cannot diverge.

**Tech Stack:** TypeScript, React 19, IndexedDB/idb, Vitest, Testing Library, vinext.

---

### Task 1: Count Today’s Distinct Correct Phrases

**Files:**
- Modify: `app/domain/trainingStats.ts`
- Modify: `tests/domain/trainingStats.test.ts`
- Modify: `tests/services/homeData.test.ts`

- [ ] **Step 1: Write the failing daily-summary tests**

Update the sentence-progress fixture so it contains duplicate `good` events for one phrase, a `good` new event, a `good` review event, and `hard/again` events. Require the public result to use this shape:

```ts
expect(result).toEqual({
  correct: 5,
  mastered: 1,
  reviewed: 5,
});

expect(summarizeDailySentenceProgress("invalid", [], [])).toEqual({
  correct: 0,
  mastered: 0,
  reviewed: 0,
});
```

Also change the service fixture expectation to:

```ts
dailyProgress: { correct: 0, mastered: 0, reviewed: 0 },
```

- [ ] **Step 2: Run the tests and verify RED**

Run:

```powershell
npm test -- tests/domain/trainingStats.test.ts tests/services/homeData.test.ts
```

Expected: FAIL because `summarizeDailySentenceProgress` still returns `consolidated` and has no `correct` field.

- [ ] **Step 3: Implement the minimal summary change**

Change the summary to count distinct good phrase IDs without consulting mastery stage:

```ts
const goodTodayIds = new Set(
  dailyEvents
    .filter((event) => event.result === "good")
    .map((event) => event.phraseId),
);

return {
  correct: goodTodayIds.size,
  mastered: masteredIds.size,
  reviewed: new Set(
    dailyEvents
      .filter((event) => event.source !== "new")
      .map((event) => event.phraseId),
  ).size,
};
```

Keep `firstMasteryAchievedDate(state) === date` as the definition of `mastered`.

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run the Step 2 command. Expected: both files pass.

- [ ] **Step 5: Commit Task 1**

```powershell
git add app/domain/trainingStats.ts tests/domain/trainingStats.test.ts tests/services/homeData.test.ts
git commit -m "fix: count distinct correct phrases today"
```

### Task 2: Use Shanghai Calendar Days for Review Eligibility

**Files:**
- Modify: `app/domain/review.ts`
- Modify: `app/domain/trainingSelection.ts`
- Modify: `app/storage/indexedDbRepository.ts`
- Modify: `tests/domain/review.test.ts`
- Modify: `tests/domain/trainingSelection.test.ts`
- Modify: `tests/storage/repository.test.ts`

- [ ] **Step 1: Write failing Shanghai-day domain tests**

Add tests requiring a review scheduled for any time on today’s Shanghai date to be due, while tomorrow and malformed values are not due:

```ts
expect(isReviewDueOnShanghaiDay(
  "2026-08-14T12:00:00.000Z",
  new Date("2026-08-14T02:00:00.000Z"),
)).toBe(true);
expect(isReviewDueOnShanghaiDay(
  "2026-08-14T16:00:00.000Z",
  new Date("2026-08-14T15:59:59.999Z"),
)).toBe(false);
expect(isReviewDueOnShanghaiDay("invalid", new Date("2026-08-14T02:00:00.000Z"))).toBe(false);
expect(shanghaiDayEndIso(new Date("2026-08-14T02:00:00.000Z")))
  .toBe("2026-08-14T15:59:59.999Z");
```

Add a standard-training selection test where `nextReviewAt` is later on the same Shanghai day; require it to be selected with source `due`.

- [ ] **Step 2: Write the failing repository boundary test**

Persist three phrases with `nextReviewAt` values later today, tomorrow, and malformed. Call `listDuePhrases` early today and require only the later-today phrase:

```ts
expect((await repo.listDuePhrases(new Date("2026-08-14T02:00:00.000Z")))
  .map(({ id }) => id)).toEqual(["later-today"]);
```

- [ ] **Step 3: Run the tests and verify RED**

Run:

```powershell
npm test -- tests/domain/review.test.ts tests/domain/trainingSelection.test.ts tests/storage/repository.test.ts
```

Expected: FAIL because the shared day helpers do not exist, the selector compares exact milliseconds, and the repository query stops at the current instant.

- [ ] **Step 4: Add shared date helpers**

In `app/domain/review.ts`, add a single Shanghai calendar formatter and these exports:

```ts
const shanghaiDay = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function isReviewDueOnShanghaiDay(nextReviewAt: string, now: Date): boolean {
  const due = new Date(nextReviewAt);
  if (Number.isNaN(due.getTime()) || Number.isNaN(now.getTime())) return false;
  return shanghaiDay.format(due) <= shanghaiDay.format(now);
}

export function shanghaiDayEndIso(now: Date): string {
  if (Number.isNaN(now.getTime())) throw new Error("复习日期无效");
  const [year, month, day] = shanghaiDay.format(now).split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 15, 59, 59, 999)).toISOString();
}
```

- [ ] **Step 5: Use the helpers in both data paths**

In `trainingSelection.ts`, pass the actual `Date` into `sourceFor` and classify due phrases with `isReviewDueOnShanghaiDay`.

In `indexedDbRepository.ts`, retain the `by-due` index and bounded query but use the day-end cutoff, then defensively filter malformed values:

```ts
const items = await (await this.db()).getAllFromIndex(
  "phrases",
  "by-due",
  IDBKeyRange.upperBound(shanghaiDayEndIso(now)),
);
return items
  .filter((phrase) => isReviewDueOnShanghaiDay(phrase.nextReviewAt, now))
  .sort((left, right) => left.nextReviewAt.localeCompare(right.nextReviewAt));
```

- [ ] **Step 6: Run the focused tests and verify GREEN**

Run the Step 3 command. Expected: all three files pass.

- [ ] **Step 7: Commit Task 2**

```powershell
git add app/domain/review.ts app/domain/trainingSelection.ts app/storage/indexedDbRepository.ts tests/domain/review.test.ts tests/domain/trainingSelection.test.ts tests/storage/repository.test.ts
git commit -m "fix: open reviews by Shanghai calendar day"
```

### Task 3: Present the Correct Goal and Preserve Integrated Behavior

**Files:**
- Modify: `app/PhraseBankApp.tsx`
- Modify: `app/components/TrainingHome.tsx`
- Modify: `app/components/screens/SettingsScreen.tsx`
- Modify: `tests/components/trainingHome.test.tsx`
- Modify: `tests/components/app.test.tsx`

- [ ] **Step 1: Write failing component tests**

Change `TrainingHome` fixtures to `{ correct, mastered, reviewed }`. Require:

```ts
expect(screen.getByText("今日答对")).toBeVisible();
expect(screen.getByRole("progressbar", { name: "今日答对进度" }))
  .toHaveAttribute("aria-valuenow", "10");
expect(screen.getByText("14 / 10 句")).toBeVisible();
expect(screen.getByText("三日掌握").parentElement).toHaveTextContent("3 句");
expect(screen.queryByText("今日巩固")).not.toBeInTheDocument();
```

Update settings integration tests to find `每日答对目标` and to expect matching validation, success, and failure messages.

- [ ] **Step 2: Add a due-count/queue integration regression**

In the app test repository, make one learned phrase scheduled later on the current Shanghai day. Require the home entry to show `1 句到期`, click it, and assert the review screen displays that phrase rather than an empty completion screen.

- [ ] **Step 3: Run the tests and verify RED**

Run:

```powershell
npm test -- tests/components/trainingHome.test.tsx tests/components/app.test.tsx
```

Expected: FAIL on the old `今日掌握`/`今日巩固` copy, old settings copy, and exact-time integration behavior.

- [ ] **Step 4: Implement the minimal UI changes**

Use `dailyProgress.correct` for the progress value, percentage, remaining count, heading state, and ARIA values. Render `dailyProgress.mastered` as the secondary result:

```tsx
<span>今日答对</span>
<strong>{dailyProgress.correct} / {dailyMasteryGoal} 句</strong>
...
<p className="daily-consolidated">
  <span>三日掌握</span>
  <strong>{dailyProgress.mastered} 句</strong>
</p>
```

Change the Settings screen’s visible strings to `每日答对目标`, `每日答对目标必须是正整数`, `每日答对目标已保存`, and `每日答对目标保存失败，已恢复上次设置`. Keep the persisted `dailyMasteryGoal` property and its backup/storage validation unchanged.

Update the fallback in `PhraseBankApp` to:

```ts
{ correct: 0, mastered: 0, reviewed: 0 }
```

- [ ] **Step 5: Run the focused tests and verify GREEN**

Run the Step 3 command. Expected: both files pass.

- [ ] **Step 6: Commit Task 3**

```powershell
git add app/PhraseBankApp.tsx app/components/TrainingHome.tsx app/components/screens/SettingsScreen.tsx tests/components/trainingHome.test.tsx tests/components/app.test.tsx
git commit -m "fix: clarify daily correct progress"
```

### Task 4: Refresh Evidence and Verify the Complete Change

**Files:**
- Modify: `docs/audits/home-heatmap-performance/metrics.json`
- Modify if generated numbers change: `docs/audits/home-heatmap-performance/README.md`

- [ ] **Step 1: Run all focused suites together**

```powershell
npm test -- tests/domain/trainingStats.test.ts tests/services/homeData.test.ts tests/domain/review.test.ts tests/domain/trainingSelection.test.ts tests/storage/repository.test.ts tests/components/trainingHome.test.tsx tests/components/app.test.tsx
```

Expected: all focused tests pass.

- [ ] **Step 2: Run lint**

```powershell
npm run lint
```

Expected: exit code 0.

- [ ] **Step 3: Refresh reproducible performance evidence**

```powershell
npm run benchmark:home-before-after
```

Expected: `verifiedResidueCount` is `0`, no worktree registration remains, and the recorded application source tree equals `git rev-parse HEAD:app`.

If the current byte counts differ from the README table, update only those exact values and percentages.

- [ ] **Step 4: Run production and full verification**

```powershell
npm run test:home-performance
npm test
npm run build
git diff --check
git status --short
```

Expected: performance tests, full tests, and build pass; diff check is clean; status contains only intentional evidence changes.

- [ ] **Step 5: Commit refreshed evidence**

```powershell
git add docs/audits/home-heatmap-performance/metrics.json docs/audits/home-heatmap-performance/README.md
git commit -m "test: refresh daily progress evidence"
```

- [ ] **Step 6: Confirm branch state**

```powershell
git status --short --branch
git log -5 --oneline
```

Expected: clean `fix/daily-correct-calendar-due` worktree with the design, implementation, and evidence commits.
