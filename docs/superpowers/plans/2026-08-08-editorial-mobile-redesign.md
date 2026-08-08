# Editorial Mobile Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recreate the selected Editorial Phrase Journal design in the existing Phrase Bank web app, preserve all current data behavior, and make the app installable on an iPhone with a dedicated icon.

**Architecture:** Keep the current React screen-state architecture and IndexedDB repository unchanged. Refactor only the visual shell into focused brand, icon, navigation, home, form, and review presentation units; drive the look from shared CSS tokens. Add committed PNG install assets and declarative PWA/Apple metadata, then validate behavior with Vitest and fidelity with browser screenshots at 390 × 844.

**Tech Stack:** React 19, TypeScript, Vinext/Next-compatible metadata, CSS, IndexedDB, Phosphor Icons React, Vitest, Testing Library, PWA manifest.

---

## File map

- `app/PhraseBankApp.tsx`: screen state, data operations, and screen composition.
- `app/components/AppIcon.tsx`: typed wrapper around the selected Phosphor line icons.
- `app/components/Brand.tsx`: Phrase Bank mark and wordmark.
- `app/components/BottomNavigation.tsx`: safe-area-aware navigation with semantic labels.
- `app/globals.css`: editorial tokens, responsive layout, safe-area, form, and screen styling.
- `app/layout.tsx`: global metadata, Apple web-app metadata, icon declarations, and viewport.
- `public/manifest.webmanifest`: PWA identity and install icon declarations.
- `public/icons/*`: generated Apple/PWA PNG icon variants.
- `tests/components/app.test.tsx`: existing behavior plus navigation/review regression coverage.
- `tests/deployment/installability.test.ts`: manifest, metadata, and icon-dimension contract.
- `design-qa.md`: source-versus-rendered visual comparison and final gate.

### Task 1: Lock the behavior and installability contract

**Files:**
- Modify: `tests/components/app.test.tsx`
- Create: `tests/deployment/installability.test.ts`

- [ ] **Step 1: Add a failing home/navigation regression test**

Add a test that seeds one due phrase, renders the app, and verifies the selected design's primary labels and accessible navigation names without checking decorative markup:

```tsx
const makePhrase = (input: Partial<Phrase> = {}): Phrase => ({
  id: "p1",
  english: "I'll get back to you.",
  chinese: "我会回复你的。",
  categoryId: "daily",
  reviewStep: 0,
  masteryLevel: 0,
  nextReviewAt: new Date().toISOString(),
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...input,
});

it("keeps review, library, add, and settings reachable from mobile navigation", async () => {
  const user = userEvent.setup();
  const repo = new MemoryRepository();
  repo.phrases.push(makePhrase({ english: "I'll get back to you.", chinese: "我会回复你的。" }));
  render(<PhraseBankApp repository={repo as never} />);

  expect(await screen.findByRole("button", { name: "开始今日复习" })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "句库" }));
  expect(screen.getByRole("heading", { name: "我的句库" })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "添加" }));
  expect(screen.getByRole("heading", { name: "收藏语言块" })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "设置" }));
  expect(screen.getByRole("heading", { name: "设置" })).toBeInTheDocument();
});
```

- [ ] **Step 2: Add a failing installability test**

Read `public/manifest.webmanifest` and PNG IHDR dimensions directly so the test has no image dependency:

```ts
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const pngSize = async (path: string) => {
  const file = await readFile(path);
  return { width: file.readUInt32BE(16), height: file.readUInt32BE(20) };
};

describe("iPhone installation metadata", () => {
  it("declares standalone PNG icons and Apple touch metadata", async () => {
    const manifest = JSON.parse(await readFile("public/manifest.webmanifest", "utf8"));
    expect(manifest.name).toBe("Phrase Bank · 我的英语语言块");
    expect(manifest.display).toBe("standalone");
    expect(manifest.icons).toEqual(expect.arrayContaining([
      expect.objectContaining({ src: "/icons/icon-192.png", sizes: "192x192" }),
      expect.objectContaining({ src: "/icons/icon-512.png", sizes: "512x512" }),
      expect.objectContaining({ src: "/icons/icon-maskable-512.png", purpose: "maskable" }),
    ]));
    expect(await pngSize("public/icons/apple-touch-icon.png")).toEqual({ width: 180, height: 180 });
  });
});
```

- [ ] **Step 3: Run the targeted tests and confirm they fail**

Run: `npm test -- tests/components/app.test.tsx tests/deployment/installability.test.ts`

Expected: FAIL because the accessible redesign labels, PNG assets, and new manifest declarations do not exist yet.

- [ ] **Step 4: Commit the red tests**

```bash
git add tests/components/app.test.tsx tests/deployment/installability.test.ts
git commit -m "test: define mobile redesign and install contracts"
```

### Task 2: Produce the iPhone and PWA icon assets

**Files:**
- Source: `docs/design-references/phrase-bank-app-icon-master.png`
- Create: `scripts/generate_install_icons.py`
- Create: `public/icons/apple-touch-icon.png`
- Create: `public/icons/icon-192.png`
- Create: `public/icons/icon-512.png`
- Create: `public/icons/icon-maskable-512.png`

- [ ] **Step 1: Generate exact PNG sizes from the approved master**

Use the approved square master as the only source. Create this repeatable Pillow script:

```py
from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parents[1]
source = Image.open(root / "docs/design-references/phrase-bank-app-icon-master.png").convert("RGB")
target = root / "public/icons"
target.mkdir(parents=True, exist_ok=True)

for filename, size in (("apple-touch-icon.png", 180), ("icon-192.png", 192), ("icon-512.png", 512)):
    source.resize((size, size), Image.Resampling.LANCZOS).save(target / filename, optimize=True)

canvas = Image.new("RGB", (512, 512), "#0b4a3a")
safe = source.resize((410, 410), Image.Resampling.LANCZOS)
canvas.paste(safe, ((512 - 410) // 2, (512 - 410) // 2))
canvas.save(target / "icon-maskable-512.png", optimize=True)
```

Run: `python scripts/generate_install_icons.py`

Expected: four opaque PNG files are created at the exact paths above. Do not bake rounded corners or transparency into any source.

- [ ] **Step 2: Inspect all four images**

Open every generated image and confirm: the `P` is centered, no edge is clipped, the background is opaque, and the maskable mark stays inside the central safe zone.

- [ ] **Step 3: Run the image dimension assertion**

Run: `npm test -- tests/deployment/installability.test.ts`

Expected: the icon dimension assertion passes; manifest assertions still fail.

- [ ] **Step 4: Commit the icon assets**

```bash
git add scripts/generate_install_icons.py public/icons
git commit -m "feat: add Phrase Bank install icons"
```

### Task 3: Add the editorial icon and brand component system

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `app/components/AppIcon.tsx`
- Create: `app/components/Brand.tsx`
- Modify: `app/PhraseBankApp.tsx`

- [ ] **Step 1: Install the chosen icon library**

Run: `npm install @phosphor-icons/react`

Use Phosphor's regular weight because its open, editorial line shapes best match the selected reference.

- [ ] **Step 2: Create a typed icon wrapper**

```tsx
import {
  ArrowLeft, BookmarkSimple, BookOpenText, GearSix, House,
  MagnifyingGlass, Plus, UploadSimple, DownloadSimple, X,
} from "@phosphor-icons/react";

const icons = { back: ArrowLeft, bookmark: BookmarkSimple, review: BookOpenText,
  home: House, search: MagnifyingGlass, add: Plus, settings: GearSix,
  upload: UploadSimple, download: DownloadSimple, close: X } as const;

export function AppIcon({ name, size = 22 }: { name: keyof typeof icons; size?: number }) {
  const Icon = icons[name];
  return <Icon aria-hidden="true" size={size} weight="regular" />;
}
```

- [ ] **Step 3: Create the reusable brand**

```tsx
export function Brand() {
  return <div className="brand" aria-label="Phrase Bank">
    <img className="brand-mark" src="/icons/apple-touch-icon.png" alt="" />
    <div><b>Phrase Bank</b><small>我的英语语言块</small></div>
  </div>;
}
```

- [ ] **Step 4: Replace all emoji/text-glyph icons**

Use `AppIcon` in navigation, search, back/close, add, backup, and restore controls. Keep visible Chinese labels so icon meaning never depends on shape alone.

- [ ] **Step 5: Run component tests**

Run: `npm test -- tests/components/app.test.tsx`

Expected: PASS except any assertions deliberately waiting for the home redesign in Task 4.

- [ ] **Step 6: Commit the icon system**

```bash
git add package.json package-lock.json app/components app/PhraseBankApp.tsx
git commit -m "refactor: add editorial brand and icon system"
```

### Task 4: Recreate the selected home screen

**Files:**
- Modify: `app/PhraseBankApp.tsx`
- Modify: `app/globals.css`
- Test: `tests/components/app.test.tsx`

- [ ] **Step 1: Restructure Home to match the selected reference**

Keep data inputs unchanged. Render: compact header; `TODAY’S PRACTICE` label; oversized review headline; short supporting copy; `进度 0 / {dueCount}` line; one full-width review button; divided recent-phrase list; safe-area bottom navigation.

```tsx
<section className="practice-hero" aria-labelledby="practice-title">
  <p className="eyebrow">TODAY’S PRACTICE</p>
  <h1 id="practice-title">今天有 <em>{dueCount}</em> 条<br />语言块等你复习</h1>
  <p className="practice-copy">先想意思，再让英文自然浮现。</p>
  <div className="practice-progress"><span>进度 0 / {dueCount}</span><i /></div>
  <button className="primary practice-action" onClick={onReview}>开始今日复习</button>
</section>
```

- [ ] **Step 2: Replace card-heavy CSS with editorial tokens**

Define and use:

```css
:root {
  --forest: #0b4a3a;
  --ivory: #fbf8f0;
  --paper: #fffdf8;
  --coral: #d66f3f;
  --text: #173d33;
  --muted: #777b76;
  --divider: #ded9cd;
  --serif: "Noto Serif SC", Georgia, serif;
}
```

At `max-width: 430px`, use 20–24px side padding, avoid outer box shadow, let long phrase text wrap, and reserve `calc(88px + env(safe-area-inset-bottom))` beneath content.

- [ ] **Step 3: Run the component tests**

Run: `npm test -- tests/components/app.test.tsx`

Expected: PASS, including the new mobile navigation test.

- [ ] **Step 4: Commit the home implementation**

```bash
git add app/PhraseBankApp.tsx app/globals.css tests/components/app.test.tsx
git commit -m "feat: recreate editorial Phrase Bank home"
```

### Task 5: Carry the selected system through existing flows

**Files:**
- Modify: `app/PhraseBankApp.tsx`
- Modify: `app/globals.css`
- Test: `tests/components/app.test.tsx`

- [ ] **Step 1: Restyle the library as a reading list**

Retain search and category logic. Replace standalone phrase cards with a grouped paper surface and row separators; emphasize the English phrase in serif and show Chinese/meta copy underneath.

- [ ] **Step 2: Make the add form keyboard-safe**

Set form inputs to at least `font-size: 16px`, add `scroll-margin-bottom: 180px`, and make actions a normal-flow block with safe-area bottom padding rather than a fixed overlay. Preserve validation and optional fields.

- [ ] **Step 3: Restyle review and completion states**

Keep Chinese-first recall and grading logic. Apply the editorial heading, slim progress treatment, high-contrast reveal control, and 44px-or-larger grading targets.

- [ ] **Step 4: Restyle settings without changing backup behavior**

Use dividers and spacing before tinted surfaces; preserve category migration, import, export, and warnings.

- [ ] **Step 5: Test long content and core interactions**

Add a phrase over 80 characters and assert it remains present after navigating home → library. Re-run save validation and Chinese-first review tests.

Run: `npm test -- tests/components/app.test.tsx`

Expected: all component tests PASS.

- [ ] **Step 6: Commit the flow styling**

```bash
git add app/PhraseBankApp.tsx app/globals.css tests/components/app.test.tsx
git commit -m "feat: unify Phrase Bank mobile flows"
```

### Task 6: Complete iPhone install metadata

**Files:**
- Modify: `app/layout.tsx`
- Modify: `app/page.tsx`
- Modify: `public/manifest.webmanifest`
- Test: `tests/deployment/installability.test.ts`

- [ ] **Step 1: Update application metadata**

Declare valid UTF-8 titles/descriptions, `appleWebApp: { capable: true, statusBarStyle: "default", title: "Phrase Bank" }`, and icons for `/icons/apple-touch-icon.png`, `/icons/icon-192.png`, and `/icons/icon-512.png`. Preserve `viewportFit: "cover"` and set theme color to `#0b4a3a`.

- [ ] **Step 2: Update the manifest**

```json
{
  "name": "Phrase Bank · 我的英语语言块",
  "short_name": "Phrase Bank",
  "description": "收藏、复习并主动调用真正会用到的英语表达。",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#fbf8f0",
  "theme_color": "#0b4a3a",
  "lang": "zh-CN",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any" },
    { "src": "/icons/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

- [ ] **Step 3: Run installability and full tests**

Run: `npm test -- tests/deployment/installability.test.ts`

Expected: PASS.

Run: `npm test`

Expected: all test files PASS.

- [ ] **Step 4: Commit install support**

```bash
git add app/layout.tsx app/page.tsx public/manifest.webmanifest tests/deployment/installability.test.ts
git commit -m "feat: support iPhone home-screen install"
```

### Task 7: Build, browser-test, and pass design QA

**Files:**
- Create: `design-qa.md`
- Create: `docs/audits/iphone13pro-redesign/01-home.png`
- Create: `docs/audits/iphone13pro-redesign/02-add.png`
- Create: `docs/audits/iphone13pro-redesign/03-review.png`

- [ ] **Step 1: Run full static verification**

Run: `npm test && npm run lint && npm run build`

Expected: zero test failures, zero lint errors, and a successful production build.

- [ ] **Step 2: Start the local production-equivalent app**

Run the existing app locally without reinitializing or replacing its runtime. Open it in the connected browser.

- [ ] **Step 3: Capture the three primary states at 390 × 844**

Capture home, add phrase, and active review. Verify touch targets, safe area, long wrapping, form scroll with an iPhone-sized viewport, and no console errors.

- [ ] **Step 4: Run the blocking visual comparison**

Compare `docs/design-references/editorial-phrase-journal-home.png` and the new home screenshot in one combined visual input. Write `design-qa.md` with exact source/implementation paths, viewport, pixel dimensions, typography, spacing, color, icon, copy, and image-asset findings.

- [ ] **Step 5: Fix P0–P2 findings and repeat**

After each fix, recapture the same state and record the prior finding, fix, and new evidence. Stop only when `design-qa.md` ends with exactly:

```md
final result: passed
```

- [ ] **Step 6: Commit the verified redesign**

```bash
git add app public tests docs/audits/iphone13pro-redesign design-qa.md package.json package-lock.json
git commit -m "feat: finish verified Phrase Bank redesign"
```

### Task 8: Push, auto-deploy, and verify production

**Files:**
- No new source files expected.

- [ ] **Step 1: Push the verified main branch**

Use the configured GitHub SSH identity to push `main`, triggering the existing GitHub Actions workflow.

- [ ] **Step 2: Monitor GitHub Actions**

Expected: test and deploy jobs both finish with `success` for the pushed commit.

- [ ] **Step 3: Verify the Tencent Cloud deployment**

Check container health, server-local HTTP 200, public HTTP 200, and confirm the returned HTML contains `Phrase Bank`.

- [ ] **Step 4: Verify the production mobile UI**

Reload `http://43.153.204.17/` at 390 × 844, capture the production home, and confirm it matches the QA-passed local build.

- [ ] **Step 5: Explain iPhone installation constraints**

Tell the user how to use Safari → Share → Add to Home Screen. State plainly that reliable standalone PWA installation and service-worker capabilities require HTTPS; if plain-IP HTTP does not install correctly, domain + HTTPS is the next infrastructure task.

---

## Plan self-review

- Every requirement in the approved specification maps to a task above.
- IndexedDB and repository code are explicitly unchanged.
- Icon generation, dimensions, Apple metadata, manifest metadata, and safe-area behavior are independently verified.
- The plan contains no new route, login, cloud-sync, or backend scope.
- Product Design handoff is blocked until `design-qa.md` says `final result: passed`.
