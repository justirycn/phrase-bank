# Fast home and learning heatmap audit

Recorded on 2026-08-11 against a local `vinext start` production build at `http://127.0.0.1:4173/`.

## Scope and limitations

This is a Codex in-app browser run at a **390×844 CSS viewport**. It is **not a real iPhone**, **not Safari**, and **not a public-network measurement**. No claim about real-device paint time, mobile radio latency, or public deployment performance is made here.

The explicit viewport remained 390×844 after five browser zoom shortcuts, so the attempted 200% check did not produce a verifiable 200% text-zoom state. `04-home-zoom-attempt-no-effect.jpg` is retained as evidence of that limitation, not as a passing 200% result.

The first run did not expose a reliable, reversible way to inject an IndexedDB heatmap failure or a network chunk failure. A later temporary local audit route was prepared for skeleton/error capture and removed before commit, but the in-app browser connection was no longer available (`browsers.list()` returned no browsers). Those paths remain covered by automated component tests, but no missing visual screenshot is claimed. Initial loading is covered by the deferred-storage component test.

## Reproducible before/after production build

Run `npm run benchmark:home-before-after`. The command resolves true pre-feature baseline SHA `3e2026060494ba8108a6da45ab7bd15e88882758`, exports it without registering a Git worktree into a unique `C:\Temp\phb-*` directory, links the existing dependency installation as a junction, and uses the same vinext CLI for both builds. It starts vinext directly as one Node child, terminates it, waits for `exit`, removes the dependency junction, removes the unique temporary directory, then verifies that directory is gone.

The generated current measurement records stable application source tree `2d10a55a162d6013d7b7edac531721477c7158b1`. The `current.sha` value in `metrics.json` is a runner-generated informational field and changes when the command is rerun after an evidence commit; README and tests intentionally do not pin it. Tests compare only the recorded source tree with `git rev-parse HEAD:app`, so evidence-only commits do not create a self-referential identity loop. Before creating any temporary directory or updating metrics, the runner rejects tracked or untracked changes under `app/`.

| Production metric | Baseline | Current | Change |
| --- | ---: | ---: | ---: |
| Authenticated home chunk | 157,491 B | 63,462 B | -59.7% |
| Initial JS set from manifests | 524,925 B | 496,994 B | -5.3% |
| Local uncompressed HTML/RSC response | 446,625 B | 446,909 B | +0.1% |
| Startup `exportSnapshot()` call sites | 1 | 0 | removed |

The startup call-site metric follows eager local imports from `PhraseBankApp` and inspects only the startup `refresh` / `loadHomeData` functions. At the baseline it identifies `PhraseBankApp.refresh`; it deliberately excludes the separate inline Settings export action. This is a startup dependency graph metric, not a whole-file text count.

The enforceable limits are 63,500 B for the home coordinator and 556,500 B for initial JavaScript. They are derived from the optimized build with approximately 15% headroom. The test discovers hashed files through `vinext-client-assets.js` and `__vite_rsc_assets_manifest.js`; it does not pin hashes or absolute filenames.

The command was run repeatedly after the lifecycle fix. Every completed verification run ended with zero `C:\Temp\phb-*` residue; the exact current 2,000-phrase service-ready observation is runner-generated in `metrics.json` and is intentionally not copied into this static README. The baseline has no `loadHomeData` boundary, so bounded rows and service-ready duration are explicitly unavailable rather than compared under a false equivalent. Deferred skeleton-to-home behavior is asserted by the React hook/component tests; no wall-clock test-render duration is published because jsdom scheduling is not a stable performance metric.

Run the reproducible build-and-budget gate with `npm run test:home-performance`. Ordinary `npm test` still works in a clean checkout without `dist`; only the build-dependent assertions are skipped when no production manifest exists.

Current screen chunks:

- Add phrase: 4,479 B
- Learning: 13,776 B
- Library: 4,603 B
- Practice: 18,221 B
- Review: 2,557 B
- Settings: 5,865 B

## Deterministic 2,000-phrase data benchmark

Run `npm run benchmark:home-data`. It creates a uniquely named fake IndexedDB database through the production `LocalPhraseRepository`, imports a deterministic fixture, then invokes the production `loadHomeData` boundary.

- Seed: `20260811`
- Fixture: 10 categories, 2,000 phrases, 2,000 learning states, 10,080 events, 1,440 sessions
- Startup calls: each of the nine bounded/core home reads exactly once; `exportSnapshot` zero times
- Returned bounded history: 6,636 events and 948 sessions; heatmap 84 days
- Current service-ready observation: runner-generated in `metrics.json`
- Regression ceiling: 5,000 ms

The ceiling is intentionally generous so slower CI machines do not turn this into a flaky microbenchmark. It detects catastrophic unbounded/loading regressions; it is not a Web Vital. The exact deterministic counts and call contract are asserted in the full test suite.

## 390×844 CSS viewport findings

- Home rendered all 84 accessible heatmap cells in a computed 12-column × 7-row grid.
- The accessibility tree exposed labels such as `8月11日，未学习` and future-day labels such as `8月12日，未来日期`.
- `documentElement.scrollWidth` equalled `clientWidth` (375 CSS px after the 15 px desktop scrollbar); there was no horizontal overflow.
- Main bottom padding was 88 px. The fixed bottom navigation was 76 px high, ended at viewport bottom, and used z-index 20. The heatmap remained in normal document flow above that clearance.
- Clicking 句库 produced the real `正在打开句库…` Suspense fallback before the lazy chunk resolved. The loaded library also had no horizontal overflow.
- Three warm reloads reached the heatmap region in 193 ms, 184 ms, and 185 ms as observed from the browser-control call. This includes control overhead and is not a Web Vitals measurement.

## Local HTTP observations

`curl --compressed` against the local production server returned 132,190 compressed bytes for the HTML/RSC response. Three cache-bypassed requests completed in 49.5 ms, 26.7 ms, and 31.9 ms. Three requests sharing a curl connection completed in 28.9 ms, 32.5 ms, and 29.8 ms. These values are local-server diagnostics only.

## Screenshot evidence

The browser screenshot backend returned JPEG bytes even though the initial filenames requested `.png`. The files were renamed to `.jpg` without transcoding or cropping. Scrollbar/content sizing also means the exported raster dimensions differ from the requested viewport in some states; tests lock the actual signatures and dimensions.

| File | State | Raw export size |
| --- | --- | ---: |
| `01-home-390x844-full.jpg` | Loaded full home and heatmap | 375×1608 |
| `02-library-fallback-390x844.jpg` | Real non-home lazy fallback | 390×844 |
| `03-library-loaded-390x844.jpg` | Loaded library | 375×812 |
| `04-home-zoom-attempt-no-effect.jpg` | Zoom attempt; viewport unchanged | 375×812 |

The machine-readable observations are in `metrics.json`.

## Completed local Chrome visual acceptance

Captures `05` through `10` were recorded against the local production server with the connected Chrome extension at a 390x844 CSS viewport. This added evidence is **not IAB**, **not Safari**, **not a real iPhone**, and **not a public-network measurement**.

A temporary local-only audit route rendered the production components and styles in deterministic initial-loading, heatmap-error/retry, and CSS-equivalent 200% states. It was removed before the final production build and commit. The 200% state used an explicitly labelled `font-size: 200%` audit wrapper; it is not browser zoom. The non-home return evidence used the real, unmodified `PhraseBankApp`, navigating from home to the lazy-loaded library and back to home.

| File | State | Raw export size |
| --- | --- | ---: |
| `05-initial-skeleton-chrome-390x844.jpg` | Initial loading status | 390x844 |
| `06-heatmap-error-chrome-390x844.jpg` | Heatmap error; retry visible and three entries enabled | 375x812 |
| `07-heatmap-retry-chrome-390x844.jpg` | Retry restored 84 cells in 12 columns | 375x812 |
| `08-css-equivalent-200-chrome-390x844.jpg` | CSS-equivalent 200% audit; not browser zoom | 375x812 |
| `09-real-library-screen-chrome-390x844.jpg` | Real `PhraseBankApp` non-home library | 375x812 |
| `10-real-home-return-chrome-390x844.jpg` | Real library-to-home return | 375x812 |

Every measured Chrome state had no horizontal overflow. The fixed 76 px bottom navigation ended at the viewport bottom and the home main area retained 88 px bottom padding. All four navigation actions and all three home learning/review/practice entries were enabled in the inspected states. The heatmap exposed 84 list items with date-and-learning-state accessible names, including `5月18日，未学习`.

Two uncropped full-page JPEGs make the heatmap states legible without altering the browser output. `11-heatmap-error-focused-chrome-390x844.jpg` (375x1321) shows the error message and retry control together. `12-css-equivalent-200-heatmap-focused-chrome-390x844.jpg` (375x1763) shows the explicit non-browser-zoom label and the 200% heatmap in one original full-page capture. At the measured 390x844 CSS viewport scroll position, the sticky label occupied y=0..68 and the heatmap began at y=406.4; both were simultaneously in the viewport. The computed heatmap remained 12 columns with 84 accessible cells and no horizontal overflow.
