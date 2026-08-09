# iPhone Safari Speech Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make native English pronunciation reliable in iPhone Safari, align the answer-toolbar icons with their labels, and temporarily remove microphone recording from the training UI.

**Architecture:** Harden the existing `BrowserSpeechService` with an early voice cache and `voiceschanged` refresh, then remove the asynchronous preference lookup from the user-gesture playback path by caching preferences in the training controller. Keep speech optional and non-blocking. Fix the toolbar using scoped CSS only.

**Tech Stack:** TypeScript, React hooks, Web Speech API, Vitest, Testing Library, CSS.

---

### Task 0: Temporarily remove recording from the training UI

**Files:**
- Modify: `tests/components/speakingPractice.test.tsx`
- Modify: `app/components/SpeakingPractice.tsx`

- [ ] **Step 1: Replace recording interaction tests with a failing disabled-recording contract**

Assert that prompt mode has no microphone/record button, always shows `查看答案并自评`, clicking it invokes `revealForSelfAssessment`, and `startRecording` is never called.

- [ ] **Step 2: Run the component test and verify RED**

Run: `npm test -- tests/components/speakingPractice.test.tsx`

Expected: FAIL because the recording button still exists and self-assessment is only shown after microphone failure.

- [ ] **Step 3: Remove recording-only component state and handlers**

Delete the microphone state, refs, press/keyboard handlers, recording status UI, microphone fallback class, and record button from `SpeakingPractice`. Always render a `查看答案并自评` button in prompt mode. Keep the controller recording API and answer playback compatibility unchanged.

- [ ] **Step 4: Run the component test and verify GREEN**

Run: `npm test -- tests/components/speakingPractice.test.tsx`

Expected: all active prompt, answer, recovery, and completion tests PASS without a microphone request.

- [ ] **Step 5: Commit**

```bash
git add app/components/SpeakingPractice.tsx tests/components/speakingPractice.test.tsx docs/superpowers/specs/2026-08-09-iphone-safari-speech-design.md docs/superpowers/plans/2026-08-09-iphone-safari-speech.md
git commit -m "feat: pause speaking practice recording"
```

### Task 1: Cache and explicitly bind Safari voices

**Files:**
- Modify: `tests/services/speech.test.ts`
- Modify: `app/services/speech.ts`

- [ ] **Step 1: Write failing voice-cache tests**

Add tests proving that a service created while `getVoices()` is empty listens for `voiceschanged`, caches the later English voice, assigns it to the utterance, and rejects with `英文语音尚未准备好，请稍后再试` when no English voice exists.

```ts
it("uses an English voice that arrives through voiceschanged", async () => {
  let voices: SpeechSynthesisVoice[] = [];
  let onVoicesChanged: EventListener | undefined;
  const synthesis = {
    getVoices: vi.fn(() => voices),
    addEventListener: vi.fn((name: string, listener: EventListener) => {
      if (name === "voiceschanged") onVoicesChanged = listener;
    }),
    cancel: vi.fn(),
    speak: vi.fn((utterance: SpeechSynthesisUtterance) => utterance.onend?.({} as SpeechSynthesisEvent)),
  };
  vi.stubGlobal("speechSynthesis", synthesis);
  vi.stubGlobal("SpeechSynthesisUtterance", Utterance);
  const service = new BrowserSpeechService();
  voices = [voice("en-US", "Samantha")];
  onVoicesChanged?.(new Event("voiceschanged"));
  await service.speak("Hello", "en-US");
  expect(synthesis.speak.mock.calls[0][0].voice).toBe(voices[0]);
});
```

- [ ] **Step 2: Run the focused service test and verify RED**

Run: `npm test -- tests/services/speech.test.ts`

Expected: FAIL because the service does not subscribe to `voiceschanged` and still speaks with a null voice.

- [ ] **Step 3: Implement the minimal cache**

Add a constructor and refresh method, use the cache for both `listVoices()` and `speak()`, and reject before calling `synthesis.speak()` when no English voice can be selected.

```ts
private voices: SpeechSynthesisVoice[] = [];

constructor() {
  const synthesis = globalThis.speechSynthesis;
  if (!synthesis) return;
  this.refreshVoices();
  synthesis.addEventListener?.("voiceschanged", this.refreshVoices);
}

private refreshVoices = () => {
  if (typeof globalThis.speechSynthesis !== "undefined") {
    const available = globalThis.speechSynthesis.getVoices();
    if (available.length > 0) this.voices = available;
  }
};
```

In `speak`, refresh once, select from `this.voices`, reject with the Chinese readiness message when absent, and always assign `utterance.voice` when speaking.

- [ ] **Step 4: Run the focused service tests and verify GREEN**

Run: `npm test -- tests/services/speech.test.ts`

Expected: all speech service tests PASS.

- [ ] **Step 5: Commit**

```bash
git add app/services/speech.ts tests/services/speech.test.ts
git commit -m "fix: prepare Safari English voices"
```

### Task 2: Preserve the iOS user-gesture playback path

**Files:**
- Modify: `tests/hooks/useTrainingSession.test.tsx`
- Modify: `app/hooks/useTrainingSession.ts`

- [ ] **Step 1: Write a failing synchronous-trigger regression**

Create a deferred `getSpeechPreferences()` and assert that `revealForSelfAssessment()` invokes `speech.speak()` before that deferred repository read is released. Also verify loaded preferences still control accent and auto-speak.

```ts
it("starts auto speech from cached preferences without waiting inside the reveal gesture", async () => {
  const store = createStore();
  const speech = { speak: vi.fn(() => new Promise<void>(() => {})), cancel: vi.fn() };
  const { result } = renderHook(() => useTrainingSession({
    repository: store.repository,
    mode: "quick",
    speech,
    recorder: createRecorder(),
    seed: "ios-gesture",
  }));
  await waitFor(() => expect(result.current.current).toBeDefined());
  act(() => { void result.current.revealForSelfAssessment(); });
  expect(speech.speak).toHaveBeenCalledWith(result.current.current?.phrase.english, "en-US");
});
```

- [ ] **Step 2: Run the hook test and verify RED**

Run: `npm test -- tests/hooks/useTrainingSession.test.tsx`

Expected: FAIL because `speakCurrent` and `autoSpeakCurrent` await `repository.getSpeechPreferences()` before calling `speech.speak()`.

- [ ] **Step 3: Cache preferences during session initialization**

Add a ref initialized to the approved defaults and load it as part of the existing initialization data fetch.

```ts
const speechPreferencesRef = useRef<SpeechPreferences>({ accent: "en-US", autoSpeak: true });
```

Update `speakCurrent` and `autoSpeakCurrent` so the call to `speech.speak()` happens without an earlier `await`:

```ts
const speakCurrent = useCallback(() => {
  const current = queueRef.current[indexRef.current];
  if (!current) return Promise.resolve();
  return speech.speak(current.phrase.english, speechPreferencesRef.current.accent);
}, [speech]);

const autoSpeakCurrent = useCallback(() => {
  if (!speechPreferencesRef.current.autoSpeak) return;
  const current = queueRef.current[indexRef.current];
  if (current) void speech.speak(current.phrase.english, speechPreferencesRef.current.accent).catch(() => undefined);
}, [speech]);
```

Retain current cancellation, non-blocking error handling, and training persistence behavior.

- [ ] **Step 4: Run hook and speech tests and verify GREEN**

Run: `npm test -- tests/hooks/useTrainingSession.test.tsx tests/services/speech.test.ts`

Expected: both files PASS, including stalled-speech and cancellation regressions.

- [ ] **Step 5: Commit**

```bash
git add app/hooks/useTrainingSession.ts tests/hooks/useTrainingSession.test.tsx
git commit -m "fix: keep Safari speech in user gesture"
```

### Task 3: Align answer icons and labels

**Files:**
- Modify: `tests/components/mobileStyles.test.ts`
- Modify: `app/globals.css`

- [ ] **Step 1: Write the failing CSS contract test**

```ts
it("centers answer toolbar icons with their labels", async () => {
  const css = await readFile("app/globals.css", "utf8");
  const rule = css.match(/\.answer-tools button\s*\{([^}]*)\}/)?.[1] ?? "";
  expect(rule).toMatch(/display:flex/);
  expect(rule).toMatch(/align-items:center/);
  expect(rule).toMatch(/justify-content:center/);
  expect(rule).toMatch(/gap:7px/);
  expect(rule).toMatch(/min-height:44px/);
});
```

- [ ] **Step 2: Run the style test and verify RED**

Run: `npm test -- tests/components/mobileStyles.test.ts`

Expected: FAIL because `.answer-tools button` has no explicit internal layout.

- [ ] **Step 3: Add the scoped mobile-safe layout**

```css
.answer-tools button {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  min-height: 44px;
  white-space: nowrap;
}

.answer-tools button svg {
  flex: 0 0 auto;
}
```

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `npm test -- tests/components/mobileStyles.test.ts tests/components/speakingPractice.test.tsx`

Expected: both files PASS.

- [ ] **Step 5: Run final verification**

Run: `npm test && npm run lint && npm run build`

Expected: all tests PASS, lint exits 0, production build exits 0.

- [ ] **Step 6: Commit**

```bash
git add app/globals.css tests/components/mobileStyles.test.ts
git commit -m "fix: align speaking answer controls"
```

### Task 4: Integrate, deploy, and verify the device path

**Files:**
- No production file changes expected.

- [ ] **Step 1: Review the complete branch diff**

Run: `git diff --check main...HEAD && git diff --stat main...HEAD`

Expected: only the design/plan and scoped speech, hook, CSS, and test files are changed; diff check is clean.

- [ ] **Step 2: Merge the branch into main without touching user-owned planning files**

Run from the primary workspace: `git merge --no-ff fix/iphone-safari-speech`

Expected: merge succeeds and `findings.md`, `progress.md`, and `task_plan.md` remain unstaged and unchanged.

- [ ] **Step 3: Push main and monitor deployment**

Run: `git push origin main` and inspect the corresponding GitHub Actions deployment until it succeeds.

- [ ] **Step 4: Verify public availability**

Request `https://phrase.archdemy.com/` and confirm final HTTP 200 over HTTPS.

- [ ] **Step 5: Ask for real iPhone Safari confirmation**

On iPhone Safari, reopen the page, enter a practice item, reveal the answer, and tap “再听标准发音”. Confirm audible English and visually centered icon-label pairs. This is the final acceptance because desktop automation cannot emulate installed iOS voices and audio routing.
