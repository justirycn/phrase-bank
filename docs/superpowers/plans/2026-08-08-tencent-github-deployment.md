# Tencent GitHub Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically test and deploy Phrase Bank from GitHub `main` to the Ubuntu Tencent Cloud server at `43.153.204.17`.

**Architecture:** Package the app as a Node 22 Docker image managed by Docker Compose. A GitHub Actions workflow validates every push, then connects over a dedicated SSH key, pulls the public repository, builds the new image, replaces the container only after a successful build, and checks HTTP health.

**Tech Stack:** GitHub Actions, Docker Engine, Docker Compose, Node.js 22, Vinext, Ubuntu 22.04, SSH.

---

### Task 1: Define deployment configuration contracts

**Files:**
- Create: `tests/deployment/config.test.ts`
- Create: `Dockerfile`
- Create: `.dockerignore`
- Create: `compose.yaml`
- Create: `.github/workflows/deploy.yml`

- [ ] **Step 1: Write a failing deployment configuration test**

The test reads repository files and asserts: Docker uses Node 22 and a non-root runtime user; Compose maps `80:3000`, uses `restart: unless-stopped`, and defines an HTTP health check; workflow triggers on `main`, runs `npm test` before deploy, references only `TENCENT_HOST`, `TENCENT_USER`, and `TENCENT_SSH_KEY`, enables strict host checking, builds before `up -d`, and checks `127.0.0.1`.

- [ ] **Step 2: Run the test and verify failure**

Run: `npm test -- tests/deployment/config.test.ts`

Expected: FAIL because deployment files do not exist.

- [ ] **Step 3: Add minimal Docker and Compose files**

Use `node:22-bookworm-slim`; run `npm ci`, tests, and build in the builder stage. Copy the app and dependencies to the runtime stage, switch to `node`, expose 3000, and run `npm run start -- --hostname 0.0.0.0`. Compose names the service `phrase-bank`, maps `80:3000`, and checks `http://127.0.0.1:3000/`.

- [ ] **Step 4: Add the workflow**

The CI job uses checkout and setup-node, then `npm ci`, `npm test`, and `npm run build`. The deploy job writes the SSH key with mode 600, scans the configured host into `known_hosts`, and runs one remote script that clones/pulls `/opt/phrase-bank`, executes `sudo docker compose build`, `sudo docker compose up -d`, and retries local HTTP health.

- [ ] **Step 5: Run the deployment test and full suite**

Run: `npm test -- tests/deployment/config.test.ts && npm test`

Expected: all tests PASS.

### Task 2: Validate the container locally

**Files:**
- Modify only files required by observed build/runtime failures.

- [ ] **Step 1: Build the Docker image where Docker is available**

Run: `docker compose build`

Expected: image build exits 0 after tests and Vinext production build.

- [ ] **Step 2: Start and probe the container**

Run: `docker compose up -d` followed by an HTTP request to the mapped port.

Expected: response status 200 and page contains `Phrase Bank`.

- [ ] **Step 3: Stop only the test container**

Run: `docker compose down`

Expected: test container and network stop; named or external user data is untouched.

### Task 3: Configure dedicated server deployment access

**Files:**
- Create locally outside repository: dedicated ED25519 key pair.
- Modify remotely: `/home/ubuntu/.ssh/authorized_keys`.

- [ ] **Step 1: Generate a dedicated key without overwriting existing keys**

Use the explicit path `~/.ssh/id_ed25519_phrase_bank_actions`. Abort if it already exists.

- [ ] **Step 2: Add only the public key on the server**

Append after exact duplicate detection, then set `.ssh` to 700 and `authorized_keys` to 600.

- [ ] **Step 3: Verify key-only login**

Run SSH with `BatchMode=yes`, `IdentitiesOnly=yes`, and the dedicated key.

Expected: `whoami` returns `ubuntu` without a password prompt.

### Task 4: Prepare Ubuntu for Docker deployment

**Files:**
- Modify remote package state and `/opt/phrase-bank`.

- [ ] **Step 1: Install Docker from the official Docker apt repository**

Install prerequisites, repository signing key, Docker Engine, Buildx, and Compose plugin. Do not run the convenience script.

- [ ] **Step 2: Verify services and versions**

Run `sudo systemctl is-active docker`, `sudo docker version`, and `sudo docker compose version`.

Expected: Docker is active and both commands report versions.

- [ ] **Step 3: Prepare the app directory and firewall**

Create `/opt/phrase-bank` owned by `ubuntu`. If UFW is active, allow `80/tcp`; otherwise leave it unchanged.

### Task 5: Configure GitHub Secrets and trigger deployment

**Files:**
- Modify GitHub repository Actions secrets through the authenticated web UI.

- [ ] **Step 1: Open the Actions secrets page**

Create `TENCENT_HOST=43.153.204.17` and `TENCENT_USER=ubuntu`.

- [ ] **Step 2: Add the private key securely**

Copy the dedicated private key through a local secure UI, paste it into `TENCENT_SSH_KEY`, and never emit it in chat or repository files.

- [ ] **Step 3: Commit and push validated deployment configuration**

Run full tests and build, commit the exact source, then push to GitHub `main` to trigger the workflow.

- [ ] **Step 4: Inspect the workflow result**

Use the GitHub Actions page. If it fails, capture the exact failed step and logs without exposing Secrets; apply systematic debugging before any fix.

### Task 6: Verify production and document handoff

**Files:**
- Update: `progress.md`, `findings.md`, `task_plan.md`.

- [ ] **Step 1: Verify server-local HTTP**

Run: `curl --fail http://127.0.0.1/`

Expected: response contains Phrase Bank HTML.

- [ ] **Step 2: Verify public HTTP**

Request `http://43.153.204.17/` from outside the server.

Expected: status 200. If local succeeds and public fails, instruct the user to allow inbound TCP 80 in Tencent Cloud security group.

- [ ] **Step 3: Verify automatic restart state**

Inspect `docker compose ps` and restart policy; do not reboot the server solely for testing.

- [ ] **Step 4: Security handoff**

Advise the user to rotate the password previously shared in chat. Confirm future code pushes to `main` trigger deployment and client-local data remains on each device.

## Plan self-review

- Covers code validation, Docker runtime, server provisioning, GitHub Secrets, automated deployment, local/public health, and password rotation.
- Secrets are never stored in versioned files or chat.
- Workflow uses only the three confirmed secret names.
- No domain, HTTPS, server database, or unrelated infrastructure is introduced.
