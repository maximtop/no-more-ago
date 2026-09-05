# Chrome Web Store Materials

This is a local preparation package for the first No More Ago Chrome listing.
No listing has been created or submitted by this workflow. Firefox and Edge
listings, store publication, translated screenshots, video and marquee artwork
are outside this increment.

## Current preparation status

The text package, independent reviews and English visual package are complete.
Three 1280×800 screenshots, the icon and small promotional tile are available
under `assets/store/chrome/`. Screenshots use actual Chrome release-build
captures from a clean local demonstration. Capture details and reproduction
steps are in [the capture record](../assets/store/captures/README.md).

## Prepare and inspect

From the repository root:

```sh
pnpm store:validate
pnpm store:render chrome en
pnpm store:render chrome ru
pnpm store:render chrome nb
pnpm store:assets
```

The renderer writes field values with clear headings to stdout. Copy the value
under the appropriate heading, excluding the heading and operational notes.
Review notices are written to stderr. Initial-release notes are appended to the
detailed description; they are not an invented separate Chrome field.

Validation is offline and also runs in `pnpm check`. Invalid content fails;
unreviewed or stale-review status alone does not. A passing command verifies
structural and domain constraints, not translation quality or store approval.

## Maintained sources

| Material | Source |
| --- | --- |
| English master and 39 translations | `assets/store-listings/<locale>.json` |
| Manifest name and summary | `src/_locales/<locale>/messages.json` |
| Locale set and Norwegian alias | `src/shared/i18n/locales.ts` |
| Shared links and budgets | `scripts/store/contracts.ts` |
| Independent review evidence | `assets/store/reviews.json` |
| English privacy document | `docs/PRIVACY.md` |
| English support document | `docs/SUPPORT.md` |
| Original icon | `src/assets/icons/icon.svg` |
| Sanitized capture sources | `assets/store/captures/` |
| English store-ready images | `assets/store/chrome/` |
| Retina preview masters (not store uploads) | `assets/store/masters/` |

English defines the product claims. Localized catalogs retain the same
paragraphs, release notes and caption roles. Product names, domains and other
technical literals stay unchanged. There is no independent copy of privacy
policy prose in each translation. Store content is not shipped in runtime
bundles.

## Chrome field matrix

Verified against official documentation on 2026-09-05.

| Field | Source and handling | Limit or disposition |
| --- | --- | --- |
| Name | Existing manifest message | 75 characters; `No More Ago` unchanged |
| Short description | Existing manifest message | 132 characters; plain text |
| Detailed description | Four paragraphs plus current release notes | 4,000-character project editorial budget |
| Language | Canonical registry plus explicit Chromium alias | 39 direct mappings; `nb` → `no` |
| Category | Select the appropriate current dashboard category | No category identifier fabricated locally |
| Homepage/support/privacy URLs | Shared link contract | HTTPS; public availability checked separately |
| Icon | Existing brand export | 128×128 PNG |
| Screenshots | Three English images | 1280×800 each; within the allowed 1–5 |
| Small promotional tile | English visual package | 440×280; global, not locale-specific |
| Video/marquee | Deferred | Not produced in this increment |
| Search keywords | Not applicable | No Edge/App Store keyword fields |

The 4,000-character long-description budget is an editorial choice, not a
verified Chrome dashboard maximum. The retrieved official listing guide does
not state that maximum. Confirm any additional field restrictions when the
real listing is created. Do not label the offline validator as a complete
simulation of the dashboard.

Official pages differ in their wording about whether video is required. The
image-specific page identifies the icon, small tile and screenshot as mandatory.
No video is part of this package; resolve any actual dashboard requirement at
listing creation.

## Locale mappings and English images

The store uses these source codes directly:

```text
ar bg bn ca cs da de el en es es_419 fa fi fil fr he hi hr hu id it
ja ko ms nl pl pt_BR pt_PT ro ru sk sr sv th tr uk vi zh_CN zh_TW
```

The remaining canonical code is `nb`, which renders to Chrome's `no` locale.
There is one Norwegian translation, not separate `nb` and `no` catalogs.
Unknown locale requests fail rather than silently returning English.

Use the English screenshot set as the global set. Translated captions are
maintained source material, but only English image files exist. The small
promotional tile is global, as specified by Chrome.

## Rebuild English artwork

Capture the actual extension using a clean local demonstration after obtaining
permission for browser work. Save seven raw PNG inputs under
`assets/store/captures/`: `before.png`, `after.png`, `format.png`, `zone.png`,
`preview.png`, `popup-light.png` and `popup-dark.png`, plus their Retina
counterparts in `2x/`. The maintained demonstration is
`assets/store/demo.html`. Do not use private account content.

Run `pnpm store:assets` to combine the seven raw captures directly with English
catalog captions and the existing icon. Captures retain their native pixel
size at integer coordinates, with no intermediate raster or resizing. Oversize
inputs fail with a recapture instruction. Use the pixel dimensions in the
capture record. The same command produces separate 2560×1600 Retina previews
in `assets/store/masters/`; upload the 1280×800 files from `chrome/`.
Composition uses locally installed Arial and Georgia fonts;
use the same font environment for identical output. Inspect all
three final images at full size and at 640×400 for clipping and readability.
The generator also writes `promo.png` and `icon.png`. The revised screenshots
passed an [independent design review](../assets/store/DESIGN-REVIEW.md).

## Translation review

An independent language-capable agent reviews every translation against the
English master and the corresponding UI terminology. Checks cover omitted or
added claims, unsupported promises, privacy drift, natural wording, preserved
names and captions. Russian is reviewed as its own locale.

Each record identifies the reviewer, date, findings and SHA-256 hashes of the
parsed English and localized listing JSON. Changing either listing makes the
review stale. `reviewed` means that semantic review passed, not native-speaker
certification. Review records with findings or stale hashes are reported
without blocking ordinary editing or CI. Resolve semantic findings and review
the final text before treating the materials task as complete.

## Shared links and publication state

The shared contract uses the project's GitHub repository for the homepage and
its issue tracker for support. Those destinations match existing project
references. The intended privacy URL points to `docs/PRIVACY.md` on `master`.
This change alone does not publish that document. After the documents are
merged/published, verify all three destinations from a signed-out context and
confirm that the privacy document is publicly readable before filling a live
listing. Offline validation checks syntax and consistency, not availability.

No new website, hosting deployment, store item ID, or verified publisher status
is assumed. A dedicated public landing page can replace the shared destination
later without translating its URL in every catalog.

## Chrome privacy and permission copy

These English explanations are prepared for the future privacy tab. Choose
actual dashboard declarations according to the implementation and the current
field definitions. Do not blindly mark all data use as absent merely because
there is no telemetry.

### Single purpose

No More Ago replaces supported relative timestamp labels on web pages with
exact, localized dates when trustworthy timestamp data is available. Date
format, time-zone and site controls determine how and where that replacement
runs.

### Host access

The extension reads eligible timestamps on HTTP(S) pages and restores their
original labels when processing is disabled. Universal host access enables
standard timestamp support across websites and the documented specialized
integrations. The top-level site's settings control processing in reachable
frames. It is not used for unrelated browsing-data collection.

### Scripting

The extension registers and injects its timestamp runtime in eligible documents
and reachable frames. It refreshes existing tabs when settings change. A
Facebook-specific bridge reads limited timestamp evidence from selected page
payloads while processing is enabled.

### Storage

Local extension storage holds date/time-zone settings, site lists, appearance,
a recovery copy of settings, and optional bounded diagnostic logs. These are
not uploaded as telemetry.

### Web navigation

Navigation information enumerates reachable HTTP(S) frames so settings changes
can enable, disable or refresh timestamp processing throughout a tab. It is
not used to create a browsing-history database.

### Data use and external requests

Read the [privacy information](PRIVACY.md) before completing declarations.
Bluesky timestamp resolution sends public actor/post identifiers anonymously
to its public AppView API. Site reports open GitHub with user-initiated report
context, which can include the current URL. Diagnostics remain local unless
the user chooses to share an exported file. There is no developer-operated
telemetry endpoint, account requirement, or sale of user data.

## Handoff to future listing creation

1. Verify current copy, translation review records and image outputs locally.
2. Publish the supporting documents and verify the shared public URLs.
3. Use the normal Chrome release artifact to create an unsubmitted dashboard
   draft during a separately authorized store task.
4. Add the English master, global English screenshots, icon and small tile.
5. Add the localized descriptions for the 40 mapped destinations, using the
   manifest-supplied names and summaries.
6. Check current field restrictions, category, privacy/data-use declarations,
   and any other dashboard-only requirements. Keep the item unsubmitted until
   the separate publication workflow is requested.

## Official references

- [Manifest name](https://developer.chrome.com/docs/extensions/reference/manifest/name)
- [Manifest description](https://developer.chrome.com/docs/extensions/reference/manifest/description)
- [Supported locales](https://developer.chrome.com/docs/extensions/reference/api/i18n#locales)
- [Listing fields and localization](https://developer.chrome.com/docs/webstore/cws-dashboard-listing/)
- [Supplying images](https://developer.chrome.com/docs/webstore/images/)
- [Privacy fields](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy/)
