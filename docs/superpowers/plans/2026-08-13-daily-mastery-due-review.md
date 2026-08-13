# Daily Mastery Goal and Due Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a cloud-synced, user-configurable daily mastery goal, clarify spaced-repetition due review, and remove the weekly spoken-count card.

**Architecture:** Introduce a focused `AppPreferences` record stored in IndexedDB metadata and included in backup v5 so the existing cloud snapshot sync carries it between devices. Load preferences with the existing bounded home read, render goal progress from current sentence statistics, and keep the existing review scheduler unchanged.

**Tech Stack:** TypeScript, React 19, IndexedDB/idb, Vitest, Testing Library, Phosphor Icons, vinext.

---

### Task 1: Persist application preferences and migrate backups

**Files:**
- Modify: `app/domain/types.ts`
- Modify: `app/storage/backup.ts`
- Modify: `app/storage/repository.ts`
- Modify: `app/storage/indexedDbRepository.ts`
- Modify: `app/storage/cloudRepository.ts`
- Modify: `tests/storage/backup.test.ts`
- Modify: `tests/storage/repository.test.ts`
- Modify: `tests/storage/cloudRepository.test.ts`

- [ ] **Step 1: Write failing storage and backup tests**

Add tests that expect `getAppPreferences()` to default to `{ dailyMasteryGoal: 10 }`, `saveAppPreferences()` to persist a positive integer across repository instances, invalid metadata to fall back to 10, v5 exports to include `appPreferences`, and v1-v4 imports to normalize to the default. Add a cloud test proving `saveAppPreferences()` triggers snapshot synchronization.

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `npm test -- tests/storage/backup.test.ts tests/storage/repository.test.ts tests/storage/cloudRepository.test.ts`

Expected: FAIL because `AppPreferences`, v5 backups, and repository methods do not exist.

- [ ] **Step 3: Add the preference contract and v5 migration**

Define:

```ts
export interface AppPreferences { dailyMasteryGoal: number }
export const DEFAULT_DAILY_MASTERY_GOAL = 10;
```

Extend the repository with `getAppPreferences()` and `saveAppPreferences()`. Store the JSON value under metadata key `appPreferences`; accept only positive integers and use the default for missing/corrupt data. Create `BackupEnvelopeV5` containing `appPreferences`, normalize v1-v4 to v5 with the default, export v5, import preferences, and sync preference saves through `CloudPhraseRepository`.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `npm test -- tests/storage/backup.test.ts tests/storage/repository.test.ts tests/storage/cloudRepository.test.ts`

Expected: all focused storage tests PASS.

- [ ] **Step 5: Commit**

```text
feat: sync daily mastery preferences
```

### Task 2: Load the goal with home data and make it editable

**Files:**
- Modify: `app/services/homeData.ts`
- Modify: `app/components/screens/SettingsScreen.tsx`
- Modify: `app/PhraseBankApp.tsx`
- Modify: `tests/services/homeData.test.ts`
- Modify: `tests/components/app.test.tsx`

- [ ] **Step 1: Write failing home and settings tests**

Assert the bounded home loader calls `getAppPreferences()` exactly once and returns the preference without exporting a snapshot. In the app test, open Settings, verify default 10, save a positive integer, return home, and verify the new target. Assert empty, zero, negative, decimal, and nonnumeric values do not save and show a Chinese validation error. Cover save failure restoring the prior successful value.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npm test -- tests/services/homeData.test.ts tests/components/app.test.tsx`

Expected: FAIL because home data and Settings do not expose the preference.

- [ ] **Step 3: Implement one-load preference flow**

Add `repository.getAppPreferences()` to the existing `Promise.all` in `loadHomeData`. Pass the loaded value to `TrainingHome` and Settings. Add a “每日掌握目标” numeric input and explicit save button; validate a positive integer before calling `saveAppPreferences()`, refresh home data on success, and preserve the prior value on failure.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `npm test -- tests/services/homeData.test.ts tests/components/app.test.tsx`

Expected: all focused tests PASS and `exportSnapshot()` remains unused on startup.

- [ ] **Step 5: Commit**

```text
feat: configure daily mastery goal
```

### Task 3: Render goal progress and simplify weekly stats

**Files:**
- Modify: `app/components/TrainingHome.tsx`
- Modify: `app/components/WeeklySummary.tsx`
- Modify: `app/globals.css`
- Modify: `tests/components/trainingHome.test.tsx`
- Create: `tests/components/weeklySummary.test.tsx`
- Modify: `tests/components/mobileStyles.test.ts`

- [ ] **Step 1: Write failing component and CSS tests**

Cover `7 / 10` with “还差 3 句”, `10 / 10` with “已完成今日目标”, and `14 / 10` with “超额完成 4 句”. Assert an accessible progressbar has min 0, max 10, values 7/10/14 while its visual width is clamped at 100%. Assert “开口次数” is absent and the other four weekly statistics remain. Lock the live progress selectors in CSS.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npm test -- tests/components/trainingHome.test.tsx tests/components/weeklySummary.test.tsx tests/components/mobileStyles.test.ts`

Expected: FAIL because goal progress and the simplified weekly grid are not implemented.

- [ ] **Step 3: Implement the goal card**

Render `今日掌握 X / Y 句`, a semantic progressbar, and the three exact status messages. Clamp only the visual percentage. Remove the spoken-count element from `WeeklySummary`, keep four cards, and update scoped mobile-safe CSS without deleting historical data fields.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `npm test -- tests/components/trainingHome.test.tsx tests/components/weeklySummary.test.tsx tests/components/mobileStyles.test.ts`

Expected: all focused UI tests PASS.

- [ ] **Step 5: Commit**

```text
feat: show configurable mastery progress
```

### Task 4: Clarify due review visuals without changing scheduling

**Files:**
- Modify: `app/components/AppIcon.tsx`
- Modify: `app/components/TrainingHome.tsx`
- Modify: `app/globals.css`
- Modify: `tests/components/trainingHome.test.tsx`
- Modify: `tests/components/mobileStyles.test.ts`
- Modify: `tests/domain/review.test.ts`

- [ ] **Step 1: Write failing due-review UI tests**

Assert the entry is named “到期复习”, renders the new cycle-clock icon hook, displays “今天暂无到期内容” at zero, and “3 句到期” when nonzero. Assert the entry uses the exact `#267453` scoped color. Preserve the scheduler tests for 1, 3, 7, 14, 30, and 60 days.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npm test -- tests/components/trainingHome.test.tsx tests/components/mobileStyles.test.ts tests/domain/review.test.ts`

Expected: UI tests FAIL on the old label/icon/text while scheduler tests remain PASS.

- [ ] **Step 3: Implement approved A visual**

Add a Phosphor-based cycle-clock icon to `AppIcon`, use it in the review entry, update zero/nonzero and continue-task copy to due terminology, and scope the forest-green background to `.standard-start`. Do not change `scheduleReview`, `listDuePhrases`, or review eligibility.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `npm test -- tests/components/trainingHome.test.tsx tests/components/mobileStyles.test.ts tests/domain/review.test.ts`

Expected: UI and interval tests PASS.

- [ ] **Step 5: Commit**

```text
style: clarify spaced repetition entry
```

### Task 5: Integration verification and generated performance evidence

**Files:**
- Modify only if generated output changes: `docs/audits/home-heatmap-performance/metrics.json`
- Modify only if generated output changes: `docs/audits/home-heatmap-performance/README.md`

- [ ] **Step 1: Run the targeted integration suite**

Run: `npm test -- tests/components/app.test.tsx tests/components/trainingHome.test.tsx tests/components/weeklySummary.test.tsx tests/storage/repository.test.ts tests/storage/cloudRepository.test.ts tests/storage/backup.test.ts tests/services/homeData.test.ts tests/domain/review.test.ts`

Expected: all targeted tests PASS.

- [ ] **Step 2: Run full verification**

Run: `npm test`

Expected: all tests PASS, with only the existing explicitly skipped build-budget tests.

Run: `npm run lint`

Expected: exit 0.

Run: `npm run build`

Expected: exit 0.

- [ ] **Step 3: Refresh reproducible performance evidence if required**

If the full suite reports the expected source-tree mismatch after app changes, first verify the app tree is clean, then run `npm run benchmark:home-before-after`. Confirm the runner reports zero temporary residue and no worktree registration. Re-run `npm run test:home-performance`.

- [ ] **Step 4: Check scope and commit evidence**

Run: `git diff --check` and review `git diff --stat` to confirm no auth, account, review-scheduler, or unrelated files changed.

Commit generated evidence, if any, as:

```text
test: refresh mastery goal performance evidence
```
