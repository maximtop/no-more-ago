# English Chrome Capture Record

Captured on 2026-09-05 with explicit permission for local Chrome work.
An isolated temporary profile contained no accounts or private website data.
All browser contexts were closed after capture.

## Environment

- No More Ago release build: 0.1.0, `pnpm release chrome`.
- Chrome for Testing: 151.0.7922.34, macOS ARM64, headless mode.
- Browser locale: `en-US`; time zone: `UTC`.
- Demo viewport: 530×600 CSS pixels; device scale 1 (Retina: 2).
- Settings details viewport: 360×1100; device scale 1.6 (Retina: 3.2).
- Preview viewport: 700×1000; same scale as Settings details.
- Popup viewport: 336×650; device scale 1.32 (Retina: 2.64).
- Demonstration: `../demo.html`, served by a local HTTP server.

## Raw captures

| File | Pixels | Retina pixels | Actual captured surface |
| --- | --- | --- | --- |
| `before.png` | 470×239 | 940×478 | Demo `article`, processing disabled |
| `after.png` | 470×239 | 940×478 | Same element after enabling processing |
| `format.png` | 518×251 | 1037×502 | Date format and Format pattern wrappers |
| `zone.png` | 518×221 | 1037×442 | Time zone and IANA identifier wrappers |
| `preview.png` | 1030×149 | 2061×298 | Actual `.options-preview` element |
| `popup-light.png` | 444×521 | 887×1043 | Actual `.popup` with Light appearance |
| `popup-dark.png` | 444×521 | 887×1043 | Actual `.popup` with Dark appearance |

Retina sources live in `2x/`. Capture boundaries can round half pixels; these
are independent browser renders, not scaled copies of the standard captures.

## Demonstrated behavior

The release content script transforms the demo's standard HTML timestamp:
`3 days ago` → `Sep 2, 2026, 9:30 AM`. The original label is hidden. Both
captures use identical page styling; green emphasis is an external annotation
around the After card, not an invented extension effect.

Settings show the saved pattern `dd MMM yyyy, HH:mm` and IANA time zone
`Europe/London`. The genuine preview is `27 Aug 2026, 20:32` for source
`2026-08-27T19:32:28Z`. The two field excerpts and preview are presented as
separate detail cards, not a fabricated single application screen.

Replacement captures use `127.0.0.1`. Popup captures use the same local HTML
served under `demo.nomoreago.test`, mapped to loopback through Chrome's
host-resolver flag. The hostname is real browser state, not substituted text.
These are local demonstrations, not evidence of a public website integration.

## Reproduce

1. Build the Chrome release and load `dist/release/chrome` in an isolated
   profile with English locale and UTC time zone. Serve `../demo.html` over
   local HTTP. Use the viewports and device scales above.
2. For replacement captures, choose System date format and UTC in Settings.
   Disable processing, open the numeric loopback demo URL and capture `article`.
   Enable processing, wait for the exact date and confirm the relative source
   is hidden before capturing the same element again.
3. Save Custom format `dd MMM yyyy, HH:mm` and IANA `Europe/London` in Display.
   Reload the page to remove the temporary save notification, reopen Display,
   and capture at the 360px viewport.
4. Capture continuous regions spanning the actual Mantine input wrappers:
   format at x=18, y=342, width=324, height=157; zone at x=18, y=515,
   width=324, height=138. Do not edit or substitute UI text.
5. Change only the viewport to 700px and capture `.options-preview`.
6. For popup captures, map `demo.nomoreago.test` to `127.0.0.1` using Chrome's
   `--host-resolver-rules` and open that hostname on the local server's port.
   Open the real extension popup document, bring the demo tab to the front,
   and reload the popup without activating its tab. Confirm the demo hostname,
   `Active` status and both enabled switches before capturing `.popup`.
7. Choose Light and Dark through Settings for the respective popup captures.
8. Repeat into `2x/` at twice the device scales, then run `pnpm store:assets`.
   Refresh the fixed example date and relative label together for future
   captures if they should describe the current date.

## Composition and review

Raw images retain their native pixel dimensions at integer output coordinates.
The generator rejects oversize inputs rather than reducing them. The renderer
adds captions, separate framing and a before/after arrow, without changing
captured product content. A regression test checks that single-pixel stripes
survive both output sizes unchanged.

Store upload images are in `../chrome/` at 1280×800. Separate Retina previews
are in `../masters/` at 2560×1600. Browser/language footers and slide numbers
are intentionally absent.

An independent designer reviewed the initial images, rejected two art-direction
revisions with concrete findings, and approved all three final screenshots.
See [the design review](../DESIGN-REVIEW.md) for findings, dispositions and the
hashes of the exact approved files.
