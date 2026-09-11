# Chrome Web Store Materials

This document contains the materials and current status of the first No More
Ago Chrome listing. Firefox and Edge listings, translated screenshots, video
and marquee artwork are outside this package.

## Current listing status

On 2026-09-08, Chrome Web Store accepted the version 0.1.0 package and created
draft item `pcaimklimkjljhmbfkhidealekkiopbd`. It has not been submitted for
review or published.

All 40 localized descriptions were saved, reloaded and compared with their
source files. The global icon, three screenshots and small promotional tile
were uploaded. The category is Productivity → Tools; distribution is free,
public and available in all regions. Permission explanations and reviewer test
instructions are saved. Data-use declarations still require completion.

The privacy and support documents are maintained at the links below.
Verify their public availability before submitting the listing.

The accepted Chrome archive has SHA-256
`5cdc790488a12527db95460edb261b0aba6ef3c092455b5f82cc5c6f2aa02625`.
It was built from the release source with no runtime changes during listing
preparation. Finished images are available under `assets/store/chrome/`.
Screenshots use actual Chrome release-build captures from a clean local
demonstration and passed independent designer review on 2026-09-05.

## Use the descriptions

Open `assets/store-listings/<locale>.txt` and paste its full contents into the
Chrome dashboard's detailed-description field. Each file contains the complete
localized description and initial-release notes, with no processing required.
The English file is `en.txt`; use `nb.txt` for Chrome's Norwegian locale `no`.
Name and short description come from the extension manifest's locale messages.
Review translation changes with an independent agent.

## Maintained sources

| Material | Source |
| --- | --- |
| English master and 39 translations | `assets/store-listings/<locale>.txt` |
| Manifest name and summary | `src/_locales/<locale>/messages.json` |
| Locale set and Norwegian alias | `src/shared/i18n/locales.ts` |
| English privacy document | `docs/PRIVACY.md` |
| English support document | `docs/SUPPORT.md` |
| Original icon | `src/assets/icons/icon.svg` |
| English store-ready images | `assets/store/chrome/` |

English defines the product claims. Localized descriptions retain the same
paragraphs and release notes. Product names, domains and other
technical literals stay unchanged. There is no independent copy of privacy
policy prose in each translation. Store content is not shipped in runtime
bundles.

## Chrome field matrix

Verified against official documentation on 2026-09-05 and the live Chrome
dashboard on 2026-09-08.

| Field | Source and handling | Limit or disposition |
| --- | --- | --- |
| Name | Existing manifest message | 75 characters; `No More Ago` unchanged |
| Short description | Existing manifest message | 132 characters; plain text |
| Detailed description | Four paragraphs plus current release notes | 16,000 dashboard maximum; 4,000 project editorial budget |
| Language | Canonical registry plus dashboard mappings | `nb` → `no`; `he` → `iw`; regional separators become hyphens |
| Category | Current dashboard selection | Productivity → Tools |
| Homepage/support/privacy URLs | Links below | Public availability checked separately |
| Icon | Existing brand export | 128×128 PNG |
| Screenshots | Three English images | 1280×800 each; within the allowed 1–5 |
| Small promotional tile | English visual package | 440×280; global, not locale-specific |
| Video/marquee | Deferred | Not produced in this increment |
| Search keywords | Not applicable | No Edge/App Store keyword fields |

The 4,000-character long-description budget is an editorial choice. The live
official dashboard displayed a 16,000-character maximum on 2026-09-08; the
retrieved official listing guide does not state that maximum.

Official pages differ in their wording about whether video is required. The
image-specific page identifies the icon, small tile and screenshot as mandatory.
No video is part of this package.

## Locale mappings and English images

The description source files use these locale codes:

```text
ar bg bn ca cs da de el en es es_419 fa fi fil fr he hi hr hu id it
ja ko ms nl pl pt_BR pt_PT ro ru sk sr sv th tr uk vi zh_CN zh_TW
```

Use `nb.txt` for Chrome's `no` locale and `he.txt` for its `iw` locale. The
dashboard displays regional codes with hyphens, for example `pt-BR` for
`pt_BR.txt` and `es-419` for `es_419.txt`.

Use the English screenshot set and promotional tile as the global images.

## Ready-to-upload images

Use the finished files in `assets/store/chrome/`:

| File | Purpose | Dimensions |
| --- | --- | --- |
| `replacement.png` | Before/after timestamp example | 1280×800 |
| `control.png` | Date format and time-zone settings | 1280×800 |
| `appearance.png` | Light and dark popup themes | 1280×800 |
| `promo.png` | Small promotional tile | 440×280 |
| `icon.png` | Store icon | 128×128 |

The screenshots show real release-build behavior in a local demonstration.
The displayed hostname is a local test hostname. Green framing and the
Before/After arrow are promotional annotations outside the captured interface.

## Shared links and publication state

- Homepage: https://github.com/maximtop/no-more-ago
- Support: https://github.com/maximtop/no-more-ago/issues
- Intended privacy URL: https://github.com/maximtop/no-more-ago/blob/master/docs/PRIVACY.md

After publishing the supporting documents, verify all three links from a
signed-out context before submitting the listing. The privacy document must
be publicly readable. The first draft was populated through the Chrome
dashboard. The existing `go-webext` workflow remains available for subsequent
manual deployments; see
[the development guide](../DEVELOPMENT.md#store-configuration).

## Chrome privacy and permission copy

These English explanations are saved in the draft privacy tab. Choose
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

## Remaining submission work

1. Verify the shared URLs anonymously.
2. Complete the draft's homepage, support and data-use fields.
3. Resolve any remaining dashboard validation messages and submit for review.
4. Record the resulting review or publication state; a saved draft does not
   establish either status.

## Official references

- [Manifest name](https://developer.chrome.com/docs/extensions/reference/manifest/name)
- [Manifest description](https://developer.chrome.com/docs/extensions/reference/manifest/description)
- [Supported locales](https://developer.chrome.com/docs/extensions/reference/api/i18n#locales)
- [Listing fields and localization](https://developer.chrome.com/docs/webstore/cws-dashboard-listing/)
- [Supplying images](https://developer.chrome.com/docs/webstore/images/)
- [Privacy fields](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy/)
