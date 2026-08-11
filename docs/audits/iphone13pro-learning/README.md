# New phrase learning mobile visual audit

## Environment and method

- Audited in a browser CSS viewport, not on a physical iPhone: `innerWidth=390`, `innerHeight=844`.
- Every audited state reported `document.documentElement.scrollWidth <= 390`, so no horizontal page overflow was present.
- Browser error overlays were checked in every state: `overlayCount=0` throughout.
- The browser backend exported states 01, 02, and 06 as full-frame 375×812 JPEG images. These were not cropped. Pillow converted and resized the entire frame with LANCZOS, at an effectively matching aspect ratio, to the required 390×844 PNG files.
- States 03, 04, 05, 07, and 08 were exported as full-frame 390×844 JPEG images and converted to PNG without cropping.
- All files below were subsequently checked as genuine PNG images at exactly 390×844.

## Captures and observations

| File | State | Visual and mobile checks |
| --- | --- | --- |
| `01-home.png` | Home, 0 / 15 learned, three entries | Learning, review, and quick-practice entries have distinct hierarchy; counts and the active-session recovery copy wrap without crowding. Touch targets remain comfortably sized. |
| `02-study.png` | Study, long English and two examples | Captured after scrolling to the two ordered examples. Long English, Chinese, intent, context, and both examples wrap normally with no clipped or single-character vertical text. Content remains clear above the action tray. |
| `03-fifth.png` | Fifth study phrase | A medium-length fixture allows the complete English, Chinese, intent, full usage context, and final study tray to appear together in the 390×844 frame without overlap. |
| `04-hidden.png` | Test before answer reveal | Chinese-first prompt is prominent; the unrevealed state stays stable, centered, wrappable, and has a full-width reachable reveal action. |
| `05-revealed.png` | Test after reveal with grades | The matching medium-length fixture shows the complete Chinese prompt and English answer through “forward.” together with replay and all three rating controls in one 390×844 frame, without overlap or horizontal overflow. |
| `06-error.png` | Speech/action error | Captured after scrolling to the inline error. The long error wraps, remains associated with the current study state, and does not obstruct the fixed actions. |
| `07-complete.png` | Short group complete | Completion content is centered, vertically scrollable if needed, and its return action remains reachable above the safe area. |
| `08-library.png` | System library, four stage filters | Four filter chips and long library copy fit without page-level horizontal overflow. This state used a temporary faithful fixture with the production classes and structure because `Library` is an inline, non-exported component; it did not reproduce the real component's filter interaction or IndexedDB behavior. |

Across all captures, the 20–22px horizontal gutters, anywhere wrapping, touch sizing, fixed-tray clearance, and bottom safe-area treatment were visually checked. The resized full-frame captures were also checked after conversion for completeness, edge clipping, distortion, and accidental vertical single-character layout.

## 200% text-equivalent check

A temporary audit-only outer wrapper used CSS `zoom: 2` on the **study state** to approximate a 200% text/layout scale. At that scale the browser reported `documentElement.clientWidth=375`, `documentElement.scrollWidth=375`, and `scrollHeight=4621`, with no horizontal overflow. The “下一句” control remained reachable with a bounding rectangle from x=40 to x=335 and y=700 to y=812. The temporary route and zoom wrapper were removed after the audit and are not part of the committed application.

`metrics.json` is a checked-in record of that one browser sampling run. The artifact-integrity test validates its schema and detects accidental edits; it does not rerun browser layout and cannot automatically detect a current-code visual regression. A CSS container contract now structurally stacks the highest revealed-answer tray at a 200%-equivalent narrow width, but a future browser QA pass should still sample that revealed state directly.
