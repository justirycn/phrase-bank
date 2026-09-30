# Scenario coaching follow-up QA · 2026-09-29

## Delivered locally; not deployed

Added learned-expression prioritization, opt-in recording transcription, editable transcript confirmation, structured textual advice, fresh retry with previous-text comparison, explicit review enrollment, and completed-attempt readback. The other speaker remains scripted. Feedback is not a pronunciation assessment.

## Evidence

- Full unit/integration run: **909 passed, 9 skipped**, 82 passing files. Then the final history-preservation patch passed 16 targeted domain/server tests; a newly added cross-device review conflict case passed with all 5 review-enrollment tests.
- Full browser regression: **10 passed** across desktop Chromium and mobile WebKit, including original daily/proactive review and stale-device conflict flows. Desktop new flow uses fixture microphone WAV output with real browser decoding; model responses are controlled test fixtures. Transcription requires an explicit click; confirmed edited text, hints, retry comparison, enrollment and unchanged mastery/event history are asserted.
- Windows automated WebKit exposes no OfflineAudioContext. The first transcription-path test failed with the visible manual-input fallback. The test now explicitly checks this limitation and exercises the editable-text → feedback → retry → review path, instead of pretending its audio decoder worked. This is not a production decode fix or iPhone validation.
- Real Qwen smoke test: authenticated local preview, **115,244-byte TTS WAV → ASR → validated feedback**, using only a synthetic generic sentence. ASR returned “Yes, it is my first time here. How about you?”; task result `answered`. The smoke parser was corrected for Qwen streaming-WAV length sentinels before the successful run. No real microphone recording was sent.
- In-app browser actual Qwen feedback for a deliberately imperfect synthetic rescheduling answer: identified the past-tense and collocation issues, retained intent, displayed retry and disabled independent-completion controls; cloud sync completed. Evidence: `docs/audits/scenario-speaking/06-coaching-feedback.png`.
- Responsive check at 390 CSS pixels: normal scrolling, no horizontal overflow; default viewport restored after testing. No forced refresh/navigation is used in the coaching state machine.
- Production build and repository-wide lint passed. Standalone TypeScript check still reports errors in existing project files; it is not a clean type-check. No new coaching-module type errors were reported in that run.
- After the final history guard/build, all **4 scenario browser cases passed again**. Restarted the isolated preview, reloaded and resumed the real-feedback attempt: confirmed text/advice restored and independent self-assessment stayed disabled. Final client bundle scan found no server-only Key/config/download-host strings.

## Remaining boundary

Physical iPhone Safari microphone, actual AAC/MP4 conversion, interruptions and subjective playback quality remain unverified. The real API check proves connectivity/contract, not recognition accuracy for the user's speech. Qwen textual suggestions can be wrong and are labelled as such. Production and Git remain unchanged by this follow-up.

---

# Scenario dialogue implementation QA · 2026-09-29 (earlier phase)

## Evidence and scope

- Source visual truth: `docs/product/scenario-speaking/ui/03-scenario-dialogue.png` (user-selected option 3).
- Implementation: local production build at `http://127.0.0.1:4173`, isolated preview account/database; not the live server.
- Matching state: 寄样与确认交期, round 2 of 3, reference answer collapsed, before self-assessment.
- Source: 853 × 1844 pixels. Target viewport: 390 × 844 CSS px. IAB viewport capture: 375 × 812 pixels, including its scrollbar; the DOM reports 390 × 844. Both inputs normalized to 390 × 844 for comparison.
- Initial evidence: `docs/audits/scenario-speaking/02-dialogue-viewport.png`, `comparison-initial.png`.
- Post-fix evidence: `docs/audits/scenario-speaking/02-dialogue-final.png`, `comparison-final.png`.
- Additional states: `03-complete.png`, `05-desktop.png`; desktop viewport 1280 × 900 CSS px, app frame 540 × 852 CSS px. At 320 × 568, DOM checks confirmed no horizontal overflow and normal-flow reply controls; shorter screens scroll vertically.
- Compared both source and implementation together in each comparison image. Text, icons and spacing are readable at this scale, so a separate focused crop was not needed. The initial full-page IAB capture has a scale/canvas artifact and was not used as visual truth.

## Findings and iteration history

1. **P2, fixed — reply actions pushed below the target phone viewport.** The initial question bubble, response spacing and footer collectively expanded the design. The second reply action was not visible in the initial viewport comparison. Reduced bubble padding/line spacing, response margins, and action spacing; retained ≥44 px main touch targets and document-flow actions. The final comparison shows both reply controls inside the viewport, without overlaying content.
2. **P3 — platform font rendering.** Chinese heading strokes on the Windows renderer differ from the generated reference. The same hierarchy, readable English two-line wrap and section order are preserved. System/CJK font fallbacks remain necessary for real devices.

No actionable P0/P1/P2 visual findings remain.

## Required fidelity surfaces

- **Typography:** 32 px heading, 25 px question, 23 px response heading; Chinese instructions and English prompt are distinct and readable. No truncated task text. Small legal/privacy helper copy is deliberately secondary.
- **Spacing/layout:** cream full-height surface, compact navigation, question bubble and response card, then two reply actions. Expanded reference/self-assessment flows scroll normally, not behind a fixed footer. Desktop retains the existing 540 px app frame.
- **Colors/tokens:** existing cream, paper, forest green and orange tokens. Disabled independent-completion state is visibly grey and actually disabled.
- **Assets/icons:** existing Phosphor icon family; initials B/P are functional participant labels, matching the initial-based reference avatar. No generated photos, decorative raster assets or device chrome were required. Standard Books/ArrowLeft replace the reference's document/chevron symbol without changing purpose.
- **Copy/content:** selected scenario and second-turn task match the reference. “界面提案” is replaced with “随时可暂停”; added explicit scripted-dialogue/privacy/sync text. This is preset role practice, not a live customer or an AI conversation.

## Runtime verification

- In-app browser: home → scenario library → trade → samples → hint → grey independent assessment → round 2 → audio playback → reload/resume → round 3 → stable completion → change scenario. No captured console errors or warnings.
- Unit/integration regression: **884 passed, 9 intentionally skipped**, 77 passing files. Separate post-config checks: HTTPS proxy + natural speech, 6 passed.
- Existing browser suite plus new scenario flow: **8 passed**, across desktop Chromium and mobile WebKit. Covers original daily task, proactive review/hint rule, stale device conflict preservation, three dialogue turns, cloud save, reload recovery, unchanged SRS snapshot and no horizontal overflow.
- Build and repository-wide lint passed. Client build search found no server-only TTS key/config/download-host strings.
- Real Qwen test returned a valid 92,204-byte WAV; the preview's question button also completed playback without fallback/error UI. Automated suites disable paid TTS.
- First browser pass exposed an unbound native-fetch receiver in the new modules. Fixed by binding to globalThis; added receiver tests and reran the browsers. One existing ambiguous “句库” test selector was narrowed to the exact navigation button after backup copy changed.

## Remaining verification boundaries

- Real iPhone Safari microphone permission, lock-screen/call interruptions, speaker output and subjective voice quality are **not yet tested**. WebKit automation is not a physical iPhone.
- Scenario browser fixtures deliberately use a small, already-installed sentence bank. An earlier cold WebKit pass exceeded its 45-second timeout importing the full bank before reaching home; full-bank cold-start performance is not certified by these scenario tests.
- Project-wide standalone `tsc --noEmit` reports type errors, including older files; this run does not claim a clean standalone type-check or a verified clean baseline comparison.
- Production is unchanged. Natural voice requires the documented private server configuration when deployment is authorized.

## Implementation checklist

- [x] Preserve selected visual direction and fix the target phone overflow.
- [x] Verify the actual three-turn flow and server persistence.
- [x] Preserve original sentence review and SRS state.
- [x] Bound voice generation, cache and failure recovery; keep secrets server-side.
- [ ] Deploy after user authorization, then validate physical iPhone playback/recording.

final result: passed

---

## Earlier home redesign QA (retained)

**Design QA**

- Source visual truth: `docs/design-references/editorial-phrase-journal-home.png`
- Implementation screenshots: `docs/audits/iphone13pro-redesign/01-home-final.png`, `02-add.png`, `03-review.png`
- Full comparison: `docs/audits/iphone13pro-redesign/home-comparison-final.png`
- Focused hero comparison: `docs/audits/iphone13pro-redesign/home-hero-comparison-final.png`
- Viewport: iPhone 13 Pro target, 390 × 844 CSS px
- Source pixels: 853 × 1844; implementation capture pixels: 375 × 812. Both were aspect-fit/cropped to 390 × 844 at 1× for the comparison canvas. The Chrome extension excludes its scrollbar strip from screenshot pixels, while page inspection confirmed `innerWidth=390` and `innerHeight=844`.
- State: seeded personal phrase bank with 40 due phrases; home before review, empty add form, first unrevealed review prompt.

**Findings**

- No actionable P0, P1, or P2 differences remain.
- Typography: the implementation preserves the source's editorial serif hierarchy, optical contrast, two-line Chinese headline, compact English eyebrow, and readable Chinese/English pairing. System Songti/Georgia fallbacks create a small platform-specific stroke difference that does not change hierarchy or wrapping.
- Spacing and layout: header, practice block, progress, CTA, divider, and reading-list rhythm now track the source. The implementation intentionally keeps a raised central Add action because phrase capture is a core product flow; the reference's passive row chevrons were intentionally omitted because rows have no destination.
- Colors and tokens: forest green, warm ivory, coral count, muted secondary text, and subtle dividers match the source palette and maintain clear contrast.
- Image quality and assets: the generated opaque PNG P icon is sharp at 48 px and matches the installed iPhone icon. UI symbols use one Phosphor family; there are no emoji, placeholder assets, or CSS-drawn illustrations.
- Copy and content: the chosen headline, support sentence, progress copy, CTA, and seeded phrases remain coherent and closely match the reference. Dynamic date/category values are expected differences.
- Accessibility and resilience: primary controls remain at least 44 px, long English text wraps, forms use 16 px fields to avoid iOS zoom, persistent navigation reserves safe-area space, and no horizontal overflow was observed.
- Browser console: no app-origin errors or warnings were observed. Visible blue floating badge/cursor artifacts in captures come from installed Chrome extensions and are not part of the application.

**Focused Evidence**

- The focused hero comparison was required because the headline font, progress spacing, CTA density, and icon alignment are the most fidelity-sensitive details. It confirms equivalent visual hierarchy and vertical rhythm after the spacing correction.
- Add and Review screens were inspected separately at the same viewport to verify form fit, keyboard-safe normal-flow actions, Chinese-first recall, and persistent-control clearance.

**Comparison History**

1. Initial comparison: P2 — the implementation's practice block used looser vertical spacing than the source, pushing the recent list down and reducing above-the-fold phrase visibility. P2 — the primary review CTA omitted the source's book cue.
2. Fixes: reduced header/practice/copy/progress/list spacing, adjusted CTA height, and added the library/book icon while preserving the exact accessible name.
3. Post-fix evidence: `home-comparison-final.png` and `home-hero-comparison-final.png` show aligned hero density, CTA treatment, divider position, palette, and reading-list hierarchy. No actionable P0/P1/P2 mismatch remains.

**Primary Interactions Tested**

- Home → Add via bottom navigation.
- Add form fields and normal-flow save/cancel actions visible within the mobile layout.
- Add → Home → Start Today's Review.
- Review prompt, progress, close action, and reveal CTA visible without horizontal clipping.

**Follow-up Polish**

- P3: a real iPhone Safari capture can replace Chrome's platform font rendering and remove extension overlays after deployment; this does not block the current design acceptance.

final result: passed
