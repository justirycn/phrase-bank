# Three-Day Mastery and Relearning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Require correct recall on three distinct Shanghai calendar days for mastery, requeue failed due reviews within the resumable session, preserve spaced scheduling, and replace time-heavy home metrics with retention outcomes.

**Architecture:** Keep `PhraseLearningState` as the single learning-state source and derive mastery from distinct effective `masteredDates`. Add an optional reset timestamp for post-failure relearning, keep scheduling in the existing atomic repository transactions, and persist dynamic requeue entries in the existing training-session queue. Derive home outcome metrics from persisted states/events so cloud synchronization and refreshes remain authoritative.

**Tech Stack:** TypeScript, React, Vitest/Testing Library, IndexedDB via `idb`, vinext, existing cloud snapshot synchronization.

---

### Task 1: Three-distinct-day mastery domain

**Files:**
- Modify: `app/domain/types.ts`
- Modify: `app/domain/learningProgress.ts`
- Modify: `tests/domain/learningProgress.test.ts`
- Modify: `tests/domain/trainingTypes.test.ts`

- [ ] **Step 1: Write failing mastery-transition tests**

Add tests that exercise the real state transition API:

```ts
const first = applyLearningResult(state(), "good", new Date("2026-08-10T02:00:00Z"));
const sameDay = applyLearningResult(first, "good", new Date("2026-08-10T12:00:00Z"));
const second = applyLearningResult(sameDay, "good", new Date("2026-08-11T02:00:00Z"));
const third = applyLearningResult(second, "good", new Date("2026-08-12T02:00:00Z"));
expect(sameDay.masteredDates).toEqual(["2026-08-10"]);
expect(second.stage).toBe("learned");
expect(third.stage).toBe("mastered");
expect(masteryAchievedDate(third)).toBe("2026-08-12");
```

Also prove a Shanghai 15:59/16:00 UTC boundary creates two days, invalid legacy dates are ignored, and `again`/`hard` set `stage: "learned"`, reset consecutive progress, and prevent old dates from immediately remastering the phrase.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm test -- tests/domain/learningProgress.test.ts tests/domain/trainingTypes.test.ts`

Expected: FAIL because `masteryResetAt`, `effectiveMasteryDates`, and `masteryAchievedDate` do not exist and `applyLearningResult` does not set stages/reset progress.

- [ ] **Step 3: Implement the minimal state model**

Extend the state type:

```ts
export interface PhraseLearningState {
  // existing fields
  masteryResetAt?: string;
}
```

In `learningProgress.ts`, add exported helpers that normalize valid `YYYY-MM-DD` values, filter dates strictly after the Shanghai date of `masteryResetAt`, and return the third effective date. Update `applyLearningResult` so:

```ts
if (result !== "good") {
  return { ...state, stage: "learned", consecutiveGood: 0,
    masteryResetAt: now.toISOString(), updatedAt: now.toISOString() };
}
const masteredDates = uniqueSortedDatesIncludingToday(...);
const effective = effectiveMasteryDates({ ...state, masteredDates });
return { ...state, masteredDates, stage: effective.length >= 3 ? "mastered" : "learned",
  consecutiveGood: effective.length, updatedAt: now.toISOString() };
```

Keep `nextExampleToUnlock` aligned with true mastery by requiring a `masteryAchievedDate` rather than two raw dates.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `npm test -- tests/domain/learningProgress.test.ts tests/domain/trainingTypes.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/domain/types.ts app/domain/learningProgress.ts tests/domain/learningProgress.test.ts tests/domain/trainingTypes.test.ts
git commit -m "feat: require three recall days for mastery"
```

### Task 2: Forgetting-curve scheduling and atomic persistence

**Files:**
- Modify: `app/domain/review.ts`
- Modify: `app/storage/indexedDbRepository.ts`
- Modify: `app/storage/backup.ts`
- Modify: `tests/domain/review.test.ts`
- Modify: `tests/storage/repository.test.ts`
- Modify: `tests/storage/backup.test.ts`

- [ ] **Step 1: Write failing scheduling and repository tests**

Cover exact intervals and state transitions:

```ts
expect(daysUntil(scheduleReview(phraseAtStep(0), "again", now))).toBe(1);
expect(daysUntil(scheduleReview(phraseAtStep(4), "hard", now))).toBe(1);
expect(daysUntil(scheduleReview(phraseAtStep(0), "good", now))).toBe(1);
expect(daysUntil(scheduleReview(phraseAtStep(1), "good", now))).toBe(3);
```

Using fake IndexedDB, submit good reviews on three different Shanghai days and assert the state advances `learned`, `learned`, `mastered`; repeat within one day and assert no duplicate date. Then submit `again` to a mastered phrase and prove stage downgrade, reset timestamp, next-day due date, and atomic rollback on a forced write error.

Add backup parsing tests accepting a valid optional `masteryResetAt`, rejecting an invalid timestamp, and preserving old snapshots without that field.

- [ ] **Step 2: Run tests and verify RED**

Run: `npm test -- tests/domain/review.test.ts tests/storage/repository.test.ts tests/storage/backup.test.ts`

Expected: FAIL on hard interval, stage transition, reset persistence, and backup validation.

- [ ] **Step 3: Implement scheduling and persistence**

Change `hard` scheduling to one day without advancing `reviewStep`. Make `reviewedState` use `applyLearningResult` as the authority for `stage` and `consecutiveGood`; remove the `phrase.masteryLevel === 3` shortcut. Preserve first-seen/tested/result metadata around the transitioned state.

Validate and pass through `masteryResetAt` in backup parsing/migration. Do not bump the backup version because the field is optional. Keep phrase, review log, learning state, event, and session updates inside their current transactions.

- [ ] **Step 4: Run tests and verify GREEN**

Run: `npm test -- tests/domain/review.test.ts tests/storage/repository.test.ts tests/storage/backup.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/domain/review.ts app/storage/indexedDbRepository.ts app/storage/backup.ts tests/domain/review.test.ts tests/storage/repository.test.ts tests/storage/backup.test.ts
git commit -m "feat: persist spaced three-day mastery"
```

### Task 3: Bounded in-session relearning with pause/resume

**Files:**
- Modify: `app/hooks/useTrainingSession.ts`
- Modify: `tests/hooks/useTrainingSession.test.tsx`
- Modify: `tests/components/speakingPractice.test.tsx`

- [ ] **Step 1: Write failing dynamic-queue tests**

Create a five-phrase due session and assert that grading phrase 1 as `again` inserts a `requeue` occurrence after two intervening phrases. Assert normal reveal followed by the `不会` grade and “不会，直接看答案” both use the same rule.

Add tests that:

```ts
expect(saved.phraseIds).toEqual(["p1", "p2", "p3", "p1", "p4", "p5"]);
expect(saved.sources).toEqual(["due", "due", "due", "requeue", "due", "due"]);
```

Then fail the same phrase repeatedly and prove no more than three requeue occurrences are added. Unmount after the first requeue, remount the hook, and assert the restored queue/index/total match persisted state exactly. Reject the repository event write and prove no queue or index mutation occurs.

- [ ] **Step 2: Run tests and verify RED**

Run: `npm test -- tests/hooks/useTrainingSession.test.tsx tests/components/speakingPractice.test.tsx`

Expected: FAIL because current code appends only one requeue at the end and the grade path does not requeue.

- [ ] **Step 3: Implement one requeue helper**

Inside the hook, add a callback that counts existing later `requeue` occurrences for the phrase, returns without mutation at three, and otherwise inserts at:

```ts
const insertionIndex = Math.min(indexRef.current + 3, queueRef.current.length);
const next = [...queueRef.current];
next.splice(insertionIndex, 0, { ...current, source: "requeue" });
replaceQueue(next);
```

Call it only after `recordEvent("again")` succeeds, from both reveal-as-unknown and normal grading. Persist the dynamic queue before advancing. Keep pending-event idempotency and operation locks unchanged.

- [ ] **Step 4: Run tests and verify GREEN**

Run: `npm test -- tests/hooks/useTrainingSession.test.tsx tests/components/speakingPractice.test.tsx`

Expected: PASS, including pause/resume and failed-write cases.

- [ ] **Step 5: Commit**

```bash
git add app/hooks/useTrainingSession.ts tests/hooks/useTrainingSession.test.tsx tests/components/speakingPractice.test.tsx
git commit -m "feat: requeue failed due reviews"
```

### Task 4: Persist correct first-learning outcomes

**Files:**
- Modify: `app/hooks/useNewPhraseLearning.ts`
- Modify: `tests/hooks/useNewPhraseLearning.test.tsx`
- Modify: `tests/components/newPhraseLearning.test.tsx`

- [ ] **Step 1: Write failing first-learning tests**

Test one phrase through study and Chinese-only test. For `good`, assert one Shanghai mastery date and `stage: "learned"`; for `hard`/`again`, assert no mastery date. Repeat a same-day good retry/idempotent event and assert only one date. Verify close/remount restores the exact phase/index and does not expose English before reveal.

- [ ] **Step 2: Run tests and verify RED**

Run: `npm test -- tests/hooks/useNewPhraseLearning.test.tsx tests/components/newPhraseLearning.test.tsx`

Expected: FAIL where old state fixtures or write expectations assume the former mastery behavior.

- [ ] **Step 3: Align the hook with the shared transition**

Keep the hook’s study/test workflow and repository API. Ensure the event passed to `submitFirstLearningReview` carries the selected result once, and that no local UI state claims mastery before the transaction succeeds. Use persisted repository state on reload; do not duplicate mastery calculations in the component.

- [ ] **Step 4: Run tests and verify GREEN**

Run: `npm test -- tests/hooks/useNewPhraseLearning.test.tsx tests/components/newPhraseLearning.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/hooks/useNewPhraseLearning.ts tests/hooks/useNewPhraseLearning.test.tsx tests/components/newPhraseLearning.test.tsx
git commit -m "fix: align first learning with recall mastery"
```

### Task 5: Outcome-based home metrics and UI

**Files:**
- Modify: `app/domain/trainingStats.ts`
- Modify: `app/PhraseBankApp.tsx`
- Modify: `app/components/TrainingHome.tsx`
- Modify: `app/components/WeeklySummary.tsx`
- Modify: `app/globals.css`
- Modify: `tests/domain/trainingStats.test.ts`
- Modify: `tests/components/trainingHome.test.tsx`
- Modify: `tests/components/app.test.tsx`
- Modify: `tests/components/mobileStyles.test.ts`

- [ ] **Step 1: Write failing metric tests**

Define and test persisted-state metrics:

```ts
expect(summarizeDailySentenceProgress(today, events, states)).toEqual({
  mastered: 1,
  consolidated: 2,
  reviewed: 4,
});
expect(summarizeWeek(events, sessions, states, weekStart)).toMatchObject({
  retentionRate: 75,
  forgettableCount: 2,
});
```

Fixtures must prove: only the third effective mastery date counts as today mastered; earlier good dates count as consolidated; latest weekly non-new result per phrase determines retention; one `again` or two consecutive `hard` results mark a currently non-mastered phrase forgettable; no review produces an undefined rate rendered as `--`.

Add component/integration assertions for “今日巩固”, “本周复习保持率”, “容易忘记”, and absence of “有效分钟”/“开口次数”.

- [ ] **Step 2: Run tests and verify RED**

Run: `npm test -- tests/domain/trainingStats.test.ts tests/components/trainingHome.test.tsx tests/components/app.test.tsx tests/components/mobileStyles.test.ts`

Expected: FAIL because the new metrics/labels do not exist and daily mastered still counts every good event.

- [ ] **Step 3: Implement persisted outcome summaries**

Change `summarizeDailySentenceProgress` to accept learning states and compute mastery from `masteryAchievedDate`. Return `consolidated` for effective good dates today that are not a mastery transition. Extend `summarizeWeek` with learning states and derive the latest non-new result per phrase plus the 12-week forgettable set.

Pass `learningStates` from `PhraseBankApp`. Update the daily card to show “今日掌握” and “今日巩固”; update the weekly grid to show “本周掌握 / 复习保持率 / 容易忘记 / 从模糊到掌握”. Keep due count, new-learning count, heatmap, safe-area, and mobile wrapping behavior intact.

- [ ] **Step 4: Run tests and verify GREEN**

Run: `npm test -- tests/domain/trainingStats.test.ts tests/components/trainingHome.test.tsx tests/components/app.test.tsx tests/components/mobileStyles.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/domain/trainingStats.ts app/PhraseBankApp.tsx app/components/TrainingHome.tsx app/components/WeeklySummary.tsx app/globals.css tests/domain/trainingStats.test.ts tests/components/trainingHome.test.tsx tests/components/app.test.tsx tests/components/mobileStyles.test.ts
git commit -m "feat: show durable learning outcomes"
```

### Task 6: Full compatibility, cloud, and deployment evidence

**Files:**
- Modify only if assertions require refresh: `tests/storage/cloudRepository.test.ts`
- Modify: `docs/audits/home-heatmap-performance/metrics.json`
- Modify: `docs/audits/home-heatmap-performance/README.md`

- [ ] **Step 1: Run integration and cloud tests**

Run:

```bash
npm test -- tests/storage/cloudRepository.test.ts tests/storage/repository.test.ts tests/components/app.test.tsx tests/hooks/useTrainingSession.test.tsx tests/hooks/useNewPhraseLearning.test.tsx
```

Expected: PASS. If a cloud test fails, add a failing assertion proving `masteryResetAt`, dynamic sessions, and state transitions survive snapshot sync before changing production code.

- [ ] **Step 2: Run the complete verification suite**

Run:

```bash
npm test
npm run lint
npm run build
git diff --check
```

Expected: all pass with zero failures; build exposes only intended routes.

- [ ] **Step 3: Refresh generated performance evidence**

With `app/` clean and all product commits complete, run:

```bash
npm run benchmark:home-before-after
npm run test:home-performance
```

Update the audit README only with runner-produced source tree/build numbers. Verify `C:\Temp\phb-*` residue count is zero and no temporary worktree registration remains.

- [ ] **Step 4: Re-run final verification after evidence changes**

Run:

```bash
npm test
npm run lint
npm run build
git diff --check
git status --short
```

Expected: tests/lint/build/diff pass; status contains only the intended audit evidence before commit.

- [ ] **Step 5: Commit evidence**

```bash
git add docs/audits/home-heatmap-performance/metrics.json docs/audits/home-heatmap-performance/README.md tests/storage/cloudRepository.test.ts
git commit -m "test: verify durable mastery learning flow"
```

Do not deploy in this task unless the user separately requests deployment after the final verification report.
