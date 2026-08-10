# Content & Learning Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the versioned system-content, personal-priority, sequential example-unlock, and backup foundation required before generating the 600-core/2000-sentence library.

**Architecture:** Phrase content gains explicit origin and hierarchy metadata, while durable learning state lives in a separate IndexedDB store keyed by phrase ID. A validated, versioned system package is installed transactionally and retained for rollback; review submission atomically updates scheduling, distinct Shanghai mastery dates, and the next example unlock. Backup v3 carries the content/version/progress state while v1/v2 imports normalize existing phrases as personal standalone content.

**Tech Stack:** TypeScript, React, IndexedDB via `idb`, Vitest, fake-indexeddb.

---

### Task 1: Domain contracts and package validation

**Files:**
- Modify: `app/domain/types.ts`
- Create: `app/domain/systemContent.ts`
- Test: `tests/domain/systemContent.test.ts`

- [ ] **Step 1: Write failing tests** for valid core/example packages, duplicate IDs, missing parents, non-contiguous unlock order, invalid CEFR, and personal phrase defaults.
- [ ] **Step 2: Run** `npm test -- tests/domain/systemContent.test.ts` and confirm failures are caused by missing contracts/validator.
- [ ] **Step 3: Implement** `PhraseOrigin`, `PhraseKind`, `CefrLevel`, `PhraseLearningState`, `SystemContentPackage`, content metadata on `Phrase`, `personalPhraseDefaults()`, and `validateSystemContentPackage()` returning a normalized package or throwing a Chinese validation error.
- [ ] **Step 4: Re-run** the focused test and confirm all cases pass.
- [ ] **Step 5: Commit** with `feat: define versioned system content contracts`.

### Task 2: IndexedDB v3 migration and versioned package lifecycle

**Files:**
- Modify: `app/storage/repository.ts`
- Modify: `app/storage/indexedDbRepository.ts`
- Test: `tests/storage/repository.test.ts`

- [ ] **Step 1: Write failing repository tests** proving v2-to-v3 migration preserves every existing record and normalizes legacy phrases as `personal/standalone`, creates `phraseLearningState` and `systemContentPackages`, installs a package atomically, remains idempotent, retires removed system content without deleting history, never overwrites personal IDs, and rolls back to a retained version.
- [ ] **Step 2: Run** `npm test -- tests/storage/repository.test.ts` and verify the new tests fail against schema v2.
- [ ] **Step 3: Upgrade** the database to v3; add phrase indexes for origin and parent; add repository methods `listPhraseLearningStates`, `getActiveSystemContentVersion`, `installSystemContentPackage`, and `rollbackSystemContentPackage`.
- [ ] **Step 4: Implement transactional installation** across categories, phrases, metadata, package history, and learning state; validate before opening the write transaction; preserve schedule/progress for stable IDs; reject collisions with personal content; mark removed system phrases retired.
- [ ] **Step 5: Re-run** repository tests and confirm migration/install/rollback pass.
- [ ] **Step 6: Commit** with `feat: install versioned system content packages`.

### Task 3: Personal-priority and unlocked-content selection

**Files:**
- Modify: `app/domain/trainingSelection.ts`
- Modify: `app/hooks/useTrainingSession.ts`
- Test: `tests/domain/trainingSelection.test.ts`
- Test: `tests/hooks/useTrainingSession.test.tsx`

- [ ] **Step 1: Write failing selector tests** for personal-first due ties, ungraduated personal priority, five-new-personal daily cap, locked-example exclusion, three-new-system daily cap, system fallback, no duplicate IDs, and today-practiced fallback.
- [ ] **Step 2: Run** the two focused suites and confirm failures describe the old global-new selector.
- [ ] **Step 3: Extend selection options** with learning-state lookup and separate persisted personal/system daily counts; filter retired/locked content and fill quick/standard groups in the approved priority order.
- [ ] **Step 4: Update session initialization** to load learning state and derive distinct new personal/system phrase IDs from persisted events using Asia/Shanghai dates, then pass safe maxima to the selector.
- [ ] **Step 5: Re-run** focused suites and confirm the priority/caps pass without regressing quick rotation.
- [ ] **Step 6: Commit** with `feat: prioritize personal speaking inventory`.

### Task 4: Atomic mastery dates and sequential example unlock

**Files:**
- Modify: `app/storage/indexedDbRepository.ts`
- Create: `app/domain/learningProgress.ts`
- Test: `tests/domain/learningProgress.test.ts`
- Test: `tests/storage/repository.test.ts`

- [ ] **Step 1: Write failing tests** proving good reviews count once per Asia/Shanghai date, personal priority graduates only after two dates, core mastery unlocks only example 1, example mastery unlocks only its next sibling, and again/hard never unlock.
- [ ] **Step 2: Run** focused tests and verify failures come from absent progress transitions.
- [ ] **Step 3: Implement** a pure learning-state transition using a fixed Asia/Shanghai date formatter and a deterministic next-unlock decision.
- [ ] **Step 4: Expand both review transactions** so phrase scheduling, review log/event, learning-state update, and next-example unlock commit or roll back together; preserve event-ID idempotency.
- [ ] **Step 5: Re-run** focused tests including simulated transaction failures.
- [ ] **Step 6: Commit** with `feat: unlock system examples by durable mastery`.

### Task 5: Backup v3 and backward compatibility

**Files:**
- Modify: `app/domain/types.ts`
- Modify: `app/storage/backup.ts`
- Modify: `app/storage/indexedDbRepository.ts`
- Modify: `app/storage/repository.ts`
- Test: `tests/storage/backup.test.ts`
- Test: `tests/storage/repository.test.ts`

- [ ] **Step 1: Write failing tests** for v3 export/import of content metadata, active package version, learning state and unlocks; v1/v2 normalization; invalid progress references/dates; and overwrite/skip behavior.
- [ ] **Step 2: Run** backup/storage suites and confirm the v3 expectations fail.
- [ ] **Step 3: Add** `BackupEnvelopeV3`; parse v1/v2 into a normalized v3; validate complete origin/hierarchy/progress relationships; export/import all v3 stores in one consistent transaction.
- [ ] **Step 4: Re-run** focused tests and verify old backup fixtures still import.
- [ ] **Step 5: Commit** with `feat: preserve content learning state in backups`.

### Task 6: Integration verification and delivery

**Files:**
- Modify only files required by verified failures.

- [ ] **Step 1: Run** `npm test` and fix only reproducible regressions with a failing test first.
- [ ] **Step 2: Run** `npm run lint`, `npm run build`, and `git diff --check`.
- [ ] **Step 3: Review** the approved design section-by-section: origin separation, package validation/version/rollback, daily 5/3 caps, two Shanghai mastery dates, sequential unlock, atomicity, and v1/v2 backup migration.
- [ ] **Step 4: Confirm** no UI for the 600-item library and no Qwen API call was added in phase one.
- [ ] **Step 5: Commit** any verification-only fixes, then integrate and deploy only after the complete suite is green.
