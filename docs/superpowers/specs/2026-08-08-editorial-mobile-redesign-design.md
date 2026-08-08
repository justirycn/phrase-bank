# Phrase Bank Editorial Mobile Redesign

## Goal

Recreate the selected “Editorial Phrase Journal” direction as the production Phrase Bank interface, preserve the existing phrase collection and review behavior, and make the site installable on an iPhone 13 Pro with a dedicated home-screen icon.

## Visual target

- Selected reference: `docs/design-references/editorial-phrase-journal-home.png`.
- App-icon master: `docs/design-references/phrase-bank-app-icon-master.png`.
- Primary viewport: iPhone 13 Pro, 390 × 844 CSS pixels.
- Brand palette: deep forest green, warm ivory, restrained burnt orange, soft neutral dividers.
- Typography: editorial serif for expressive headings and phrase content; readable sans serif for controls, metadata, and Chinese supporting text.
- Icons: one consistent open-source line-icon library. Do not use emoji or text glyphs as interface icons.

## Scope

### Home

- Use a compact brand/date header.
- Make the daily review message the dominant first-screen element without enclosing the entire section in a heavy card.
- Show review progress and one full-width primary review action.
- Present recent phrases as a single calm reading list with lightweight separators.
- Keep the first screen readable at 390 × 844 and protect content from the bottom safe area.

### Existing flows

- Keep library search, category filtering, add-phrase form, review grading, settings, backup, and restore behavior unchanged.
- Apply the selected typography, spacing, color, control, divider, and navigation system across those existing screens.
- Keep touch targets at least 44 × 44 CSS pixels and inputs at least 16px on iPhone to prevent Safari auto-zoom.
- Keep form actions visible and reachable when the software keyboard is open; allow the page to scroll instead of letting the keyboard cover required fields.

### Navigation

- Use a compact four-item bottom navigation with real line icons.
- Respect `env(safe-area-inset-bottom)` and avoid overlapping content or the iOS home gesture area.
- Preserve the existing destinations: Review, Library, Add, and Settings.

## iPhone installation

- Use the generated square master icon without baking rounded corners into the source.
- Produce PNG icons for Apple touch icon (180 × 180), PWA (192 × 192 and 512 × 512), and a maskable 512 × 512 variant with safe content margins.
- Update the web app manifest with valid UTF-8 name, short name, standalone display, theme/background colors, and PNG icon declarations.
- Add Apple web-app metadata and link the Apple touch icon.
- Keep `viewport-fit=cover` so safe-area CSS works on iPhone.
- Installation path for the user remains Safari → Share → Add to Home Screen. HTTPS is required for a fully reliable PWA install; plain HTTP by IP may only behave as a bookmark on iOS.

## Data and architecture

- Do not change the IndexedDB schema or repository interfaces.
- Do not remove or overwrite saved phrases during deployment.
- Keep the current single-page screen state model and existing navigation behavior.
- Split visual UI helpers only when it makes icon usage and layout responsibilities clearer; avoid unrelated refactors.

## Accessibility and resilience

- Maintain strong text/background contrast and visible focus states.
- Use semantic buttons, headings, labels, and status/alert roles.
- Support reduced motion and 200% text zoom without horizontal page scrolling.
- Long English phrases and Chinese translations must wrap without clipping.
- Empty, loading, validation-error, review-complete, and data-error states must remain usable.

## Verification

- Add or update component tests for navigation, add-phrase validation, review entry, and install metadata.
- Run the full test suite and production build.
- Capture the production UI at 390 × 844 for the home, add, and review screens.
- Compare the home capture against the selected reference and fix all P0–P2 design differences before handoff.
- Test safe-area padding, 44px targets, long-text wrapping, and form usability at the iPhone viewport.

## Out of scope

- Login, cloud sync, server-side phrase storage, new learning features, and new routes.
- Native App Store packaging.
- Domain purchase and HTTPS certificate setup; these may follow after the redesign.
