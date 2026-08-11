# Fast home and learning heatmap audit

Recorded on 2026-08-11 against a local `vinext start` production build at `http://127.0.0.1:4173/`.

## Scope and limitations

This is a Codex in-app browser run at a **390×844 CSS viewport**. It is **not a real iPhone**, **not Safari**, and **not a public-network measurement**. No claim about real-device paint time, mobile radio latency, or public deployment performance is made here.

The explicit viewport remained 390×844 after five browser zoom shortcuts, so the attempted 200% check did not produce a verifiable 200% text-zoom state. `04-home-zoom-attempt-no-effect.jpg` is retained as evidence of that limitation, not as a passing 200% result.

The first run did not expose a reliable, reversible way to inject an IndexedDB heatmap failure or a network chunk failure. A later temporary local audit route was prepared for skeleton/error capture and removed before commit, but the in-app browser connection was no longer available (`browsers.list()` returned no browsers). Those paths remain covered by automated component tests, but no missing visual screenshot is claimed. Initial loading is covered by the deferred-storage component test.

## Current production build

The committed evidence only reports the current reproducible `npm run build`. A historical detached build was attempted, but Windows long-path cleanup left a physical temporary directory. Because that run did not satisfy the no-residue requirement, its numbers were removed rather than retained as a supported before comparison.

| Uncompressed production JavaScript | Current |
| --- | ---: |
| `PhraseBankApp` chunk | 55,212 B |
| Initial JS set from the RSC/client asset manifests | 483,723 B |
| Distinct non-home screen chunks | 6 |

The enforceable limits are 63,500 B for the home coordinator and 556,500 B for initial JavaScript. They are derived from the optimized build with approximately 15% headroom. The test discovers hashed files through `vinext-client-assets.js` and `__vite_rsc_assets_manifest.js`; it does not pin hashes or absolute filenames.

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
- Startup calls: each of the eight bounded/core home reads exactly once; `exportSnapshot` zero times
- Returned bounded history: 6,636 events and 948 sessions; heatmap 84 days
- Current service-ready observation: 117.21 ms
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
