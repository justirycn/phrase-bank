# Starter Phrase Pack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Seed 40 useful intermediate daily-life and travel phrases exactly once without overwriting or duplicating user data.

**Architecture:** Keep starter content in a pure data module. Extend IndexedDB initialization with a versioned, atomic seed transaction that inserts only missing stable IDs and records completion after successful writes.

**Tech Stack:** TypeScript, IndexedDB via `idb`, Vitest, existing React/Vinext Sites app.

---

### Task 1: Define and validate the starter phrase pack

**Files:**
- Create: `app/storage/starterPhrases.ts`
- Create: `tests/storage/starterPhrases.test.ts`

- [ ] **Step 1: Write the failing content contract test**

```ts
expect(STARTER_PHRASES).toHaveLength(40);
expect(countByCategory(STARTER_PHRASES)).toEqual({ daily: 24, travel: 12, social: 4 });
expect(STARTER_PHRASES.every(p => p.id.startsWith("starter-") && p.english.trim() && p.chinese.trim() && p.personalExample.trim())).toBe(true);
expect(new Set(STARTER_PHRASES.map(p => p.id)).size).toBe(40);
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm test -- tests/storage/starterPhrases.test.ts`

Expected: FAIL because `starterPhrases.ts` does not exist.

- [ ] **Step 3: Add the 40 typed phrase definitions**

Create `StarterPhrase` as `{ id, english, chinese, categoryId, personalExample }` and export exactly 24 `daily`, 12 `travel`, and 4 `social` records with stable IDs.

- [ ] **Step 4: Run the content test**

Run: `npm test -- tests/storage/starterPhrases.test.ts`

Expected: PASS.

### Task 2: Seed the phrase pack once and preserve user data

**Files:**
- Modify: `app/storage/indexedDbRepository.ts`
- Modify: `tests/storage/repository.test.ts`

- [ ] **Step 1: Write failing repository tests**

```ts
expect(await repo.listPhrases()).toHaveLength(40);
await repo.initialize();
expect(await repo.listPhrases()).toHaveLength(40);
await repo.deletePhrase("starter-daily-not-sure");
await repo.initialize();
expect(await repo.getPhrase("starter-daily-not-sure")).toBeUndefined();
```

Also preinsert a same-ID customized phrase before initialization and assert its text and review progress remain unchanged.

- [ ] **Step 2: Run the repository tests and verify they fail**

Run: `npm test -- tests/storage/repository.test.ts`

Expected: FAIL because initialization currently seeds only categories.

- [ ] **Step 3: Implement versioned transactional initialization**

Inside one read-write transaction for `categories`, `phrases`, and `metadata`: seed missing categories; if `starterPhrasesVersion !== "1"`, convert starter definitions into normal `Phrase` records using the same initialization timestamp, skip existing IDs, then set `starterPhrasesVersion` to `"1"`. Keep the existing database schema version because no store or index changes.

- [ ] **Step 4: Run repository and complete tests**

Run: `npm test -- tests/storage/repository.test.ts && npm test`

Expected: all tests PASS.

### Task 3: Build, publish, and verify

**Files:**
- Modify only files required by build or deployment failures.

- [ ] **Step 1: Run production verification**

Run: `npm test && npm run build`

Expected: all tests pass and the build exits 0.

- [ ] **Step 2: Commit and publish the exact validated source**

```bash
git add app tests docs
git commit -m "feat: seed starter phrase pack"
```

Push the branch head, package the validated build, save a new Sites version, and deploy it to the existing public site.

- [ ] **Step 3: Verify deployment**

Poll deployment status until `succeeded`, then open the existing production URL.

## Plan self-review

- Covers content counts, required fields, stable IDs, first-run review readiness, idempotency, deletion persistence, existing-record protection, transaction safety, backup compatibility, tests, and deployment.
- Uses `daily`, `travel`, and `social`, matching existing category IDs.
- No schema migration or user-interface change is required.
