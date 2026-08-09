# Phrase Bank iPhone PWA Domain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve Phrase Bank at `https://phrase.archdemy.com` as an iPhone-installable standalone web app while preserving the old IP origin long enough to export existing local data.

**Architecture:** Add Caddy as the only public 80/443 entry point in Docker Compose. Caddy obtains and renews the TLS certificate for `phrase.archdemy.com`, proxies both the HTTPS domain and the legacy HTTP IP to the existing application container, and keeps certificate state in named volumes. GitHub Actions verifies the HTTPS endpoint after deployment; the existing manifest and Apple install metadata remain unchanged.

**Tech Stack:** Docker Compose, Caddy 2, vinext/React PWA metadata, GitHub Actions, Vitest, Tencent Cloud DNS/firewall, iPhone Safari.

---

## File map

- Create `Caddyfile`: HTTPS virtual host, legacy IP virtual host, and reverse-proxy rules only.
- Modify `compose.yaml`: remove the app's public port, add the Caddy service and persistent certificate volumes.
- Create `tests/deployment/httpsProxy.test.ts`: lock the public ports, domain, legacy IP path, internal proxy target, and certificate persistence contract.
- Modify `.github/workflows/deploy.yml`: wait for the domain HTTPS health check and print both proxy/app logs on failure.
- Create `docs/runbooks/iphone-install-and-data-migration.md`: exact backup, import, installation, and rollback procedure for the user.

### Task 1: Establish DNS and firewall prerequisites

**Files:**
- No repository changes.

- [ ] **Step 1: Record the current DNS state**

Run:

```powershell
Resolve-DnsName phrase.archdemy.com -Type A -ErrorAction SilentlyContinue
```

Expected before configuration: no A answer for `phrase.archdemy.com`.

- [ ] **Step 2: Add the DNS record**

In the DNS console that hosts `archdemy.com`, add exactly:

```text
Type: A
Host: phrase
Value: 43.153.204.17
TTL: 600 (or provider default)
```

- [ ] **Step 3: Verify authoritative propagation**

Run until it returns the expected address:

```powershell
Resolve-DnsName phrase.archdemy.com -Type A | Select-Object Name,IPAddress
```

Expected: `phrase.archdemy.com` resolves to `43.153.204.17`.

- [ ] **Step 4: Verify Tencent Cloud permits HTTPS**

Inspect the server security group/firewall and confirm inbound TCP ports `80` and `443` are allowed. Keep TCP `22` unchanged. Do not modify any broader source ranges or unrelated rules.

### Task 2: Specify the HTTPS proxy contract with a failing test

**Files:**
- Create: `tests/deployment/httpsProxy.test.ts`

- [ ] **Step 1: Write the failing deployment contract test**

Create `tests/deployment/httpsProxy.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const rootFile = (name: string) => readFileSync(resolve(process.cwd(), name), "utf8");

describe("HTTPS reverse proxy", () => {
  it("serves the installable domain and preserves the legacy IP origin", () => {
    const caddy = rootFile("Caddyfile");
    expect(caddy).toContain("phrase.archdemy.com");
    expect(caddy).toContain("http://43.153.204.17");
    expect(caddy.match(/reverse_proxy phrase-bank:3000/g)).toHaveLength(2);
  });

  it("makes Caddy the only public entry point and persists certificates", () => {
    const compose = rootFile("compose.yaml");
    expect(compose).toContain('"80:80"');
    expect(compose).toContain('"443:443"');
    expect(compose).toContain("caddy_data:/data");
    expect(compose).toContain("caddy_config:/config");
    expect(compose).not.toContain('"80:3000"');
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```powershell
npx vitest run tests/deployment/httpsProxy.test.ts
```

Expected: FAIL because `Caddyfile`, the Caddy service, and port/volume declarations do not exist.

- [ ] **Step 3: Commit the red test**

```powershell
git add tests/deployment/httpsProxy.test.ts
git commit -m "test: define HTTPS proxy deployment contract"
```

### Task 3: Add Caddy without removing legacy IP access

**Files:**
- Create: `Caddyfile`
- Modify: `compose.yaml`
- Test: `tests/deployment/httpsProxy.test.ts`

- [ ] **Step 1: Create the minimal Caddy configuration**

Create `Caddyfile`:

```caddyfile
phrase.archdemy.com {
  encode zstd gzip
  reverse_proxy phrase-bank:3000
}

http://43.153.204.17 {
  reverse_proxy phrase-bank:3000
}
```

The domain site receives automatic HTTPS and automatic HTTP-to-HTTPS redirects from Caddy. The explicit `http://` IP site remains available for old-origin data export and does not request a certificate for the IP.

- [ ] **Step 2: Replace the public app port with the proxy service**

Replace `compose.yaml` with:

```yaml
services:
  phrase-bank:
    build:
      context: .
      dockerfile: Dockerfile
    image: phrase-bank:latest
    container_name: phrase-bank
    restart: unless-stopped
    expose:
      - "3000"
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:3000/').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
      interval: 15s
      timeout: 5s
      retries: 5
      start_period: 30s

  caddy:
    image: caddy:2.10-alpine
    container_name: phrase-bank-proxy
    restart: unless-stopped
    depends_on:
      phrase-bank:
        condition: service_healthy
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config

volumes:
  caddy_data:
  caddy_config:
```

- [ ] **Step 3: Run the focused test and verify GREEN**

Run:

```powershell
npx vitest run tests/deployment/httpsProxy.test.ts tests/deployment/installability.test.ts
```

Expected: both test files pass; install metadata remains unchanged.

- [ ] **Step 4: Validate the Compose model**

Run:

```powershell
docker compose config
```

Expected: exit 0; only Caddy publishes host ports 80 and 443; `phrase-bank` exposes port 3000 internally.

- [ ] **Step 5: Commit the proxy implementation**

```powershell
git add Caddyfile compose.yaml
git commit -m "feat: serve Phrase Bank through HTTPS proxy"
```

### Task 4: Make automated deployment verify the HTTPS domain

**Files:**
- Modify: `.github/workflows/deploy.yml`
- Test: `tests/deployment/httpsProxy.test.ts`

- [ ] **Step 1: Extend the failing workflow assertion**

Add this test to `tests/deployment/httpsProxy.test.ts`:

```ts
it("checks the public HTTPS endpoint during deployment", () => {
  const workflow = rootFile(".github/workflows/deploy.yml");
  expect(workflow).toContain("https://phrase.archdemy.com/");
  expect(workflow).toContain("docker compose logs --tail=100 phrase-bank caddy");
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```powershell
npx vitest run tests/deployment/httpsProxy.test.ts
```

Expected: FAIL because the workflow still checks `http://127.0.0.1/` and does not include Caddy logs.

- [ ] **Step 3: Update the remote health loop**

In `.github/workflows/deploy.yml`, replace the existing post-deploy loop and failure logs with:

```bash
for attempt in $(seq 1 24); do
  if curl --fail --silent --show-error https://phrase.archdemy.com/ >/dev/null; then
    exit 0
  fi
  sleep 5
done
docker compose ps
docker compose logs --tail=100 phrase-bank caddy
exit 1
```

The 120-second window allows initial certificate issuance. A failed TLS certificate, DNS record, proxy, or app health check fails deployment visibly.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```powershell
npx vitest run tests/deployment/httpsProxy.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the deployment verification**

```powershell
git add .github/workflows/deploy.yml tests/deployment/httpsProxy.test.ts
git commit -m "ci: verify Phrase Bank HTTPS deployment"
```

### Task 5: Document safe data migration and iPhone installation

**Files:**
- Create: `docs/runbooks/iphone-install-and-data-migration.md`

- [ ] **Step 1: Write the user runbook**

Create `docs/runbooks/iphone-install-and-data-migration.md` with exactly these operational sections:

```markdown
# Phrase Bank：迁移到 iPhone 桌面

## 迁移前：从旧地址导出

1. 在原来使用 Phrase Bank 的同一台 iPhone 上，用 Safari 打开 `http://43.153.204.17`。
2. 进入“设置 → 数据备份 → 导出备份”。
3. 将下载的 JSON 文件保存到 iPhone“文件”App；不要清除 Safari 网站数据。

## 在新域名导入

1. 用 Safari 打开 `https://phrase.archdemy.com`，确认地址栏显示安全锁标识且页面可正常进入。
2. 进入“设置 → 数据备份 → 导入备份”，选择刚才保存的 JSON 文件。
3. 选择覆盖重复记录，等待“备份已成功导入”。
4. 对照旧地址检查分类数量、语言块数量，并开始一组快速训练确认进度可保存。

## 添加到主屏幕

1. 仍在 Safari 的 `https://phrase.archdemy.com` 页面中，点击底部“分享”。
2. 向下找到“添加到主屏幕”。
3. 保留名称“Phrase Bank”，点击“添加”。
4. 从桌面图标启动，确认没有 Safari 地址栏，并允许首次训练时的麦克风权限。

## 回退

如果新域名无法打开或导入失败，返回 `http://43.153.204.17` 继续使用。不要删除旧地址的网站数据；保留 JSON 备份并记录页面提示。
```

- [ ] **Step 2: Check the runbook for unsafe ambiguity**

Run:

```powershell
rg -n "清除|删除|覆盖|旧地址|JSON" docs/runbooks/iphone-install-and-data-migration.md
```

Expected: the only destructive-sounding instruction is the explicit import duplicate policy; the runbook repeatedly tells the user not to clear old Safari data.

- [ ] **Step 3: Commit the runbook**

```powershell
git add docs/runbooks/iphone-install-and-data-migration.md
git commit -m "docs: add iPhone install and data migration runbook"
```

### Task 6: Full verification, deploy, and acceptance

**Files:**
- Verify all files from Tasks 2–5.
- Do not modify user-owned `findings.md`, `progress.md`, or `task_plan.md`.

- [ ] **Step 1: Run full local verification**

Run:

```powershell
npm test
npm run lint
npm run build
docker compose config
git diff --check
```

Expected: all commands exit 0.

- [ ] **Step 2: Push `main` to GitHub**

```powershell
git push github main
```

Expected: a new `Test and deploy` workflow run starts for the pushed commit.

- [ ] **Step 3: Wait for GitHub deployment success**

Check the workflow until both `test` and `deploy` conclude `success`. Do not continue on a pending, cancelled, or failed run.

- [ ] **Step 4: Verify server state and both origins**

Run:

```powershell
curl.exe -I https://phrase.archdemy.com/
curl.exe -I http://phrase.archdemy.com/
curl.exe -I http://43.153.204.17/
```

Expected:

- HTTPS domain returns `200` with a valid certificate.
- HTTP domain returns a redirect to HTTPS.
- Legacy HTTP IP returns `200` without redirecting, preserving access to old-origin IndexedDB.

- [ ] **Step 5: Verify install metadata through the domain**

Run:

```powershell
curl.exe --fail https://phrase.archdemy.com/manifest.webmanifest
curl.exe --fail --output NUL https://phrase.archdemy.com/icons/apple-touch-icon.png
```

Expected: both requests succeed; manifest still declares `display: standalone` and the Phrase Bank icons.

- [ ] **Step 6: Complete iPhone acceptance**

On iPhone Safari at `https://phrase.archdemy.com`:

1. Confirm the page opens without a certificate warning.
2. Export old-origin data and import it into the HTTPS origin using the runbook.
3. Start quick training, reveal an answer, play pronunciation, request microphone access, and save one grade.
4. Add to Home Screen and launch from the Phrase Bank icon.
5. Confirm standalone display, bottom safe area, persisted phrases, and saved training progress.

- [ ] **Step 7: Record the deployment result**

Commit only if verification produced repository documentation changes. Otherwise report the deployed commit, successful workflow URL, HTTPS URL, legacy migration URL, and the runbook path without creating an empty commit.

