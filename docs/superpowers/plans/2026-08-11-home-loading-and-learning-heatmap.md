# Fast Home and Learning Heatmap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the first home load bounded and resilient, and add a compact 12-week GitHub-style heatmap based on distinct phrases completed per Shanghai calendar day.

**Architecture:** Put date bucketing and heat levels in a pure domain module, place bounded home reads behind a single service, and let a generation-safe hook own home loading. Keep the home shell eager, dynamically load non-home screens, and render the heatmap from the bounded 84-day event window without writing derived data.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library, IndexedDB via `idb`, vinext, existing CSS and Phosphor icon system.

---

## File map

- Create `app/domain/learningHeatmap.ts`: Shanghai calendar boundaries, 12-week grid, daily distinct phrase aggregation, fixed intensity levels.
- Create `tests/domain/learningHeatmap.test.ts`: deterministic date, deduplication, boundary and corrupt-event tests.
- Create `app/services/homeData.ts`: the only orchestration point for bounded home reads; never exports a backup.
- Create `tests/services/homeData.test.ts`: repository-call contract, range and failure isolation.
- Modify `app/storage/repository.ts`: add a bounded training-session range query.
- Modify `app/storage/indexedDbRepository.ts`: implement the session query through the existing `by-updated` index.
- Create `app/hooks/useHomeData.ts`: initialization, refresh, retry and stale-generation protection.
- Create `tests/hooks/useHomeData.test.tsx`: loading, partial heatmap error, retry, repository replacement and unmount tests.
- Create `app/components/LearningHeatmap.tsx`: accessible 12×7 heatmap presentation.
- Create `tests/components/learningHeatmap.test.tsx`: grid, labels, intensity and fallback tests.
- Modify `app/components/TrainingHome.tsx`: append heatmap after the weekly summary.
- Modify `app/PhraseBankApp.tsx`: consume `useHomeData`, remove startup `exportSnapshot`, keep screen-specific refreshes separate.
- Create `app/screens/LibraryScreen.tsx`, `AddPhraseScreen.tsx`, `SettingsScreen.tsx`, `ReviewScreen.tsx`, `LearningSessionScreen.tsx`, and `PracticeSessionScreen.tsx`: extracted non-home screen boundaries for dynamic imports.
- Modify `app/globals.css`: skeleton, heatmap, narrow viewport and reduced-motion rules.
- Modify `tests/components/app.test.tsx`: startup read contract, lazy-screen behavior, heatmap integration and failure recovery.
- Modify `tests/components/mobileStyles.test.ts`: responsive heatmap and skeleton CSS contracts.
- Create `tests/deployment/homePerformance.test.ts`: build-output and startup-source regression guards.
- Create `docs/audits/home-loading/README.md`: before/after measurements and iPhone verification evidence.

### Task 1: Build the pure 12-week heatmap model

**Files:**
- Create: `app/domain/learningHeatmap.ts`
- Create: `tests/domain/learningHeatmap.test.ts`

- [ ] **Step 1: Write failing domain tests**

```ts
import { describe, expect, it } from "vitest";
import { buildLearningHeatmap, heatLevel } from "../../app/domain/learningHeatmap";
import type { TrainingEvent } from "../../app/domain/types";

const event = (id: string, phraseId: string, occurredAt: string): TrainingEvent => ({
  id, sessionId: `session-${id}`, phraseId, source: "due", result: "good",
  hinted: false, recorded: false, activeSeconds: 10, occurredAt,
});

describe("buildLearningHeatmap", () => {
  it("creates Monday-first 12-week cells ending in the current week", () => {
    const result = buildLearningHeatmap([], new Date("2026-08-11T08:00:00.000Z"));
    expect(result).toHaveLength(84);
    expect(result[0].date).toBe("2026-05-25");
    expect(result.at(-1)?.date).toBe("2026-08-16");
    expect(result.find(({ date }) => date === "2026-08-11")?.future).toBe(false);
    expect(result.find(({ date }) => date === "2026-08-12")?.future).toBe(true);
  });

  it("deduplicates a phrase within a Shanghai day and counts it again next day", () => {
    const result = buildLearningHeatmap([
      event("a", "p1", "2026-08-10T15:59:00.000Z"),
      event("b", "p1", "2026-08-10T15:59:30.000Z"),
      event("c", "p1", "2026-08-10T16:00:00.000Z"),
      event("d", "p2", "2026-08-10T16:01:00.000Z"),
    ], new Date("2026-08-11T08:00:00.000Z"));
    expect(result.find(({ date }) => date === "2026-08-10")?.count).toBe(1);
    expect(result.find(({ date }) => date === "2026-08-11")?.count).toBe(2);
  });

  it("ignores invalid, future and out-of-window events", () => {
    const result = buildLearningHeatmap([
      event("bad", "p1", "not-a-date"),
      event("future", "p2", "2026-08-12T00:00:00.000Z"),
      event("old", "p3", "2026-05-24T23:59:59.000Z"),
    ], new Date("2026-08-11T08:00:00.000Z"));
    expect(result.every(({ count }) => count === 0)).toBe(true);
  });
});

it.each([[0, 0], [1, 1], [2, 1], [3, 2], [5, 2], [6, 3], [9, 3], [10, 4], [99, 4]])(
  "maps %i phrases to heat level %i", (count, level) => expect(heatLevel(count)).toBe(level),
);
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npm test -- tests/domain/learningHeatmap.test.ts`

Expected: FAIL because `app/domain/learningHeatmap.ts` does not exist.

- [ ] **Step 3: Implement the complete pure model**

```ts
import type { TrainingEvent } from "./types";

export interface LearningHeatmapDay {
  date: string;
  count: number;
  level: 0 | 1 | 2 | 3 | 4;
  future: boolean;
}

const shanghaiDay = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
});

export function heatLevel(count: number): LearningHeatmapDay["level"] {
  if (count <= 0) return 0;
  if (count <= 2) return 1;
  if (count <= 5) return 2;
  if (count <= 9) return 3;
  return 4;
}

function addDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function mondayOf(date: string) {
  const value = new Date(`${date}T00:00:00.000Z`);
  return addDays(date, -((value.getUTCDay() + 6) % 7));
}

export function buildLearningHeatmap(events: TrainingEvent[], now = new Date()): LearningHeatmapDay[] {
  const today = shanghaiDay.format(now);
  const start = addDays(mondayOf(today), -77);
  const phrasesByDay = new Map<string, Set<string>>();
  for (const item of events) {
    const occurred = new Date(item.occurredAt);
    if (!item.phraseId || Number.isNaN(occurred.getTime())) continue;
    const day = shanghaiDay.format(occurred);
    if (day < start || day > today) continue;
    const ids = phrasesByDay.get(day) ?? new Set<string>();
    ids.add(item.phraseId);
    phrasesByDay.set(day, ids);
  }
  return Array.from({ length: 84 }, (_, index) => {
    const date = addDays(start, index);
    const count = phrasesByDay.get(date)?.size ?? 0;
    return { date, count, level: heatLevel(count), future: date > today };
  });
}
```

- [ ] **Step 4: Run focused and full domain tests**

Run: `npm test -- tests/domain/learningHeatmap.test.ts tests/domain/trainingStats.test.ts`

Expected: both files PASS.

- [ ] **Step 5: Commit**

```bash
git add app/domain/learningHeatmap.ts tests/domain/learningHeatmap.test.ts
git commit -m "feat: aggregate daily learning heatmap"
```

### Task 2: Add one bounded home-data read boundary

**Files:**
- Create: `app/services/homeData.ts`
- Create: `tests/services/homeData.test.ts`
- Modify: `app/storage/repository.ts`
- Modify: `app/storage/indexedDbRepository.ts`
- Modify: `tests/storage/repository.test.ts`

- [ ] **Step 1: Write failing service tests**

Create a typed repository fake with spies and assert the exact calls:

```ts
it("loads only bounded home data and never exports a backup", async () => {
  const repository = makeRepository();
  const now = new Date("2026-08-11T08:00:00.000Z");
  const data = await loadHomeData(repository, now);
  expect(repository.listTrainingEvents).toHaveBeenCalledWith(
    new Date("2026-05-24T16:00:00.000Z"),
    new Date("2026-08-11T15:59:59.999Z"),
  );
  expect(repository.listTrainingSessions).toHaveBeenCalledWith(expect.any(Date), expect.any(Date));
  expect(repository.getActiveTrainingSession).toHaveBeenCalledOnce();
  expect(repository.getActiveLearningSession).toHaveBeenCalledOnce();
  expect(repository.exportSnapshot).not.toHaveBeenCalled();
  expect(data.heatmap).toHaveLength(84);
});
```

Also add IndexedDB assertions to `tests/storage/repository.test.ts` that the existing `by-occurred` and `by-updated` indexes return inclusive lower and upper bounds without loading an item immediately outside either bound.

- [ ] **Step 2: Run the tests and verify RED**

Run: `npm test -- tests/services/homeData.test.ts tests/storage/repository.test.ts`

Expected: service test FAIL because `loadHomeData` is missing; repository range assertions remain green.

- [ ] **Step 3: Implement `loadHomeData`**

```ts
import type { PhraseRepository } from "../storage/repository";
import { buildLearningHeatmap } from "../domain/learningHeatmap";

export async function loadHomeData(repository: PhraseRepository, now = new Date()) {
  const { from, to } = shanghaiHeatmapRange(now); // exported beside this function and unit tested
  const eventsRequest = repository.listTrainingEvents(from, to);
  const [phrases, categories, due, trainingSessions, learningStates, activeTrainingSession, activeLearningSession] = await Promise.all([
    repository.listPhrases(), repository.listCategories(), repository.listDuePhrases(now),
    repository.listTrainingSessions(from, to), repository.listPhraseLearningStates(),
    repository.getActiveTrainingSession(), repository.getActiveLearningSession(),
  ]);
  const eventsResult = await eventsRequest.then(
    (events) => ({ events, heatmap: buildLearningHeatmap(events, now), heatmapError: "" }),
    () => ({ events: [], heatmap: [], heatmapError: "学习足迹暂时无法加载" }),
  );
  return {
    phrases, categories, due, trainingSessions, learningStates, activeTrainingSession, activeLearningSession,
    ...eventsResult,
  };
}

export type HomeData = Awaited<ReturnType<typeof loadHomeData>>;
```

`shanghaiHeatmapRange()` must produce the UTC instant corresponding to the first grid day at Shanghai 00:00 and today at Shanghai 23:59:59.999. Do not derive the range with the host machine timezone.

Add this interface method and implement it with the existing index:

```ts
listTrainingSessions(from?: Date, to?: Date): Promise<TrainingSessionRecord[]>;

async listTrainingSessions(from?: Date, to?: Date) {
  const range = dateRange(from, to); // use the same inclusive helper pattern as listTrainingEvents
  return (await this.db()).getAllFromIndex("trainingSessions", "by-updated", range);
}
```

The event failure is intentionally isolated so initial home actions still render. A later heatmap retry may replace only `events`, `heatmap`, and `heatmapError` while preserving the successful core data.

- [ ] **Step 4: Verify focused tests**

Run: `npm test -- tests/services/homeData.test.ts tests/storage/repository.test.ts`

Expected: PASS, including exact range and `exportSnapshot` call count zero.

- [ ] **Step 5: Commit**

```bash
git add app/services/homeData.ts app/storage/repository.ts app/storage/indexedDbRepository.ts tests/services/homeData.test.ts tests/storage/repository.test.ts
git commit -m "perf: bound home startup reads"
```

### Task 3: Make home loading generation-safe and independently retryable

**Files:**
- Create: `app/hooks/useHomeData.ts`
- Create: `tests/hooks/useHomeData.test.tsx`

- [ ] **Step 1: Write failing hook tests**

Cover these concrete transitions with deferred promises:

```ts
it("ignores an old repository result after replacement", async () => {
  const oldLoad = deferred<HomeData>();
  const repoA = makeRepository({ homeLoad: oldLoad.promise });
  const repoB = makeRepository({ homeData: populatedHomeData });
  const { result, rerender } = renderHook(({ repository }) => useHomeData(repository), {
    initialProps: { repository: repoA },
  });
  rerender({ repository: repoB });
  await waitFor(() => expect(result.current.data).toBe(populatedHomeData));
  oldLoad.resolve(emptyHomeData);
  await act(async () => oldLoad.promise);
  expect(result.current.data).toBe(populatedHomeData);
});
```

Add tests for initial skeleton, successful load, retry after core rejection, unmount before settle, and a heatmap-only retry that preserves already rendered home actions. Mock `loadHomeData` with `vi.mock("../../app/services/homeData")` so each deferred generation is explicit.

- [ ] **Step 2: Run and verify RED**

Run: `npm test -- tests/hooks/useHomeData.test.tsx`

Expected: FAIL because the hook is missing.

- [ ] **Step 3: Implement the hook**

The public result must be:

```ts
export interface HomeDataController {
  data?: HomeData;
  loading: boolean;
  error: string;
  refresh(): Promise<void>;
  retry(): Promise<void>;
  retryHeatmap(): Promise<void>;
}
```

Use a monotonically increasing generation ref. Capture the generation and repository at each request; compare both after every `await` and before every state update. Cleanup increments the generation. Keep the last successful `data` during refresh failure so a transient IndexedDB error does not blank the home screen. `retryHeatmap()` calls only the bounded event query and merges `events`, `heatmap`, and `heatmapError` into the current successful data.

- [ ] **Step 4: Verify hook tests**

Run: `npm test -- tests/hooks/useHomeData.test.tsx`

Expected: all hook cases PASS with no `act()` warnings.

- [ ] **Step 5: Commit**

```bash
git add app/hooks/useHomeData.ts tests/hooks/useHomeData.test.tsx
git commit -m "feat: load home data resiliently"
```

### Task 4: Render the compact accessible heatmap

**Files:**
- Create: `app/components/LearningHeatmap.tsx`
- Create: `tests/components/learningHeatmap.test.tsx`
- Modify: `app/components/TrainingHome.tsx`
- Modify: `app/globals.css`
- Modify: `tests/components/mobileStyles.test.ts`

- [ ] **Step 1: Write failing component and CSS tests**

```tsx
render(<LearningHeatmap days={days} />);
expect(screen.getByRole("region", { name: "最近 12 周学习足迹" })).toBeVisible();
expect(screen.getAllByRole("listitem")).toHaveLength(84);
expect(screen.getByLabelText("8 月 10 日，完成 8 句")).toHaveClass("level-3");
expect(screen.getByLabelText("8 月 12 日，未来日期")).toHaveClass("future");
```

In `mobileStyles.test.ts`, assert live selectors provide `grid-template-columns: repeat(12, minmax(0, 1fr))`, `grid-template-rows: repeat(7, ...)`, `min-width: 0`, no horizontal overflow, and reduced-motion compatibility.

- [ ] **Step 2: Run and verify RED**

Run: `npm test -- tests/components/learningHeatmap.test.tsx tests/components/mobileStyles.test.ts`

Expected: FAIL because the component and CSS selectors are absent.

- [ ] **Step 3: Implement the component and integration**

```tsx
export function LearningHeatmap({ days, error, onRetry }: {
  days: LearningHeatmapDay[]; error?: string; onRetry?: () => void;
}) {
  return <section className="learning-heatmap" aria-label="最近 12 周学习足迹">
    <header><div><h2>学习足迹</h2><p>最近 12 周</p></div></header>
    {error ? <div className="heatmap-error" role="status"><span>学习足迹暂时无法加载</span><button onClick={onRetry}>重试</button></div> : <>
      <ol className="heatmap-grid">{days.map((day) => <li key={day.date} className={`level-${day.level}${day.future ? " future" : ""}`} aria-label={heatmapDayLabel(day)} />)}</ol>
      <div className="heatmap-legend" aria-hidden="true"><span>少</span>{[0, 1, 2, 3, 4].map((level) => <i key={level} className={`level-${level}`} />)}<span>多</span></div>
    </>}
  </section>;
}
```

Add required `heatmapDays`, `heatmapError`, and `onRetryHeatmap` props to `TrainingHome` and render `<LearningHeatmap>` after `<WeeklySummary>`. Keep the fixed bottom-nav clearance and existing iPhone gutters.

- [ ] **Step 4: Verify component, style and existing home tests**

Run: `npm test -- tests/components/learningHeatmap.test.tsx tests/components/mobileStyles.test.ts tests/components/trainingHome.test.tsx`

Expected: PASS with 84 cells and no changed training-entry behavior.

- [ ] **Step 5: Commit**

```bash
git add app/components/LearningHeatmap.tsx app/components/TrainingHome.tsx app/globals.css tests/components/learningHeatmap.test.tsx tests/components/mobileStyles.test.ts tests/components/trainingHome.test.tsx
git commit -m "feat: show compact learning heatmap"
```

### Task 5: Replace monolithic startup refresh with the home controller

**Files:**
- Modify: `app/PhraseBankApp.tsx`
- Modify: `tests/components/app.test.tsx`

- [ ] **Step 1: Add failing integration tests**

Extend `MemoryRepository` with call spies and assert:

```ts
render(<PhraseBankApp repository={repo} />);
await screen.findByRole("heading", { name: /今天/ });
expect(repo.exportSnapshot).not.toHaveBeenCalled();
expect(repo.listTrainingEvents).toHaveBeenCalledWith(expect.any(Date), expect.any(Date));
expect(screen.getByRole("region", { name: "最近 12 周学习足迹" })).toBeVisible();
```

Add a deferred initialization case that sees the home skeleton, a rejected range-read case that keeps the three training actions usable, and a retry case that restores the heatmap.

- [ ] **Step 2: Run and verify RED**

Run: `npm test -- tests/components/app.test.tsx`

Expected: FAIL because startup still calls `exportSnapshot()` and the heatmap is not wired.

- [ ] **Step 3: Refactor the app coordinator**

Use `useHomeData(repo)` for home state. Remove `trainingSessions` and `activeLearningSession` derivation from `exportSnapshot()`. Obtain active sessions from the bounded service. Replace the global `refresh()` with:

```ts
const home = useHomeData(repo);
const refreshHome = home.refresh;
const refreshLibrary = useCallback(async () => {
  if (!repo) return;
  const [phrases, categories, learningStates] = await Promise.all([
    repo.listPhrases(), repo.listCategories(), repo.listPhraseLearningStates(),
  ]);
  setLibraryData({ phrases, categories, learningStates });
}, [repo]);
```

The settings export button remains the only normal UI path that calls `repository.exportSnapshot()`. Navigation to library/settings loads their data; returning from a completed learning or training group calls `refreshHome()` best-effort after navigating home.

- [ ] **Step 4: Verify app integration**

Run: `npm test -- tests/components/app.test.tsx tests/hooks/useHomeData.test.tsx`

Expected: PASS; startup backup call count is zero, old review/learning/practice flows remain green.

- [ ] **Step 5: Commit**

```bash
git add app/PhraseBankApp.tsx tests/components/app.test.tsx
git commit -m "perf: avoid full snapshot on startup"
```

### Task 6: Dynamically load every non-home screen

**Files:**
- Create: `app/screens/LibraryScreen.tsx`
- Create: `app/screens/AddPhraseScreen.tsx`
- Create: `app/screens/SettingsScreen.tsx`
- Create: `app/screens/ReviewScreen.tsx`
- Create: `app/screens/LearningSessionScreen.tsx`
- Create: `app/screens/PracticeSessionScreen.tsx`
- Modify: `app/PhraseBankApp.tsx`
- Modify: `tests/components/app.test.tsx`
- Create: `tests/deployment/homePerformance.test.ts`

- [ ] **Step 1: Add failing lazy-boundary tests**

Mock each dynamic module with a deferred import and verify the home becomes interactive before any deferred screen resolves. Then click “句库”, assert the screen fallback appears, resolve the module, and assert the Library heading appears. Add a source/build contract test that rejects eager imports of the six screen modules from `PhraseBankApp.tsx`.

- [ ] **Step 2: Run and verify RED**

Run: `npm test -- tests/components/app.test.tsx tests/deployment/homePerformance.test.ts`

Expected: FAIL because non-home implementations are still in the eager app module.

- [ ] **Step 3: Extract focused screen modules**

Move each current screen implementation and its private helpers into the named module. Each file exports exactly one screen boundary. Preserve existing prop contracts and behavior; do not change storage or training semantics during extraction.

Use React lazy imports only in the coordinator:

```tsx
const LibraryScreen = lazy(() => import("./screens/LibraryScreen"));
const AddPhraseScreen = lazy(() => import("./screens/AddPhraseScreen"));
const SettingsScreen = lazy(() => import("./screens/SettingsScreen"));
const ReviewScreen = lazy(() => import("./screens/ReviewScreen"));
const LearningSessionScreen = lazy(() => import("./screens/LearningSessionScreen"));
const PracticeSessionScreen = lazy(() => import("./screens/PracticeSessionScreen"));

function ScreenFallback() {
  return <section className="screen-skeleton" aria-label="正在加载页面"><div className="pulse" /><p>正在准备…</p></section>;
}
```

Wrap the selected non-home screen in one `<Suspense fallback={<ScreenFallback />}>`. Do not lazy-load `TrainingHome`, `LearningHeatmap`, `Brand`, `AppIcon`, or the bottom navigation.

- [ ] **Step 4: Verify tests and production chunks**

Run: `npm test -- tests/components/app.test.tsx tests/deployment/homePerformance.test.ts && npm run build`

Expected: tests PASS; build succeeds and emits separate screen chunks. Record the main entry and total initial JS sizes in the audit README in Task 7.

- [ ] **Step 5: Commit**

```bash
git add app/screens app/PhraseBankApp.tsx tests/components/app.test.tsx tests/deployment/homePerformance.test.ts
git commit -m "perf: lazy load non-home screens"
```

### Task 7: Verify performance, resilience and iPhone layout

**Files:**
- Modify: `docs/audits/home-loading/README.md`
- Modify: `tests/deployment/homePerformance.test.ts`

- [ ] **Step 1: Create a repeatable 2,000-phrase fixture measurement**

Document the fixture generator seed, phrase count, event count, browser viewport and exact commands. Capture before/after values for HTML transfer size, initial JS transfer size, IndexedDB home-read duration, skeleton-to-home duration and number of startup repository calls.

- [ ] **Step 2: Add enforceable regression budgets**

The deployment test must parse the current production build manifest rather than hard-code a filename. Set budgets from the measured optimized build with no more than 15% headroom, and assert startup source does not contain `exportSnapshot()` in the home initialization path.

- [ ] **Step 3: Run the full automated verification**

Run:

```bash
npm test
npm run lint
npm run build
git diff --check
```

Expected: all tests PASS, lint exit 0, build exit 0, diff check clean.

- [ ] **Step 4: Perform visual and interaction QA**

At a true 390×844 CSS viewport verify: initial skeleton, loaded home, 84-cell heatmap, bottom-nav clearance, no horizontal scrolling, heatmap-only error and retry, Library lazy fallback, and return-to-home behavior. Repeat home and heatmap at 200% text zoom. Store screenshots and metrics under `docs/audits/home-loading/` and disclose whether the run is an emulator or real device.

- [ ] **Step 5: Compare deployed response after release**

After deployment, record three cold and three warm requests to `https://phrase.archdemy.com/`, including DNS, TLS, time-to-first-byte, total time and compressed bytes. Confirm container health and that the manifest remains `application/manifest+json`.

- [ ] **Step 6: Commit the evidence**

```bash
git add docs/audits/home-loading tests/deployment/homePerformance.test.ts
git commit -m "test: verify fast mobile home loading"
```

## Final review checklist

- The heatmap contains exactly 84 Monday-first cells and includes future blank cells for the rest of the current week.
- Counts are distinct `phraseId` values per Shanghai day, not event totals.
- Fixed level thresholds are 0, 1–2, 3–5, 6–9 and 10+.
- Home startup does not call `exportSnapshot()` or read unbounded training history.
- Existing data needs no migration and remains local to the device.
- Repository replacement, retry and unmount cannot commit stale home state.
- Heatmap failure cannot block training entry buttons.
- Non-home screens are absent from the eager home chunk.
- Full tests, lint, build, diff check, iPhone viewport QA and deployed timing evidence all pass before completion.
