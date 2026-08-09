# Daily Speaking Practice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add fragmented 30-minute daily speaking practice with spaced selection, temporary recording, browser pronunciation, resumable progress, streaks, and weekly feedback without losing existing phrase data.

**Architecture:** Keep IndexedDB as the source of truth, migrate it from version 1 to version 2, and add focused domain modules for scheduling, group selection, statistics, speech, and recording. Split the training UI out of `PhraseBankApp.tsx`; the app shell coordinates repositories and screens, while pure domain functions remain independently testable.

**Tech Stack:** React 19, TypeScript, Vinext/Vite, IndexedDB via `idb`, Web Speech API, MediaRecorder, Vitest, Testing Library, fake-indexeddb.

---

## File map

- Modify `app/domain/types.ts`: training, speech preference, and backup v2 types.
- Modify `app/domain/review.ts`: confirmed 1/3/7/14/30/60-day scheduling behavior.
- Create `app/domain/trainingSelection.ts`: pure 60/20/20 group selection and new-item cap.
- Create `app/domain/trainingStats.ts`: daily totals, streaks, light days, and weekly summary.
- Modify `app/storage/repository.ts`: repository contract for training events/preferences.
- Modify `app/storage/indexedDbRepository.ts`: v2 stores, migration, idempotent event writes, queries, and backups.
- Modify `app/storage/backup.ts`: accept v1 backups and validate v2 optional training data.
- Create `app/services/speech.ts`: browser voice selection and speech synthesis wrapper.
- Create `app/services/recorder.ts`: temporary MediaRecorder lifecycle and object URL cleanup.
- Create `app/hooks/useTrainingSession.ts`: resumable group state, hint cap, requeue, and effective-time tracking.
- Create `app/components/TrainingHome.tsx`: daily progress and group entry actions.
- Create `app/components/SpeakingPractice.tsx`: Chinese-first recording/reveal/grade flow.
- Create `app/components/WeeklySummary.tsx`: meaningful weekly output metrics.
- Modify `app/PhraseBankApp.tsx`: wire the new components and preserve library/add/settings flows.
- Modify `app/components/AppIcon.tsx`: microphone, speaker, play, pause, and clock icons.
- Modify `app/globals.css`: iPhone-safe practice, recording, summary, and settings styles.
- Test under `tests/domain`, `tests/storage`, `tests/services`, `tests/hooks`, and `tests/components`.

### Task 1: Define training domain types and interval rules

**Files:**
- Modify: `app/domain/types.ts`
- Modify: `app/domain/review.ts`
- Test: `tests/domain/review.test.ts`
- Create: `tests/domain/trainingTypes.test.ts`

- [ ] **Step 1: Write failing interval and type-shape tests**

```ts
import { describe, expect, it } from "vitest";
import { createNewPhrase, scheduleReview } from "../../app/domain/review";

const now = new Date("2026-08-09T08:00:00.000Z");

describe("speaking-practice intervals", () => {
  it("uses 1, 3, 7, 14, 30 and 60 day good intervals", () => {
    const expected = [1, 3, 7, 14, 30, 60, 60];
    expected.forEach((days, reviewStep) => {
      const phrase = { ...createNewPhrase({ english: "A", chinese: "甲", categoryId: "daily" }, now), reviewStep };
      const result = scheduleReview(phrase, "good", now);
      expect((Date.parse(result.phrase.nextReviewAt) - now.getTime()) / 86_400_000).toBe(days);
    });
  });

  it("schedules hard for three days and again for the next day", () => {
    const phrase = createNewPhrase({ english: "A", chinese: "甲", categoryId: "daily" }, now);
    expect(scheduleReview(phrase, "hard", now).phrase.nextReviewAt).toBe("2026-08-12T08:00:00.000Z");
    expect(scheduleReview(phrase, "again", now).phrase.nextReviewAt).toBe("2026-08-10T08:00:00.000Z");
  });
});
```

Create a compile-time fixture in `tests/domain/trainingTypes.test.ts` using the exact fields below and assert the values survive object construction.

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npx vitest run tests/domain/review.test.ts tests/domain/trainingTypes.test.ts`

Expected: FAIL because current intervals start at 3 days, `again` uses 10 minutes, and training types do not exist.

- [ ] **Step 3: Add the domain types and minimal interval implementation**

Append these exported types to `app/domain/types.ts`:

```ts
export type TrainingMode = "quick" | "standard";
export type TrainingSource = "due" | "weak" | "mature" | "new" | "requeue";

export interface TrainingEvent {
  id: string;
  sessionId: string;
  phraseId: string;
  source: TrainingSource;
  result: ReviewResult;
  usedPronunciationHint: boolean;
  recorded: boolean;
  activeSeconds: number;
  occurredAt: string;
}

export interface TrainingSessionRecord {
  id: string;
  mode: TrainingMode;
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  phraseIds: string[];
  currentIndex: number;
  activeSeconds: number;
}

export interface SpeechPreferences {
  accent: "en-US" | "en-GB";
  autoSpeak: boolean;
}

export interface DailyTrainingSummary {
  date: string;
  activeSeconds: number;
  completedGroups: number;
  spokenCount: number;
  masteredCount: number;
  promotedCount: number;
  lightDayUsed: boolean;
}
```

Change `REVIEW_INTERVAL_DAYS` to `[1, 3, 7, 14, 30, 60]`, schedule `again` at one day, and `hard` at three days. Keep mastery clamping and review logs unchanged.

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npx vitest run tests/domain/review.test.ts tests/domain/trainingTypes.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/domain/types.ts app/domain/review.ts tests/domain/review.test.ts tests/domain/trainingTypes.test.ts
git commit -m "feat: define speaking practice domain"
```

### Task 2: Implement deterministic daily group selection

**Files:**
- Create: `app/domain/trainingSelection.ts`
- Create: `tests/domain/trainingSelection.test.ts`

- [ ] **Step 1: Write failing selection tests**

```ts
import { describe, expect, it } from "vitest";
import { selectTrainingGroup } from "../../app/domain/trainingSelection";
import type { Phrase } from "../../app/domain/types";

const phrase = (id: string, masteryLevel: number, nextReviewAt: string, lastReviewedAt?: string): Phrase => ({
  id, english: id, chinese: id, categoryId: "daily", personalExample: "", sourceNote: "",
  reviewStep: masteryLevel, masteryLevel, nextReviewAt, createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z", lastReviewedAt,
});

it("builds a standard group from 60% due, 20% weak and 20% mature", () => {
  const now = new Date("2026-08-09T08:00:00.000Z");
  const items = [
    ...Array.from({ length: 8 }, (_, i) => phrase(`due-${i}`, 1, "2026-08-08T00:00:00.000Z", "2026-08-01T00:00:00.000Z")),
    ...Array.from({ length: 4 }, (_, i) => phrase(`weak-${i}`, 0, "2026-08-20T00:00:00.000Z", "2026-08-08T00:00:00.000Z")),
    ...Array.from({ length: 4 }, (_, i) => phrase(`mature-${i}`, 3, "2026-10-01T00:00:00.000Z", "2026-06-01T00:00:00.000Z")),
  ];
  const selected = selectTrainingGroup(items, { mode: "standard", now, seed: "2026-08-09", newIntroducedToday: 0 });
  expect(selected).toHaveLength(10);
  expect(selected.filter((x) => x.source === "due")).toHaveLength(6);
  expect(selected.filter((x) => x.source === "weak")).toHaveLength(2);
  expect(selected.filter((x) => x.source === "mature")).toHaveLength(2);
});

it("limits new phrases to three per day and quick groups to three items", () => {
  const items = Array.from({ length: 10 }, (_, i) => phrase(`new-${i}`, 0, "2026-08-09T00:00:00.000Z"));
  expect(selectTrainingGroup(items, { mode: "quick", now: new Date(), seed: "x", newIntroducedToday: 2 })).toHaveLength(1);
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npx vitest run tests/domain/trainingSelection.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the pure selector**

Export `TrainingCandidate`, `TrainingSelectionOptions`, and:

```ts
export function selectTrainingGroup(
  phrases: Phrase[],
  options: TrainingSelectionOptions,
): TrainingCandidate[]
```

Use group size 10 for `standard`, 3 for `quick`; allocate `6/2/2` or `2/1/0`. Classify never-reviewed phrases as `new`, mastery 0–1 future phrases as `weak`, due timestamps as `due`, and mastery 3 phrases not due as `mature`. Use a stable seeded hash of `options.seed + phrase.id` for deterministic shuffle. Fill unused category slots from other non-duplicate pools, but never exceed `Math.max(0, 3 - newIntroducedToday)` new phrases.

- [ ] **Step 4: Add scarcity and duplicate tests, then run all selector tests**

Add assertions that a small due pool is backfilled, no phrase ID repeats, and identical seed/input returns identical order.

Run: `npx vitest run tests/domain/trainingSelection.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/domain/trainingSelection.ts tests/domain/trainingSelection.test.ts
git commit -m "feat: select bounded daily practice groups"
```

### Task 3: Migrate IndexedDB and persist idempotent training progress

**Files:**
- Modify: `app/storage/repository.ts`
- Modify: `app/storage/indexedDbRepository.ts`
- Modify: `app/domain/types.ts`
- Modify: `app/storage/backup.ts`
- Modify: `tests/storage/repository.test.ts`
- Modify: `tests/storage/backup.test.ts`

- [ ] **Step 1: Write failing migration and idempotency tests**

Add tests that create a v1 database with one custom phrase, reopen it with `LocalPhraseRepository`, and assert the phrase remains. Add:

```ts
it("stores a training event once and restores an active session", async () => {
  const event = {
    id: "event-1", sessionId: "session-1", phraseId: "starter-daily-not-sure",
    source: "due" as const, result: "hard" as const, usedPronunciationHint: true,
    recorded: true, activeSeconds: 25, occurredAt: "2026-08-09T08:00:00.000Z",
  };
  await repo.saveTrainingEvent(event);
  await repo.saveTrainingEvent(event);
  expect(await repo.listTrainingEvents()).toEqual([event]);
  await repo.saveTrainingSession({
    id: "session-1", mode: "standard", startedAt: event.occurredAt,
    updatedAt: event.occurredAt, phraseIds: [event.phraseId], currentIndex: 0, activeSeconds: 25,
  });
  expect((await repo.getActiveTrainingSession())?.id).toBe("session-1");
});
```

- [ ] **Step 2: Run storage tests and verify they fail**

Run: `npx vitest run tests/storage/repository.test.ts tests/storage/backup.test.ts`

Expected: FAIL because v2 stores and methods do not exist.

- [ ] **Step 3: Add repository methods and the v2 migration**

Add methods to `PhraseRepository` and `LocalPhraseRepository`:

```ts
saveTrainingEvent(event: TrainingEvent): Promise<void>;
listTrainingEvents(from?: Date, to?: Date): Promise<TrainingEvent[]>;
saveTrainingSession(session: TrainingSessionRecord): Promise<void>;
getActiveTrainingSession(): Promise<TrainingSessionRecord | undefined>;
completeTrainingSession(id: string, completedAt: Date): Promise<void>;
getSpeechPreferences(): Promise<SpeechPreferences>;
saveSpeechPreferences(preferences: SpeechPreferences): Promise<void>;
```

Bump `openDB` to version 2. In `upgrade`, only create missing stores:

- `trainingEvents`, key path `id`, indexes `by-occurred`, `by-session`, `by-phrase`.
- `trainingSessions`, key path `id`, index `by-updated`.

Store speech preferences in `metadata` as JSON under `speechPreferences`. Use `put` with event ID as the idempotency boundary. Query only sessions without `completedAt`, newest `updatedAt` first.

- [ ] **Step 4: Upgrade backup format without rejecting v1 files**

Change `BackupEnvelope` to a discriminated v1/v2 union. V2 includes `trainingEvents` and `trainingSessions`; export v2. `parseBackup` accepts v1 as-is and normalizes it to v2 with empty training arrays. Import v2 training records using the existing skip/overwrite policy.

- [ ] **Step 5: Run storage and backup tests**

Run: `npx vitest run tests/storage/repository.test.ts tests/storage/backup.test.ts`

Expected: PASS, including preservation of v1 phrase/category/log data.

- [ ] **Step 6: Commit**

```bash
git add app/domain/types.ts app/storage/repository.ts app/storage/indexedDbRepository.ts app/storage/backup.ts tests/storage/repository.test.ts tests/storage/backup.test.ts
git commit -m "feat: persist speaking practice progress"
```

### Task 4: Calculate daily progress, streaks, light days, and weekly summary

**Files:**
- Create: `app/domain/trainingStats.ts`
- Create: `tests/domain/trainingStats.test.ts`

- [ ] **Step 1: Write failing pure-function tests**

```ts
import { describe, expect, it } from "vitest";
import { summarizeDailyTraining, calculateStreak, summarizeWeek } from "../../app/domain/trainingStats";

it("counts only active seconds and marks 20/30 minute thresholds", () => {
  const summary = summarizeDailyTraining("2026-08-09", [event(600), event(620)], [completedSession()]);
  expect(summary.activeSeconds).toBe(1220);
  expect(summary.streakQualified).toBe(true);
  expect(summary.fullGoalReached).toBe(false);
});

it("allows one five-minute light day per ISO week", () => {
  expect(calculateStreak(dailySummaries, new Date("2026-08-09T12:00:00+08:00"))).toMatchObject({
    current: 6, lightDaysUsedThisWeek: 1,
  });
});

it("reports speaking, mastery and promotion metrics for seven local dates", () => {
  expect(summarizeWeek(events, sessions, "2026-08-03")).toMatchObject({ spokenCount: 12, masteredCount: 4, promotedCount: 2 });
});
```

Define explicit test fixtures in the test file; use Asia/Shanghai local date strings supplied to the functions rather than relying on the machine timezone.

- [ ] **Step 2: Run the test and verify it fails**

Run: `npx vitest run tests/domain/trainingStats.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement pure statistics functions**

Export:

```ts
summarizeDailyTraining(date: string, events: TrainingEvent[], sessions: TrainingSessionRecord[]): DailyTrainingSummary & { streakQualified: boolean; fullGoalReached: boolean };
calculateStreak(days: DailyTrainingSummary[], today: string): { current: number; lightDaysUsedThisWeek: number };
summarizeWeek(events: TrainingEvent[], sessions: TrainingSessionRecord[], weekStart: string): WeeklyTrainingSummary;
```

Use 1,200 seconds for streak qualification, 1,800 for full goal, and 300 for the single weekly light day. Count `recorded` events as spoken; count `good` as mastered; count an event as promoted when its preceding event for the same phrase was `again` or `hard`.

- [ ] **Step 4: Run tests and commit**

Run: `npx vitest run tests/domain/trainingStats.test.ts`

Expected: PASS.

```bash
git add app/domain/trainingStats.ts tests/domain/trainingStats.test.ts
git commit -m "feat: summarize daily speaking progress"
```

### Task 5: Add browser speech and temporary recording services

**Files:**
- Create: `app/services/speech.ts`
- Create: `app/services/recorder.ts`
- Create: `tests/services/speech.test.ts`
- Create: `tests/services/recorder.test.ts`
- Modify: `tests/setup.ts`

- [ ] **Step 1: Write failing speech tests**

Test `selectVoice(voices, "en-US")` prefers exact language, then any English voice, then returns `undefined`. Test `BrowserSpeechService.speak("Hello")` cancels prior speech, sets `utterance.lang`, and rejects with a Chinese non-blocking error when synthesis is unavailable.

- [ ] **Step 2: Write failing recorder tests**

Mock `navigator.mediaDevices.getUserMedia` and `MediaRecorder`. Verify `start()` requests `{ audio: true }`, `stop()` returns `{ blob, url }`, and `dispose()` stops all tracks and calls `URL.revokeObjectURL`.

- [ ] **Step 3: Run tests and verify failure**

Run: `npx vitest run tests/services/speech.test.ts tests/services/recorder.test.ts`

Expected: FAIL because both services are missing.

- [ ] **Step 4: Implement the services**

`BrowserSpeechService` exposes:

```ts
listVoices(): SpeechSynthesisVoice[];
speak(text: string, accent: "en-US" | "en-GB"): Promise<void>;
cancel(): void;
```

Resolve `speak` on `onend`, reject on `onerror`, and always use the selected voice when present.

`TemporaryRecorder` exposes:

```ts
start(): Promise<void>;
stop(): Promise<{ blob: Blob; url: string }>;
dispose(): void;
```

Collect non-empty `dataavailable` chunks; use the recorder MIME type for the Blob; stop tracks and revoke the prior URL on every new recording and on disposal.

- [ ] **Step 5: Run tests and commit**

Run: `npx vitest run tests/services/speech.test.ts tests/services/recorder.test.ts`

Expected: PASS.

```bash
git add app/services/speech.ts app/services/recorder.ts tests/services/speech.test.ts tests/services/recorder.test.ts tests/setup.ts
git commit -m "feat: add pronunciation and temporary recording"
```

### Task 6: Build the resumable session controller

**Files:**
- Create: `app/hooks/useTrainingSession.ts`
- Create: `tests/hooks/useTrainingSession.test.tsx`

- [ ] **Step 1: Write failing hook behavior tests**

Use `renderHook` with a memory repository. Verify:

- standard starts with 10 candidates and quick with 3;
- `revealAsUnknown()` records `again`, reveals the answer, and appends the phrase once to the end of the current queue;
- `usePronunciationHint()` sets `usedHint`, calls speech without revealing text, and makes `grade("good")` return `{ accepted: false }`;
- `grade("hard")` advances and persists one event;
- hidden document time and idle periods over 60 seconds do not add active seconds;
- remount restores the active session index and queue.

- [ ] **Step 2: Run the hook test and verify it fails**

Run: `npx vitest run tests/hooks/useTrainingSession.test.tsx`

Expected: FAIL because the hook does not exist.

- [ ] **Step 3: Implement the hook as a state machine**

Expose:

```ts
type TrainingPhase = "prompt" | "recording" | "answer" | "complete";

interface TrainingSessionController {
  phase: TrainingPhase;
  current?: TrainingCandidate;
  index: number;
  total: number;
  usedHint: boolean;
  recordingUrl?: string;
  startRecording(): Promise<void>;
  stopRecording(): Promise<void>;
  revealAsUnknown(): Promise<void>;
  usePronunciationHint(): Promise<void>;
  repeatPronunciation(): Promise<void>;
  grade(result: ReviewResult): Promise<{ accepted: boolean }>;
  finish(): Promise<void>;
}
```

Persist after every grade and after every 30 seconds of active interaction. Count active time only while `document.visibilityState === "visible"` and the last pointer/keyboard action is within 60 seconds. Use unique `crypto.randomUUID()` IDs for sessions and events. Do not persist recording Blob URLs.

- [ ] **Step 4: Run tests and commit**

Run: `npx vitest run tests/hooks/useTrainingSession.test.tsx`

Expected: PASS.

```bash
git add app/hooks/useTrainingSession.ts tests/hooks/useTrainingSession.test.tsx
git commit -m "feat: manage resumable speaking sessions"
```

### Task 7: Replace the review screen with the speaking-practice UI

**Files:**
- Create: `app/components/TrainingHome.tsx`
- Create: `app/components/SpeakingPractice.tsx`
- Create: `app/components/WeeklySummary.tsx`
- Modify: `app/PhraseBankApp.tsx`
- Modify: `app/components/AppIcon.tsx`
- Modify: `app/globals.css`
- Modify: `tests/components/app.test.tsx`
- Create: `tests/components/speakingPractice.test.tsx`

- [ ] **Step 1: Write failing component tests for the confirmed flow**

```tsx
it("supports unknown, recording, pronunciation hint and capped grading", async () => {
  render(<SpeakingPractice controller={controllerFixture()} preferences={{ accent: "en-US", autoSpeak: true }} />);
  expect(screen.getByText("我还没决定。")).toBeVisible();
  expect(screen.queryByText("I haven't decided yet.")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "不会，直接看答案" })).toBeVisible();
  expect(screen.getByRole("button", { name: "按住说英语" })).toBeVisible();
  expect(screen.getByRole("button", { name: "先听发音" })).toBeVisible();
  await user.click(screen.getByRole("button", { name: "先听发音" }));
  expect(controller.usePronunciationHint).toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "按住说英语" }));
  await user.click(screen.getByRole("button", { name: "我说完了" }));
  expect(await screen.findByText("I haven't decided yet.")).toBeVisible();
  expect(screen.getByRole("button", { name: "掌握" })).toBeDisabled();
});
```

Add app-level tests for “开始 10 分钟训练”, “快速练一组”, `12 / 30 分钟`, completed state, and returning to the home screen.

- [ ] **Step 2: Run component tests and verify failure**

Run: `npx vitest run tests/components/app.test.tsx tests/components/speakingPractice.test.tsx`

Expected: FAIL because the new components and controls do not exist.

- [ ] **Step 3: Implement focused components and app wiring**

`TrainingHome` receives `dailySummary`, `streak`, `weeklySummary`, `onStartStandard`, and `onStartQuick`. It renders the daily minute progress rather than total due count.

`SpeakingPractice` renders:

- prompt state: Chinese, “不会，直接看答案”, press/stop recording, and “先听发音”;
- answer state: English, personal example, own-recording playback, “再听标准发音”, “跟读一次”, and grade buttons;
- complete state: group counts, active minutes, “回到首页”, and “再练一组”.

`PhraseBankApp` adds screen `practice`, loads events/summaries on refresh, and leaves library/add/settings behavior intact. Split no further than these three components.

Add real Phosphor icons for microphone, speaker, play, stop, repeat, and clock to `AppIcon`; keep all icon-only buttons labeled.

- [ ] **Step 4: Add iPhone-safe CSS**

Use existing ivory/forest/coral tokens. Requirements:

- fixed practice actions reserve `calc(96px + env(safe-area-inset-bottom))` content space;
- every actionable control is at least 44px tall;
- record button is at least 64px tall and has visible recording state;
- long Chinese/English text uses `overflow-wrap:anywhere` and no horizontal scroll;
- grade buttons remain reachable at 390×844;
- recording animation is disabled under `prefers-reduced-motion`.

- [ ] **Step 5: Run components, full tests, lint, and build**

Run:

```bash
npx vitest run tests/components/app.test.tsx tests/components/speakingPractice.test.tsx
npm test
npm run lint
npm run build
```

Expected: all commands exit 0.

- [ ] **Step 6: Commit**

```bash
git add app/components/TrainingHome.tsx app/components/SpeakingPractice.tsx app/components/WeeklySummary.tsx app/PhraseBankApp.tsx app/components/AppIcon.tsx app/globals.css tests/components/app.test.tsx tests/components/speakingPractice.test.tsx
git commit -m "feat: add daily speaking practice experience"
```

### Task 8: Add speech settings, migration safety, and mobile acceptance evidence

**Files:**
- Modify: `app/PhraseBankApp.tsx`
- Modify: `app/globals.css`
- Modify: `tests/components/app.test.tsx`
- Modify: `tests/deployment/installability.test.ts`
- Create: `docs/audits/iphone13pro-speaking/`
- Create: `design-qa-speaking.md`

- [ ] **Step 1: Write failing settings tests**

Test that Settings exposes an “自动朗读答案” switch and “美式英语 / 英式英语” choice, loads stored preferences, and persists changes through `saveSpeechPreferences`.

- [ ] **Step 2: Implement the settings controls**

Add a divider-led “语音训练” section using existing settings styles. Use a native checkbox/switch with a visible label and two native radio inputs for accents. Do not request microphone permission from Settings; request it only when recording begins.

- [ ] **Step 3: Run all automated verification**

Run:

```bash
npm test
npm run lint
npm run build
git diff --check
```

Expected: all commands exit 0 and the full suite includes migration, selector, speech, recorder, hook, and component coverage.

- [ ] **Step 4: Verify at the iPhone 13 Pro viewport**

Start the local app and use the connected Chrome browser at 390×844. Capture:

- home at 0/30 minutes;
- prompt before recording;
- active recording;
- answer with recording playback;
- hint-used state with disabled “掌握”;
- group completion;
- speech settings;
- microphone-denied fallback.

Save screenshots under `docs/audits/iphone13pro-speaking/`. Check no horizontal overflow, safe-area clearance, 44px targets, text wrapping, and app-origin console errors.

- [ ] **Step 5: Write and pass design QA**

Create `design-qa-speaking.md` recording viewport, screenshot paths, tested interactions, console result, any P0–P2 findings/fixes, and exactly:

```text
final result: passed
```

Do not proceed if any actionable P0–P2 issue remains.

- [ ] **Step 6: Commit acceptance evidence**

```bash
git add app/PhraseBankApp.tsx app/globals.css tests/components/app.test.tsx tests/deployment/installability.test.ts docs/audits/iphone13pro-speaking design-qa-speaking.md
git commit -m "test: verify iPhone speaking practice flow"
```

### Task 9: Integrate, deploy, and verify production without data loss

**Files:**
- Modify only if verification exposes a defect.

- [ ] **Step 1: Run the final clean verification**

Run:

```bash
npm test
npm run lint
npm run build
git status --short
```

Expected: tests/lint/build exit 0; status contains only intentional project-planning files already owned by the user, if present.

- [ ] **Step 2: Merge using the approved branch workflow and push `main`**

Preserve unrelated modified `findings.md`, `progress.md`, and `task_plan.md`. Push with the configured GitHub SSH identity and do not force-push.

- [ ] **Step 3: Monitor GitHub Actions to completion**

Expected workflow: `Test and deploy` completes with conclusion `success` for the pushed SHA.

- [ ] **Step 4: Verify production**

Confirm `http://43.153.204.17/` returns 200 and renders the new home. In a fresh browser database, verify seeding and practice. In the existing browser profile, verify existing phrases remain and the v2 migration creates training stores without reseeding deleted starter phrases.

- [ ] **Step 5: Record deployment evidence**

Add the production SHA, workflow URL, HTTP checks, and migration result to the existing QA report, then commit and push only if the report changed.

