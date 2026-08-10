# Practice Action Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the prompt action tray as a two-column secondary row followed by one full-width primary action.

**Architecture:** Add one semantic wrapper around the two secondary actions and use scoped CSS for its grid and internal icon alignment. Keep every existing controller callback unchanged.

**Tech Stack:** React, TypeScript, CSS, Vitest, Testing Library.

---

### Task 1: Add the action hierarchy

**Files:**
- Modify: `tests/components/speakingPractice.test.tsx`
- Modify: `app/components/SpeakingPractice.tsx`
- Modify: `tests/components/mobileStyles.test.ts`
- Modify: `app/globals.css`

- [ ] Write failing component and CSS tests for `.prompt-secondary-actions`, its two buttons, and the full-width `.self-assessment-action`.
- [ ] Run `npm test -- tests/components/speakingPractice.test.tsx tests/components/mobileStyles.test.ts` and confirm the new assertions fail for the old stacked layout.
- [ ] Wrap the unknown and pronunciation actions in `.prompt-secondary-actions`; keep self assessment as the following sibling.
- [ ] Add a two-column grid, centered icon-label flex layout, 44px targets, and forest primary styling for self assessment.
- [ ] Re-run the focused tests and confirm they pass.
- [ ] Run `npm test && npm run lint && npm run build`.
- [ ] Commit the scoped files, merge to `main`, push `github main`, and verify the deployment workflow plus public HTTPS 200.
