# System Library Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate, validate, bundle, install, and browse a deterministic 600-core/2000-sentence system library while keeping personal content editable and prioritized.

**Architecture:** A deterministic offline generator expands reviewed bilingual scenario templates into a versioned JSON package, then an independent quality gate validates counts, quotas, hierarchy, exact duplicates, style metadata, and package integrity. The app installs the bundled package through the phase-one transactional repository and exposes a mobile dual-tab library; system rows are read-only and can be copied into personal content.

**Tech Stack:** TypeScript, JSON, Vitest, React, IndexedDB.

---

### Task 1: Offline content-agent protocol and quality gate
- [ ] Create `scripts/content-agent/catalog.ts`, `generator.ts`, and `qualityGate.ts` with six exact category quotas, A2–B2 metadata, deterministic stable IDs, 2–3 ordered examples, normalized duplicate checks, and exact total checks.
- [ ] Add `tests/contentAgent/generator.test.ts`; run it red before implementation, then green.
- [ ] Commit `feat: generate validated system phrase catalog`.

### Task 2: Publish the first 600/2000 package
- [ ] Add `scripts/generate-system-content.ts` and npm script `content:generate`.
- [ ] Generate `public/content/system-content-2026.08.1.json` with 600 core blocks and exactly 2000 total phrases.
- [ ] Add `tests/contentAgent/package.test.ts` to validate the checked-in artifact independently, including quotas, hierarchy, duplicate English, CEFR/category coverage, and deterministic regeneration.
- [ ] Commit `content: publish first system phrase library`.

### Task 3: Automatic bundled package installation
- [ ] Add `app/services/systemContentInstaller.ts` that fetches the bundled JSON, validates it, and calls the transactional repository only when its version differs.
- [ ] Invoke it during app initialization; an install failure must preserve the prior version and leave personal training usable with a nonblocking message.
- [ ] Add service and app integration tests, first red then green.
- [ ] Commit `feat: install bundled system library safely`.

### Task 4: Personal/system dual-tab library
- [ ] Refactor Library into default `我的句子` and `系统句库` tabs while preserving personal search/category/delete behavior.
- [ ] Add system category/subcategory/CEFR search filters, progress/locked indicators, read-only rows, and `复制到我的句子` creating a new personal ID.
- [ ] Add iPhone 390×844 component/style tests for 44px targets, wrapping, no horizontal overflow, and bounded list rendering.
- [ ] Commit `feat: browse personal and system phrase libraries`.

### Task 5: Verification and delivery
- [ ] Run `npm run content:generate` twice and compare artifact bytes.
- [ ] Run full tests, lint, build, and diff check.
- [ ] Verify personal CRUD remains isolated; system update keeps progress; 600/2000 and six quotas are exact; no Qwen key/client call exists.
- [ ] Merge to main, re-run full tests, push, and verify the GitHub deployment plus HTTPS endpoint.
