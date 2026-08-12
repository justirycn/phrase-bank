# Daily Sentence Learning Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace minute-based and quick-practice UX with sentence-count progress and resumable new-learning/review tasks.

**Architecture:** Keep both existing persisted session types. Route review through the existing standard `useTrainingSession` flow so its queue and cursor persist, while `LearningSessionRecord` continues to own new-phrase progress. Derive a small daily sentence summary and continuation destination in `PhraseBankApp`, then render it through `TrainingHome`.

**Tech Stack:** React, TypeScript, Vitest, Testing Library, existing IndexedDB/cloud repository interfaces.

---

### Task 1: Sentence-based daily progress

**Files:**
- Modify: `app/domain/trainingStats.ts`
- Modify: `tests/domain/trainingStats.test.ts`

- [ ] Add failing tests for distinct good phrase count, distinct reviewed phrase count, and removal of minute-based completion semantics from the home-facing summary.
- [ ] Run `npm test -- tests/domain/trainingStats.test.ts` and confirm the new expectations fail.
- [ ] Add a focused daily task summary helper derived from Shanghai-day training events.
- [ ] Re-run the focused test and commit the green change.

### Task 2: Simplified home actions

**Files:**
- Modify: `app/components/TrainingHome.tsx`
- Modify: `tests/components/trainingHome.test.tsx`
- Modify: `app/globals.css`
- Modify: `tests/components/mobileStyles.test.ts`

- [ ] Add failing tests that require “今日掌握”, new/review counts, “继续今日任务”, and absence of minute/quick-practice copy.
- [ ] Run focused component/style tests and confirm the failures are caused by the old UI.
- [ ] Replace the progress card and entry buttons with the approved minimal structure.
- [ ] Re-run focused tests and commit.

### Task 3: Continue-task routing and resumable review

**Files:**
- Modify: `app/PhraseBankApp.tsx`
- Modify: `app/components/screens/PracticeScreen.tsx`
- Modify: `tests/components/app.test.tsx`
- Modify: `tests/hooks/useTrainingSession.test.tsx`

- [ ] Add failing integration tests for continuation priority: active learning, active review, due review, then new learning.
- [ ] Add a failing integration test proving review enters the standard persisted training session and resumes its saved phrase/index after remount.
- [ ] Run focused app/hook tests and confirm failures.
- [ ] Route “今日复习” and continuation review to `PracticeScreen` in standard mode, while removing all new quick-entry wiring.
- [ ] Keep the legacy `quick` type and repository compatibility unchanged.
- [ ] Re-run focused tests and commit.

### Task 4: Bilingual learning and Chinese-only recall contract

**Files:**
- Modify only if needed: `app/components/NewPhraseLearning.tsx`
- Modify: `tests/components/newPhraseLearning.test.tsx`
- Modify: `tests/components/app.test.tsx`

- [ ] Add/strengthen tests proving study shows English and Chinese together, while test/review hides English until reveal.
- [ ] Run focused tests and confirm any genuine missing behavior fails.
- [ ] Make only the minimal production adjustment required by the failing tests.
- [ ] Re-run focused tests and commit.

### Task 5: Verification and handoff

**Files:**
- No production scope expansion.

- [ ] Run all focused tests for stats, home, app, learning, and training session.
- [ ] Run `npm test`, `npm run lint`, and `npm run build` fresh.
- [ ] Run `git diff --check` and inspect the complete branch diff against `github/main`.
- [ ] Confirm login/cloud/deployment files are unchanged and the worktree is clean after commits.
- [ ] Report exact verification counts and request deployment authorization if deployment has not already been explicitly included.
