# No More Ago

No More Ago is a browser extension for people who prefer exact dates to text
such as “3 months ago.” It replaces eligible standard and trusted specialized
timestamps with localized exact values while preserving the original page
state for restoration.

No More Ago changes an existing timestamp only when the page currently
presents that label as relative time and the extension also has a trusted
machine-readable timestamp. Absolute dates, clocks, unknown wording, and
sources with no existing timestamp label remain unchanged.

The current version processes standard HTML timestamps on accessible HTTP(S)
pages, including public Telegram channel pages under `https://t.me/s/*`.
Facebook, GitHub, Hacker News, supported Stack Exchange Q&A sites, Telegram Web
K, direct TikTok publications, LinkedIn, and Bluesky have specialized sources
for trusted or best-effort
timestamp inputs. These integrations preserve page-owned elements and links
while updating simple labels in place when needed. Instagram uses the standard
timestamp source with a specialized in-place presentation rule that preserves
styling hooks. Bluesky resolves public post times through anonymous requests to
the public AppView API. Canonical desktop YouTube watch pages also have specialized
local publication sources for calendar dates and explicitly zoned instants.
Site markup support is best-effort and may change independently of the
extension.

## Key Concepts

- **Exact value:** a localized date, with a time only when the trusted source
  represents an absolute instant.
- **Standard timestamp:** a `time[datetime]` value containing a complete date
  and time with an explicit, known UTC offset.
- **Calendar date:** a strict explicit `YYYY-MM-DD` value that retains its
  calendar day without becoming an instant or receiving a time-zone shift.
- **Specialized source:** a site-specific rule for richer markup, such as
  Facebook Story payloads, GitHub's relative-time widgets, Hacker News age
  widgets, approved Stack Exchange, Telegram Web K, and TikTok timestamps; the
  approved YouTube watch label and identity-matched loaded data or
  initial-document metadata; best-effort LinkedIn ID timestamps; or confirmed
  Bluesky post labels backed by public AppView `indexedAt`. Specialized
  rules take precedence over the generic rule when both accept the same source.
- **Relative presentation:** the current page-owned label must match a
  conservative localized relative-time pattern. Recognition is best-effort
  for these 40 locales: Arabic, Bulgarian, Catalan, Czech, Danish, German,
  Greek, English, Spanish, Latin American Spanish, Persian, Finnish, Filipino,
  French, Hebrew, Hindi, Croatian, Hungarian, Indonesian, Italian, Japanese,
  Korean, Lithuanian, Norwegian Bokmål, Dutch, Polish, Brazilian Portuguese,
  European Portuguese, Romanian, Russian, Slovak, Slovenian, Serbian, Swedish,
  Thai, Turkish, Ukrainian, Vietnamese, Simplified Chinese, and Traditional
  Chinese. Unknown wording fails closed and stays unchanged. This
  recognition set is not the interface-language set: it includes
  Lithuanian and Slovenian, while the interface adds Bengali and Malay.
- **Global switch:** enables or disables all timestamp processing.
- **Run mode:** `All supported sites` runs everywhere except hostnames in
  Excluded sites; `Selected sites only` runs only on hostnames in Allowed
  sites.
- **Excluded sites:** exact hostnames skipped while `All supported sites` is
  active.
- **Allowed sites:** exact hostnames processed while `Selected sites only` is
  active. Both lists persist independently, so switching modes never moves,
  merges, or deletes an entry. Each list holds up to 1000 hostnames; adding
  another entry reports that the list is full.
- **Display settings:** choose the date format and time zone used for output.
- **Appearance:** `System`, `Light`, or `Dark`, chosen in the Settings header
  and applied immediately to the popup and Settings.
- **Interface language:** the popup and Settings follow the browser's UI
  language preferences across 40 supported languages, using the catalog
  selected by the browser and falling back to English when none matches. There is no language setting inside the extension.
- **Debug logs:** optional local diagnostics that can be downloaded for a
  problem report.

## Installation

No More Ago is not published in browser stores yet. Installation currently
requires a browser-specific archive from the repository's GitHub Releases
page, or a local build made by following the
[development guide](DEVELOPMENT.md).

1. Download `no-more-ago-<version>-<browser>.zip` and `SHA256SUMS.txt` from
   the release, or build `dist/release/<browser>.zip` from source.
2. Verify a downloaded archive in the download directory:

   ~~~sh
   shasum -a 256 --ignore-missing -c SHA256SUMS.txt
   ~~~

3. Follow the steps for your browser below. Once installed, the toolbar icon
   is the Exact Point mark: a ring with a marker at the top.

### Chrome and Edge

Requires Chrome or Edge 111 or later.

1. Extract the Chrome or Edge archive.
2. Open the browser's extension management page.
3. Enable Developer mode.
4. Choose **Load unpacked**.
5. Select the extracted archive directory.

### Firefox

Requires Firefox 128 or later.

1. Extract the Firefox archive.
2. Open `about:debugging#/runtime/this-firefox`.
3. Choose **Load Temporary Add-on**.
4. Select `manifest.json` from the extracted archive.

## Quick Start

1. Install the archive for your browser.
2. Open an HTTP(S) page with a relative label backed by a trusted timestamp.
3. Open the No More Ago toolbar popup.
4. Leave **Extension enabled** and **Enabled on this site** switched on. By
   default the run mode is `All supported sites`, so every supported page is
   processed unless its hostname is in Excluded sites.
5. Eligible relative labels are replaced with exact dates.

For example, `<time datetime="2026-08-27T19:32:28.000Z">9h</time>` may
become “Aug 27, 2026, 9:32 PM.” Trusted Facebook, GitHub, Hacker News, Stack
Exchange, Telegram Web K, and supported TikTok timestamps plus best-effort
LinkedIn ID timestamps and confirmed Bluesky labels can also become exact dates.
Instagram's simple standard
timestamp labels retain their page-owned elements and styles. A supported
YouTube watch calendar date becomes a localized date without a time, while a
supported zoned publication instant becomes a localized date and time. Instant
output follows
the selected format, browser locale, and time zone; calendar-date output
preserves the same day in every configured time zone.

For comparison, labels such as `Aug 22, 2026`, `16:08`, or unknown wording
such as `2 hrs` remain exactly as the page supplied them. The extension does
not add a date when a source, such as a TikTok profile card, has no existing
timestamp label.

## Features

### Exact Date Replacement

No More Ago processes standard `time[datetime]` values on accessible HTTP(S)
pages only when the value is an unambiguous global date-time and the current
visible label is recognized as relative. Accepted values have a complete date,
a valid time, and `Z`, a colonized numeric offset, or a compact numeric offset.
Date-only, local, malformed, impossible, and unknown-zone values remain
unchanged. Visible text is used only to classify relative presentation; it is
never parsed to obtain the date or time.

GitHub, Hacker News, supported Stack Exchange Q&A sites, and LinkedIn have
specialized timestamp sources. Hacker News support applies to
`span.age[title]` on the exact `news.ycombinator.com` hostname. Stack Exchange
support applies to Stack Exchange network Q&A and per-site meta host shapes,
plus the branded Q&A roots `stackoverflow.com`, `serverfault.com`,
`superuser.com`, `askubuntu.com`, `mathoverflow.net`, and `stackapps.com`.
Known localized Stack Overflow Q&A hosts are included; service hosts such as
Chat, API, Data Explorer, Area 51, and blogs are excluded.

These specialized sources still require a current relative label. A trusted
machine value beside `2 hours ago` may be shown exactly, while the same value
beside `Aug 22, 2026` or an unknown label remains page-owned and unchanged.

The Stack Exchange adapter accepts only simple labels from these approved
shapes: `span.relativetime[title]`, `span.relativetime-clean[title]`,
`time.s-user-card--time[title]` without `datetime`, and the exact
`a[href="?lastactivity"][title]` link. Standard `time[datetime]` elements keep
using the generic fallback. All sources share presentation, restoration, and
dynamic-page lifecycle behavior. When a specialized and generic rule both
accept the same source, the specialized rule wins.

On Facebook domains, supported post timestamps are proven by structured
`Story.creation_time` values from initial JSON payloads and selected
Story-bearing GraphQL operation families. Support is evidence-based rather than
tied to an allowlist of feed surfaces: public and signed-in pages are supported
best-effort whenever they expose the same proof. A Facebook-only main-world
bridge transfers only the opaque tracking token and Unix-seconds timestamp to
the isolated content runtime. The page world is not an authentication boundary,
so the bridge holds no secrets or privileged capability. Messages are bounded
and structurally validated as page-derived input. The token must exactly match
the post timestamp link, and a current visible compact or directional relative
label must also be present. A textless SVG shape may still prove source
association, but it receives no output because it has no page-owned timestamp
label to classify.

The bridge is inert until existing global and site policy enables the isolated
runtime. Same-window lifecycle messages make its installed wrappers active or
inert, while the isolated runtime independently follows extension policy.
Disabling stops consumption, clears temporary associations, and restores
page-owned content.
Visible labels, ARIA labels, link destinations, and elapsed time are never
timestamp fallbacks. Comments, Reels, and future Facebook shapes remain
unchanged unless they independently satisfy the same Story proof, token
correlation, and source-shape contract.

On the exact `www.instagram.com` hostname, simple standard `time[datetime]`
labels such as `33w` are updated in place so their element identity, classes,
inline styles, and surrounding layout hooks remain page-owned. Absolute labels
such as `January 8` stay unchanged. Complex timestamp markup keeps using the
generic adjacent-output fallback when its own current label is recognized as
relative. This presentation integration is best-effort and does not infer
dates from Instagram's visible text.

On the exact `bsky.app` hostname, remote-enriched support covers feed posts,
profile activity, replies on an individual-post page, thread replies, and one
level of quoted posts. Other sections are best-effort. Only currently relative
labels under a confirmed post structure are changed; an already exact expanded
root timestamp remains untouched. The extension accepts only the matching public
AppView `indexedAt`, never visible text, localized tooltips, a record key, or
`record.createdAt`. A failed lookup or validation leaves the original label
unchanged.

LinkedIn posts, reshares, comments, and replies have a best-effort specialized
source when one visible timestamp label is locally associated with exactly one
explicit `activity`, `ugcPost`, `share`, or `comment` ID. The adapter derives
Unix milliseconds from the ID's upper bits and preserves the full millisecond
value through the selected format and time zone. This is best-effort ID
creation or allocation time: LinkedIn does not document the encoding, and the
result is not guaranteed to equal an official `createdAt`, `publishedAt`, or
visible publication time.

LinkedIn uses the shared 40-locale relative classifier for its current label,
including supported compact forms, localized forms such as Polish `2 tyg.`,
and the source-owned English phrase `just now`. Unknown or absolute labels
remain unchanged. The adapter never calculates a date from that label,
`Edited`, an ARIA label, or nearby display text.
Missing, malformed, future, or ambiguous ID evidence leaves the label
unchanged. The adapter makes no LinkedIn API or other timestamp request and
preserves adjacent metadata, links, attributes, and page-owned element identity
when replacing the timestamp text.

Representative public X and Twitter feed, post, thread, quoted-post, and
nested-card shapes are verified through the same standard `time[datetime]`
path. No X/Twitter-specific source is registered. This support is best-effort
and covers only eligible public light-DOM timestamps; private content, Shadow
DOM, and future third-party markup remain outside the compatibility claim.

Public Telegram channel pages under `https://t.me/s/*` use the same standard
`time[datetime]` path as other HTTP(S) pages. Their complete, explicitly zoned
post timestamps receive generic validation, but output is created only for a
recognized relative label such as `2 hours ago`. A clock such as `16:08`
remains unchanged. No Telegram-specific public-page parser is used.

Telegram Web K support applies only to `https://web.telegram.org/k/*`. It
can replace one ordinary relative message label when its matching bubble has an
exact ten-digit Unix-seconds `data-timestamp` value. A normal clock such as
`16:08` remains unchanged by default. Eligible text changes in place, so
separate edited indicators, delivery status, counters, icons, links, and their
event behavior remain page-owned. Primary edit-time labels and ambiguous
forwarded or saved-message shapes are left unchanged. Telegram Web A is
unsupported because it does not expose the same safe machine-readable instant.
The extension never parses Telegram's visible or localized label as timestamp
evidence.

TikTok specialized support applies only to direct HTTPS `www.tiktok.com`
`/@handle/video/<post-id>` or `/@handle/photo/<post-id>` pages whose markup
matches the tested guest or authenticated shapes. Direct video and photo pages
replace one simple label in place only when it is currently relative, such as
`3d`; absolute labels such as `5-14` remain unchanged. Profile cards have no
existing timestamp label, so profile grids use only the universal generic rule
and receive no appended date.

For a current publication, the extension first uses a string-valued
`createTime` from the page's universal hydration JSON when the same record's
string-valued `id` exactly matches the current post ID. Otherwise it accepts a
strict 19-digit decimal post ID and derives Unix seconds as
`BigInt(postId) >> 32n`. Both sources must fall between
`2016-01-01T00:00:00Z` and the browser's current time plus 24
hours. The ID-derived value is suitable for date-and-minute display, but its
seconds are not claimed to be TikTok's exact publication second. A custom
format that includes seconds still formats the decoded instant normally.

TikTok processing reads only the current URL, supported DOM shapes, and the
already loaded universal hydration script. It does not request TikTok data,
inspect response bodies, or replace page `fetch` or `XMLHttpRequest`. Initial
hydration can be stale after in-page navigation, so an embedded timestamp is
never used for another post ID. Unsupported or ambiguous shapes are left
unchanged. As with every site adapter, compatibility is best-effort because
TikTok can change its markup independently.

On a canonical `www.youtube.com/watch?v=<video-id>` URL, YouTube processing
pairs the approved visible publication label with recognized data already
loaded in the document. It prefers identity-matched player publication data,
then, on an initial full-document load, falls back to exactly one head
`meta[itemprop="datePublished"]` value. Both sources accept either a strict
calendar date or a complete explicitly zoned instant. The extension never
requests YouTube data. The current label must also be recognized as relative,
such as `3 months ago`; an absolute label such as `Aug 29, 2026` remains
unchanged even when valid local publication data exists. Visible text and
arbitrary attributes are never inferred as dates.

The generic runtime watches relevant dynamic content in each reachable
HTTP(S) document. Newly added or changed timestamps are processed without a
full page reload. Before processing dynamic YouTube content, the runtime
samples the current URL. On a provenance-changing transition, such as changing
the Watch video or leaving Watch, it restores obsolete extension-owned output
and processes the new route generation. Same-video query changes and
non-Watch-to-non-Watch changes leave the current processing generation intact.
A changed-video Watch handoff accepts only loaded player data whose two video
identities match the current URL. It watches only the exact recognized
player-assignment scripts, so either signal-first or data-first navigation can
become live without polling.

YouTube publication metadata has no video identity. It therefore remains
quarantined for the entire same-document changed-video handoff, even after
metadata or label mutations. If valid identity-matched loaded publication data
never appears, that Watch label remains page-owned until a full document load.
Navigating to the captured Home, Search, Channel, or another unsupported route
restores obsolete Watch output but does not add list-surface or fallback
support.

### Global and Site Controls

The toolbar popup shows the current hostname once, the processing status
(`Active`, `Extension is off`, `Excluded on this site`, `Not selected for this
site`, `Cannot run on this page`, or `Could not process this page`), and the
active run mode.

- **Extension enabled** controls the extension everywhere.
- **Enabled on this site** controls the exact top-level hostname for the whole
  tab, including reachable frames. In `All supported sites` mode, turning it
  off adds the hostname to Excluded sites; in `Selected sites only` mode,
  turning it on adds the hostname to Allowed sites. While the extension is
  off the switch stays visible but cannot be changed.
- **Report this site** opens a prefilled GitHub issue for missing or broken
  support.
- **Settings** opens the browser-managed full Options page, where the Sites
  section holds the run mode and the list the active mode owns.

Disabling the extension globally or for a site restores the original page
content immediately. Enabling it again immediately processes the current page.
Every open popup and Settings page reflects a change made elsewhere without a
reload.

The current top-level hostname controls every processed frame in the tab. A
frame's own HTTP(S) URL determines which timestamp sources apply there.
Browser-restricted and non-HTTP(S) documents remain unchanged.

### Display Settings

Choose **Settings** in the toolbar popup to open the browser-managed Options
page and select how dates are displayed. The page also remains available from
the browser extension controls.

**Date format**

- **System** uses the browser locale's medium date and short time format for
  instants, and its localized medium date-only format for calendar dates.
- **Custom format** accepts Unicode date and time tokens for instants and shows
  a preview.
- For supported YouTube calendar dates, a custom format retains its date
  fields, order, and style while removing time fields and their orphaned
  separators. A time-only or otherwise unusable date projection safely falls
  back to the localized medium date-only format. Zoned YouTube values use the
  selected instant format.

Example custom patterns:

| Pattern | Example output |
| --- | --- |
| `yyyy-MM-dd HH:mm` | `2026-08-23 14:37` |
| `d MMM yyyy, HH:mm` | `23 Aug 2026, 14:37` |
| `EEEE, d MMMM yyyy` | `Sunday, 23 August 2026` |

Invalid patterns cannot be saved. The previously saved format remains active.

**Time zone**

- **System** uses the browser's current time zone.
- **UTC** displays every supported timestamp in UTC.
- **IANA** accepts a named zone such as `Europe/Nicosia` or
  `America/New_York`.

Time-zone selection applies only to absolute instants. A calendar date remains
the same calendar day under System, UTC, and every IANA choice.

Saving display settings refreshes supported timestamps on open pages whenever
the browser allows it.

### Diagnostics and Reports

Diagnostic collection is disabled by default. To collect bounded local
information about generic, specialized, or frame processing for a problem
report:

1. Open the options page.
2. Enable **Debug logs**.
3. Reproduce the problem.
4. Choose **Download logs** to save
   `no-more-ago-diagnostics.zip`.
5. Choose **Open GitHub issue** and attach the archive if it is useful.

Logs are stored locally and capped at 5,000,000 bytes. **Clear logs** removes
the current entries. Disabling **Debug logs** also deletes retained logs.

Downloaded diagnostic records may include the sender frame's hostname and
whether the tab was incognito. An invalid-timestamp record may also contain the
rejected source value only when it is one to twenty decimal digits. Successful
events never retain raw source timestamps. Records exclude URL paths, query
strings, fragments, message text, authors, chat or message identifiers, and
other page content.

The extension does not submit diagnostic data automatically. Reporting opens a
GitHub form for review and manual submission.

## Common Workflows

### Disable One Site

1. Open the site.
2. Open the toolbar popup.
3. Switch off **Enabled on this site**.

In `All supported sites` mode the hostname is added to Excluded sites; in
`Selected sites only` mode it is removed from Allowed sites. The original page
content is restored without reloading the page. Settings lists the active
mode's hostnames with one `Remove` action per row; removing a hostname
reverses the rule for it.

### Change the Date Presentation

1. Open Settings and choose **Display**.
2. Choose **System** or **Custom format**.
3. Choose **System**, **UTC**, or **IANA** for the time zone.
4. Check the always-visible preview.
5. Choose **Save display settings**.

Appearance is not part of this form. Change it from the **Appearance** select
in the Settings header; it is saved immediately by its own background command,
independent of the display settings form.

### Report a Site

Open the toolbar popup and choose **Report this site**. The report form includes
the page URL, extension version, and browser when those values can be
collected safely. **Open GitHub issue** in Settings opens the same form without
a page, so its URL field starts empty.

Use this action both to request support for a new site and to report dates that
are not working correctly on a supported site.

### Reset All Settings

Choose **Reset all settings** in the **Reset** section of Settings, or from
the recovery view when settings cannot be read, then confirm with **Reset
everything**. It restores:

- global processing enabled;
- the `All supported sites` run mode with both Excluded sites and Allowed
  sites emptied;
- the system date and time format;
- the system time zone;
- appearance set to System;
- Debug logs disabled with retained entries removed.

## Inputs and Outputs

| Situation | Result |
| --- | --- |
| Recognized relative label plus a trusted timestamp | The trusted instant or calendar date is shown with the configured presentation. |
| Absolute date, clock, unknown wording, or absent label | Page content remains unchanged even when machine-readable timestamp data exists. |
| Bluesky identity, lookup, response, or timestamp cannot be validated | The original relative label remains unchanged. |
| Relative direct TikTok video/photo label | Matching embedded `createTime` is preferred; otherwise a plausible ID-derived date is rendered in place. |
| TikTok profile card without an existing timestamp label | No date is appended. |
| Relative canonical YouTube watch label backed by a calendar date | The label is replaced with the same localized calendar day and no time; time-zone selection is ignored. |
| Relative canonical YouTube watch label backed by a zoned instant | The label is replaced with a localized date and time using the selected instant presentation. |
| Same-document navigation to another eligible Watch video | Obsolete output is restored; only current dual-ID loaded publication data may produce new output. |
| Same-document navigation to a list or unsupported route | Obsolete Watch output is restored and the unsupported route remains unchanged. |
| YouTube Home, Search, or Channel list page | Publication labels remain unchanged. |
| Generic date-only `time[datetime]` | Page content remains unchanged because generic processing is instant-only. |
| Invalid, incomplete, or ambiguous timestamp | Page content remains unchanged. |
| New eligible timestamp added dynamically | It is processed using current settings. |
| Global or top-level site switch is disabled | Original page content is restored across reachable frames. |
| Format or time zone changes | Existing output is reformatted when reachable. |

YouTube support is Watch-only. Home, Search, and Channel list pages remain
unchanged, and the extension makes no fallback request for publication data.

## Permissions and Privacy

The extension requests:

- **Access to all HTTP and HTTPS sites:** allows standard timestamps on
  accessible pages, lets the run mode and its Excluded and Allowed site lists
  apply on any site, and supports future specialized sources.
- **Scripting:** registers, updates, and removes the universal isolated content
  runtime plus the Facebook-only main-world payload bridge.
- **Web navigation:** enumerates reachable HTTP(S) frames so settings refreshes
  can verify each frame's revision acknowledgement, and coalesces YouTube
  history-state updates into payload-free route signals for the exact frame.
- **Storage:** keeps one versioned settings snapshot (schema version 1), a
  copy of the previous snapshot used to recover from a failed write, and
  optional diagnostic entries locally.

No More Ago uses the current visible label only to decide whether its
presentation is recognized as relative. It never derives the timestamp value
from visible relative or absolute labels, ARIA labels, nearby text, or elapsed
time. Apart from the explicitly documented Bluesky and TikTok identity inputs,
link destinations are not timestamp inputs. The Hacker News specialized source
trusts only the explicit zoned timestamp in its approved `span.age[title]`
shape. The Stack Exchange source reads `title` only from its listed timestamp
widgets and accepts only strict explicit-zone values plus the known
comment-license suffix. LinkedIn is the best-effort derived-ID exception: it
accepts only explicit supported IDs in approved local URL, URN, component-key,
or data-anchor evidence and makes no network request. TikTok is the documented
exception for URL identity: it accepts only a strict post ID from the exact
supported current publication URL. In-place sources change only their
selected label text; titles, link destinations, element identity, attributes,
and event listeners remain intact. Standard processing remains limited to
ordinary light-DOM `time[datetime]` elements.

The Facebook source accepts only typed `Story` objects with a bounded
`creation_time` and a direct Story token or canonical
`comet_sections.timestamp.story` token. Dynamic selection requires a Facebook
`/api/graphql/` request, a synchronously inspectable bounded form body, and an
anchored Story-bearing `fb_api_req_friendly_name`. Fetch response clones are
read as capped streams; XHR requires POST plus an empty or `text` response type.
At most two selected responses are inspected concurrently, and lifecycle
changes reject work from an older activation generation.

Only structurally validated minimal token/timestamp records cross into the
isolated runtime. The associations remain in document memory and are cleared on
disable or teardown. Response content, post text, authors, comments, reactions,
and account data are not persisted, retained in diagnostics, or sent as
telemetry. Facebook support adds no permission beyond the manifest permissions
listed above and has no visible-text or elapsed-time fallback.

The Telegram Web K source trusts only a matching message bubble's ten-digit
Unix-seconds `data-timestamp` and one structurally proven ordinary clock. It
does not inspect message text, authors, identifiers, localized titles, or full
Telegram URLs. Public `t.me/s/*` pages remain on standard `time[datetime]`
processing.

Bluesky support sends public actor identifiers from confirmed post permalinks
and the resulting public AT post URIs to `https://public.api.bsky.app` solely
to retrieve the server-observed exact post time. Requests are anonymous,
credential-free, bypass the HTTP cache, and have a finite deadline. They include
no cookies, authorization headers, account tokens, post content, settings, or
unrelated page data. Successful mappings remain only in document memory while
connected sources reference them. Teardown discards them; failure leaves the
page unchanged and does not start automatic retry.

TikTok support adds no permissions, settings, accounts, network requests, or
external service. Successful processing does not retain post IDs, raw source
timestamps, URL paths, authors, titles, or page content in diagnostics.

YouTube publication processing reads only recognized values already present
in the document. It does not make a network request or perform a player lookup.

It does not derive YouTube dates from visible relative text, page titles, ARIA
labels, arbitrary `data-*` attributes, nearby text, or elapsed time, and does
not modify those page-provided attributes. Standard processing remains limited
to ordinary light-DOM `time[datetime]` elements; Shadow DOM and additional
source types are deferred.

## Limitations

- Generic support applies to eligible standard timestamps on accessible
  HTTP(S) pages whose current label is recognized as relative. Arbitrary,
  absolute, and unknown page labels remain unchanged.
- Facebook, GitHub, Hacker News, Stack Exchange, Instagram, Telegram Web K,
  TikTok, LinkedIn, Bluesky, and YouTube are best-effort integrations whose markup and,
  where applicable, payload contracts can change independently of the
  extension.
- Telegram Web A and Telegram-specific processing outside public `t.me/s/*`
  pages and Web K are unsupported. Independently eligible standard timestamps
  may still use the universal generic rule.
- TikTok specialized support is limited to tested direct
  `www.tiktok.com/@.../video/...` and `/photo/...` shapes. Profiles, For You,
  Following, search, embeds, LIVE,
  TikTok Studio, short/mobile links, other subdomains, and non-HTTPS pages do
  not receive TikTok-specialized processing. Independently eligible standard
  timestamps may still use the universal generic rule.
- A timestamp decoded from a TikTok post ID is a validated fallback with
  date-and-minute precision, not proof of TikTok's exact publication second.
  TikTok markup and embedded-state compatibility remain best-effort.
- YouTube support is limited to canonical desktop
  `www.youtube.com/watch?v=<11-character-video-id>` pages with the approved
  visible relative label and recognized loaded publication data, or one
  `datePublished` metadata value at the initial full-document boundary. Values
  must be a strict calendar date or a complete explicitly zoned instant.
  Same-document changed-video handoffs require current dual-ID loaded data;
  unbound metadata stays quarantined until a full document load. Mobile,
  Music, embed, Shorts, list surfaces, general YouTube SPA support, fallback,
  and player/API lookup are not supported by this path.
- YouTube calendar dates use the localized medium date style in System mode.
  Custom mode projects only the configured calendar fields and falls back to
  that localized date-only style when the projection is unusable. It never
  adds a time or applies the configured time zone.
- YouTube support is Watch-only. Home, Search, and Channel list publication
  labels remain unchanged, and no fallback request is made for them.
- The interface supports 40 languages; the browser selects the catalog.
- Safari is not a current build target.
- Browser-internal and other restricted pages cannot run the content script.
- Frames that are inaccessible or use a non-HTTP(S) scheme remain unchanged.
- Shadow DOM, unapproved page labels, durations, generic date-only values,
  local date-times, and other unsupported timestamp forms remain unchanged.
- Website markup can change at any time, so compatibility is best-effort and
  is not a promise about future markup.
- The extension is not yet distributed through browser stores.

## Documentation

- [Privacy information](docs/PRIVACY.md)
- [Support](docs/SUPPORT.md)
- [Chrome store materials](docs/STORE.md)
- [Firefox Add-ons submission](docs/FIREFOX_STORE.md)

- [Development](DEVELOPMENT.md)
- [LLM agent rules](AGENTS.md)
- [Feature specifications](specs/)
