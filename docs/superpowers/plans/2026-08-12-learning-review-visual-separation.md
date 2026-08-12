# Learning and Review Visual Separation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the new-phrase learning screen and daily-review screen immediately distinguishable through labels, content rules, action copy, and separate warm/cool visual treatments.

**Architecture:** Keep the existing `useNewPhraseLearning` and `useTrainingSession` state machines unchanged. Add semantic task-mode markup to the two existing presentation components, then scope CSS to those markers so learning uses a warm orange language and review uses a cool green language without changing persistence, speech, scoring, or routing.

**Tech Stack:** React 19, TypeScript, CSS, Vitest, Testing Library.

---

### Task 1: Distinguish new-phrase study and test phases

**Files:**
- Modify: `app/components/NewPhraseLearning.tsx`
- Modify: `tests/components/newPhraseLearning.test.tsx`

- [ ] **Step 1: Write the failing semantic tests**

Add assertions to the existing study and test cases:

```tsx
expect(screen.getByText("新句学习 · 先学后测")).toBeVisible();
expect(screen.getByRole("button", { name: "我看懂了，下一句" })).toBeVisible();

expect(screen.getByText("新句学习 · 小测")).toBeVisible();
expect(screen.queryByText(controller.current!.english)).not.toBeInTheDocument();
expect(screen.getByRole("button", { name: "查看英文答案并自评" })).toBeVisible();
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm test -- --run tests/components/newPhraseLearning.test.tsx`

Expected: FAIL because the task labels and study action copy are absent.

- [ ] **Step 3: Add minimal learning-mode markup**

In `NewPhraseLearning`, render a phase-aware task label near the progress header:

```tsx
<span className="task-mode task-mode-learning">
  {controller.phase === "study" ? "新句学习 · 先学后测" : "新句学习 · 小测"}
</span>
```

Keep the study Chinese and English visible together. Change only the study advance button copy to `我看懂了，下一句`; keep the test reveal action `查看英文答案并自评`.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `npm test -- --run tests/components/newPhraseLearning.test.tsx`

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```text
git add app/components/NewPhraseLearning.tsx tests/components/newPhraseLearning.test.tsx
git commit -m "feat: label new phrase learning phases"
```

### Task 2: Make daily review explicitly Chinese-first

**Files:**
- Modify: `app/components/SpeakingPractice.tsx`
- Modify: `tests/components/speakingPractice.test.tsx`

- [ ] **Step 1: Write the failing review tests**

For the prompt phase, assert:

```tsx
expect(screen.getByText("今日复习 · 中文回忆")).toBeVisible();
expect(screen.getByText("英文答案已隐藏")).toBeVisible();
expect(screen.queryByText(phrase.english)).not.toBeInTheDocument();
expect(screen.getByRole("button", { name: "查看英文答案并自评" })).toBeVisible();
```

For the answer phase, assert the English answer and three grades remain visible.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm test -- --run tests/components/speakingPractice.test.tsx`

Expected: FAIL because the daily-review task label and hidden-answer notice are absent.

- [ ] **Step 3: Add minimal review-mode markup**

Add `task-mode task-mode-review` in the header, use `今日复习 · 中文回忆`, and render a non-answer hint only when `answered === false`:

```tsx
{!answered && <p className="review-hidden-answer">英文答案已隐藏</p>}
```

Rename the prompt action to `查看英文答案并自评`. Do not change grading, pause, finish, speech, or persistence callbacks.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `npm test -- --run tests/components/speakingPractice.test.tsx`

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```text
git add app/components/SpeakingPractice.tsx tests/components/speakingPractice.test.tsx
git commit -m "feat: clarify daily review recall mode"
```

### Task 3: Apply warm learning and cool review visual systems

**Files:**
- Modify: `app/globals.css`
- Modify: `tests/components/mobileStyles.test.ts`

- [ ] **Step 1: Write the failing CSS contract tests**

Assert the live selectors contain separate variables and accents:

```ts
expect(css).toMatch(/\.new-phrase-learning\s*\{[^}]*--task-accent:\s*#d86b4b/s);
expect(css).toMatch(/\.speaking-practice\s*\{[^}]*--task-accent:\s*#267453/s);
expect(css).toMatch(/\.task-mode-learning[^}]*background:/s);
expect(css).toMatch(/\.task-mode-review[^}]*background:/s);
expect(css).toMatch(/\.review-hidden-answer[^}]*border:/s);
```

- [ ] **Step 2: Run the CSS test and verify RED**

Run: `npm test -- --run tests/components/mobileStyles.test.ts`

Expected: FAIL because the task-mode selectors do not exist.

- [ ] **Step 3: Add scoped visual styles**

Set `--task-accent: #d86b4b` and a warm surface on `.new-phrase-learning`; set `--task-accent: #267453` and a cool surface on `.speaking-practice`. Use the variable for each progress fill and main action. Add pill styles for `.task-mode-learning` and `.task-mode-review`, plus a dashed, centered `.review-hidden-answer` notice. Preserve existing safe-area and bottom-reserve rules.

- [ ] **Step 4: Run component and CSS tests**

Run:

```text
npm test -- --run tests/components/newPhraseLearning.test.tsx tests/components/speakingPractice.test.tsx tests/components/mobileStyles.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```text
git add app/globals.css tests/components/mobileStyles.test.ts
git commit -m "style: separate learning and review task screens"
```

### Task 4: Verify the integrated behavior

**Files:**
- Test: `tests/components/newPhraseLearning.test.tsx`
- Test: `tests/components/speakingPractice.test.tsx`
- Test: `tests/components/app.test.tsx`
- Test: `tests/components/mobileStyles.test.ts`

- [ ] **Step 1: Run the relevant integrated suite**

Run:

```text
npm test -- --run tests/components/newPhraseLearning.test.tsx tests/components/speakingPractice.test.tsx tests/components/app.test.tsx tests/components/mobileStyles.test.ts
```

Expected: all tests PASS, including bilingual study, Chinese-only review before reveal, pause/resume, grading, and home routing.

- [ ] **Step 2: Run repository-wide verification**

Run:

```text
npm test
npm run lint
npm run build
git diff --check
```

Expected: tests, lint, production build, and whitespace checks all PASS.

- [ ] **Step 3: Review the final diff against scope**

Confirm production changes are limited to `NewPhraseLearning.tsx`, `SpeakingPractice.tsx`, and `globals.css`; confirm no changes to repositories, authentication, API routes, selection algorithms, grading, or session persistence.
