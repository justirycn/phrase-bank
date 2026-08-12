# Fixed Accounts and Cloud Progress Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Protect Phrase Bank with administrator-created accounts and store each account's phrases and learning progress in a persistent server-side SQLite database.

**Architecture:** Vinext route handlers expose same-origin authentication and a whitelisted repository RPC API. A server-only SQLite repository scopes every user-owned record by the authenticated user ID; the browser uses a `CloudPhraseRepository` implementing the existing `PhraseRepository`, so training UI remains unchanged. A signed opaque session cookie lasts 30 days and local IndexedDB is never initialized after this change.

**Tech Stack:** Vinext route handlers, React, Node 22 `node:sqlite`, Node `crypto.scrypt`, Vitest, Docker Compose persistent volume.

---

### Task 1: SQLite accounts, sessions, and user-scoped storage

**Files:**
- Create: `app/server/database.ts`
- Create: `app/server/passwords.ts`
- Create: `app/server/authStore.ts`
- Create: `tests/server/authStore.test.ts`

- [ ] Write tests using a temporary SQLite file that prove password hashes differ from plaintext, valid/invalid login, 30-day expiry, logout, disabled-account rejection, duplicate username rejection, and one user's session cannot resolve as another user.
- [ ] Run `npm test -- tests/server/authStore.test.ts` and verify RED because the server modules do not exist.
- [ ] Implement schema creation for `users`, `sessions`, `user_documents`, and login-attempt throttling. Use `scrypt` with a random 16-byte salt and store only the hash/salt. Hash opaque 32-byte session tokens before persistence.
- [ ] Add `withUserDocument(userId, mutation)` that reads, validates, mutates, and writes one user's versioned JSON document inside a SQLite transaction; it must never accept a client-supplied user ID.
- [ ] Re-run the focused tests and commit `feat: add fixed account storage`.

### Task 2: Authentication HTTP boundary

**Files:**
- Create: `app/api/auth/login/route.ts`
- Create: `app/api/auth/session/route.ts`
- Create: `app/api/auth/logout/route.ts`
- Create: `app/server/httpAuth.ts`
- Create: `tests/server/authRoutes.test.ts`

- [ ] Write direct route-handler tests for successful login, uniform invalid-credential errors, rate limiting, secure 30-day cookie attributes, session lookup, logout, expired/disabled sessions, invalid JSON, and request-size limits.
- [ ] Run the focused test and verify RED because the handlers do not exist.
- [ ] Implement the three handlers. Cookie name is `phrase_session`; set `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, `Max-Age=2592000`. Return only `{ user: { username } }`; never return token hashes, salts, database paths, or SQL errors.
- [ ] Re-run the focused tests and commit `feat: add account sessions`.

### Task 3: User-scoped cloud repository

**Files:**
- Create: `app/server/cloudData.ts`
- Create: `app/api/repository/route.ts`
- Create: `app/storage/cloudRepository.ts`
- Create: `tests/server/cloudData.test.ts`
- Create: `tests/storage/cloudRepository.test.ts`

- [ ] Write server tests proving two users can write the same record IDs without collision, personal phrases are private, bundled system phrases are visible to both, learning states/settings/events/sessions are isolated, review and first-learning review operations are atomic, and unauthenticated calls return 401.
- [ ] Write client tests proving every existing `PhraseRepository` method maps to the whitelisted endpoint, dates serialize correctly, 401 raises a typed authentication error, and no IndexedDB API is touched.
- [ ] Run both focused suites and verify RED.
- [ ] Implement a strict operation whitelist. Store the complete user-owned repository document in `user_documents` for the deliberately small 2–3-user deployment, merge immutable bundled system content on reads, and serialize each mutation through one SQLite transaction so compound reviews remain atomic.
- [ ] Implement `CloudPhraseRepository`; it sends credentials on same-origin JSON requests and exposes the unchanged `PhraseRepository` interface.
- [ ] Re-run focused tests and commit `feat: store phrase progress in cloud accounts`.

### Task 4: Login screen and application wiring

**Files:**
- Create: `app/components/LoginScreen.tsx`
- Create: `app/AuthPhraseBankApp.tsx`
- Modify: `app/page.tsx`
- Modify: `app/PhraseBankApp.tsx`
- Modify: `app/components/screens/SettingsScreen.tsx`
- Modify: `app/globals.css`
- Create: `tests/components/login.test.tsx`
- Modify: `tests/components/app.test.tsx`

- [ ] Write component tests proving first load shows login, successful login mounts `PhraseBankApp` with `CloudPhraseRepository`, invalid login remains on the form, session restore works, 401 returns to login, logout removes protected UI, and `LocalPhraseRepository`/IndexedDB are never initialized.
- [ ] Run focused tests and verify RED.
- [ ] Implement the minimal accessible login form and auth boundary. Remove the browser-created default `LocalPhraseRepository`; require a repository prop in production wiring. Add username display and logout to Settings.
- [ ] Keep all existing repository-injected component tests working without requiring HTTP auth.
- [ ] Run focused tests and commit `feat: require login for phrase bank`.

### Task 5: Account CLI, persistent deployment, and release verification

**Files:**
- Create: `scripts/manage-account.ts`
- Modify: `package.json`
- Modify: `compose.yaml`
- Modify: `.github/workflows/deploy.yml`
- Create: `docs/runbooks/account-and-cloud-data.md`
- Create: `tests/deployment/cloudAuth.test.ts`

- [ ] Write deployment tests proving the app mounts a named data volume, `PHRASE_DB_PATH` points inside it, no password appears in Compose/workflow, and account commands cover create/reset/disable/enable/list without accepting a password command-line argument.
- [ ] Run the focused deployment test and verify RED.
- [ ] Implement an interactive account command that reads passwords without echoing them. Add `account:create`, `account:reset`, `account:disable`, `account:enable`, and `account:list` scripts.
- [ ] Mount `phrase_data:/app/data` and set `PHRASE_DB_PATH=/app/data/phrase-bank.sqlite`. Update deployment health verification to confirm the unauthenticated session endpoint and login page respond without exposing protected data.
- [ ] Document exact non-technical commands for creating the initial 2–3 accounts, backing up SQLite, restoring it, and disabling an account.
- [ ] Run `npm test`, `npm run lint`, `npm run build`, and `git diff --check`; then deploy and verify login, account isolation, logout, persistence after container restart, HTTPS cookie behavior, and no local-data migration.
- [ ] Commit `feat: deploy fixed accounts and cloud progress`.
