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
