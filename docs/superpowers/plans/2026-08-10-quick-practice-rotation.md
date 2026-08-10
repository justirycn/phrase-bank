# Quick Practice Rotation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prefer phrases not yet practiced today while preserving scheduling priorities and safe backfill.

**Architecture:** Extend the pure selector with an optional set of phrase IDs practiced today. Partition every source pool into fresh-today and practiced-today candidates, apply the existing allocation to fresh candidates first, then reuse the current reviewed/new backfill rules across excluded candidates only when capacity remains. Derive the set from the session initialization event snapshot in Asia/Shanghai.

**Tech Stack:** TypeScript, React hooks, Vitest.

---

### Task 1: Add today-aware domain selection

- [ ] Add failing tests to `tests/domain/trainingSelection.test.ts` for fresh preference and shortage backfill.
- [ ] Add `practicedTodayIds?: ReadonlySet<string>` to `TrainingSelectionOptions` and implement stable pool partitioning in `app/domain/trainingSelection.ts`.
- [ ] Run the focused domain tests and commit.

### Task 2: Wire persisted daily events into session creation

- [ ] Add a failing hook test that completes a first quick group and creates a second group on the same Shanghai day with different IDs when alternatives exist.
- [ ] In `app/hooks/useTrainingSession.ts`, derive practiced IDs from the already-loaded events and pass them to `selectTrainingGroup`.
- [ ] Run hook/domain tests, then full tests, lint, and production build.
- [ ] Commit, merge to main, push, monitor deployment, and verify public HTTPS 200.
