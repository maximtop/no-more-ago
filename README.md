# No More Ago

No More Ago is a browser extension for people who prefer exact dates to text
such as “3 months ago.” It replaces eligible standard and trusted specialized
timestamps with localized exact values while preserving the original page
state for restoration.

The current version processes standard HTML timestamps on accessible HTTP(S)
pages, including public Telegram channel pages under `https://t.me/s/*`.
GitHub, Hacker News, supported Stack Exchange Q&A sites, and Telegram Web K
have specialized sources for trusted timestamp widgets. These integrations
preserve page-owned elements and links while updating simple labels in place
when needed. Instagram uses the standard timestamp source with a specialized
in-place presentation rule that preserves styling hooks. Site markup support is
best-effort and may change independently of the extension. Canonical desktop
YouTube watch pages also have specialized local publication sources for
calendar dates and explicitly zoned instants.

## Key Concepts

- **Exact value:** a localized date, with a time only when the trusted source
  represents an absolute instant.
- **Standard timestamp:** a `time[datetime]` value containing a complete date
  and time with an explicit, known UTC offset.
- **Calendar date:** a strict explicit `YYYY-MM-DD` value that retains its
  calendar day without becoming an instant or receiving a time-zone shift.
- **Specialized source:** a site-specific rule for richer markup, such as
  GitHub's relative-time widgets, Hacker News age widgets, or approved Stack
  Exchange and Telegram Web K timestamps, or the approved YouTube watch label
  and identity-matched loaded data or initial-document metadata. Specialized
  rules take precedence over the generic rule when both accept the same source.
- **Global switch:** enables or disables all timestamp processing.
- **Site switch:** stores an independent preference for the current hostname.
- **Display settings:** choose the date format and time zone used for output.
- **Debug logs:** optional local diagnostics that can be downloaded for a
  problem report.

## Installation

No More Ago is not published in browser stores yet. Installation currently
requires a browser-specific release artifact. If you need to create an artifact
from source, follow the [development guide](DEVELOPMENT.md).

### Chrome and Edge

1. Obtain and extract the `chrome.zip` or `edge.zip` release artifact.
2. Open the browser's extension management page.
3. Enable Developer mode.
4. Choose **Load unpacked**.
5. Select the extracted artifact directory.

### Firefox

1. Obtain and extract the `firefox.zip` release artifact.
2. Open `about:debugging#/runtime/this-firefox`.
3. Choose **Load Temporary Add-on**.
4. Select `manifest.json` from the extracted artifact.

## Quick Start

1. Install the artifact for your browser.
2. Open any HTTP(S) page that contains standard `time[datetime]` timestamps.
3. Open the No More Ago toolbar popup.
4. Leave **Global enabled** and **Enabled on _hostname_** switched on.
5. Eligible timestamps are replaced with exact dates.

For example, `<time datetime="2026-08-27T19:32:28.000Z">9h</time>` may
become “Aug 27, 2026, 9:32 PM.” Trusted GitHub, Hacker News, Stack Exchange,
and Telegram Web K timestamps can also become exact dates. Instagram's simple
standard timestamp labels retain their page-owned elements and styles. A
supported YouTube watch calendar date becomes a
localized date without a time, while a supported zoned publication instant
becomes a localized date and time. Instant output follows the selected format,
browser locale, and time zone; calendar-date output preserves the same day in
every configured time zone.

## Features

### Exact Date Replacement

No More Ago processes standard `time[datetime]` values on accessible HTTP(S)
pages when they contain an unambiguous global date and time. Accepted values
have a complete date, a valid time, and `Z`, a colonized numeric offset, or a
compact numeric offset. Date-only, local, malformed, impossible, and
unknown-zone values remain unchanged. Visible text is never parsed as a
fallback.

GitHub, Hacker News, and supported Stack Exchange Q&A sites have specialized
sources for their trusted timestamp widgets. Hacker News support applies to
`span.age[title]` on the exact `news.ycombinator.com` hostname. Stack Exchange
support applies to Stack Exchange network Q&A and per-site meta host shapes,
plus the branded Q&A roots `stackoverflow.com`, `serverfault.com`,
`superuser.com`, `askubuntu.com`, `mathoverflow.net`, and `stackapps.com`.
Known localized Stack Overflow Q&A hosts are included; service hosts such as
Chat, API, Data Explorer, Area 51, and blogs are excluded.

The Stack Exchange adapter accepts only simple labels from these approved
shapes: `span.relativetime[title]`, `span.relativetime-clean[title]`,
`time.s-user-card--time[title]` without `datetime`, and the exact
`a[href="?lastactivity"][title]` link. Standard `time[datetime]` elements keep
using the generic fallback. All sources share presentation, restoration, and
dynamic-page lifecycle behavior. When a specialized and generic rule both
accept the same source, the specialized rule wins.

On the exact `www.instagram.com` hostname, simple standard `time[datetime]`
labels are updated in place so their element identity, classes, inline styles,
and surrounding layout hooks remain page-owned. Complex timestamp markup keeps
using the generic adjacent-output fallback. This presentation integration is
best-effort and does not infer dates from Instagram's visible text.

Representative public X and Twitter feed, post, thread, quoted-post, and
nested-card shapes are verified through the same standard `time[datetime]`
path. No X/Twitter-specific source is registered. This support is best-effort
and covers only eligible public light-DOM timestamps; private content, Shadow
DOM, and future third-party markup remain outside the compatibility claim.

Public Telegram channel pages under `https://t.me/s/*` use the same standard
`time[datetime]` path as other HTTP(S) pages. Their complete, explicitly zoned
post timestamps receive generic validation and reversible adjacent output; no
Telegram-specific public-page parser is used.

Telegram Web K support applies only to `https://web.telegram.org/k/*`. It
expands one ordinary message clock from the matching bubble's exact ten-digit
Unix-seconds `data-timestamp` value, using the current format, locale, and time
zone. The clock text changes in place, so separate edited indicators, delivery
status, counters, icons, links, and their event behavior remain page-owned.
Primary edit-time labels and ambiguous forwarded or saved-message shapes are
left unchanged. Telegram Web A is unsupported because it does not expose the
same safe machine-readable instant. The extension never parses Telegram's
visible or localized clock text as timestamp evidence.

On a canonical `www.youtube.com/watch?v=<video-id>` URL, YouTube processing
pairs the approved visible publication label with recognized data already
loaded in the document. It prefers identity-matched player publication data,
then, on an initial full-document load, falls back to exactly one head
`meta[itemprop="datePublished"]` value. Both sources accept either a strict
calendar date or a complete explicitly zoned instant. The extension never
requests YouTube data. If neither eligible local source validates, the label
stays unchanged; visible relative text and arbitrary attributes are never
inferred as dates.

The generic runtime watches relevant dynamic content in each reachable
HTTP(S) document. Newly added or changed timestamps are processed without a
full page reload. On a same-document YouTube route change, the runtime samples
the current URL, restores obsolete extension-owned output, and processes the
new route generation. A changed-video Watch handoff accepts only loaded player
data whose two video identities match the current URL. It watches only the
exact recognized player-assignment scripts, so either signal-first or
data-first navigation can become live without polling.

YouTube publication metadata has no video identity. It therefore remains
quarantined for the entire same-document changed-video handoff, even after
metadata or label mutations. If valid identity-matched loaded publication data
never appears, that Watch label remains page-owned until a full document load.
Navigating to the captured Home, Search, Channel, or another unsupported route
restores obsolete Watch output but does not add list-surface or fallback
support.

### Global and Site Controls

The toolbar popup shows the current hostname and processing status.

- **Global enabled** controls the extension everywhere.
- **Enabled on _hostname_** controls the exact top-level hostname for the
  whole tab, including reachable frames.
- **Report this site** opens a prefilled GitHub issue for missing or broken
  support.

Disabling the extension globally or for a site restores the original page
content immediately. Enabling it again immediately processes the current page.

The current top-level hostname controls every processed frame in the tab. A
frame's own HTTP(S) URL determines which timestamp sources apply there.
Browser-restricted and non-HTTP(S) documents remain unchanged.

### Display Settings

Open the extension's options page from the browser extension controls to choose
how dates are displayed.

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
3. Switch off **Enabled on _hostname_**.

The preference is stored for that exact hostname and the original page content
is restored without reloading the page.

### Change the Date Presentation

1. Open the extension's options page.
2. In **Display**, choose **System** or **Custom format**.
3. Choose **System**, **UTC**, or **IANA** for the time zone.
4. Review the preview when using a custom format.
5. Choose **Save**.

### Report a Site

Open the toolbar popup and choose **Report this site**. The report form includes
the current hostname, page URL, extension version, and browser when those
values can be collected safely.

Use this action both to request support for a new site and to report dates that
are not working correctly on a supported site.

### Reset All Settings

Choose **Reset all settings** on the options page to restore:

- global processing enabled;
- default-enabled site behavior with saved overrides removed;
- the system date and time format;
- the system time zone;
- Debug logs disabled with retained entries removed.

## Inputs and Outputs

| Situation | Result |
| --- | --- |
| Eligible zoned standard, GitHub, Hacker News, Stack Exchange, or Telegram Web K timestamp | The trusted instant is shown with the configured exact-date presentation. |
| Eligible canonical YouTube watch calendar date | The label is replaced with the same localized calendar day and no time; time-zone selection is ignored. |
| Eligible canonical YouTube watch zoned instant | The label is replaced with a localized date and time using the selected instant presentation. |
| Same-document navigation to another eligible Watch video | Obsolete output is restored; only current dual-ID loaded publication data may produce new output. |
| Same-document navigation to a list or unsupported route | Obsolete Watch output is restored and the unsupported route remains unchanged. |
| Captured modern YouTube Home lockup with relative-only local data | It remains unchanged; this shape is evidenced as `unsupported-local`. |
| Captured legacy YouTube Search main-result shape with relative-only local data | It remains unchanged; this shape is evidenced as `unsupported-local`. |
| Captured Channel Videos modern grid lockup with relative-only local data | It remains unchanged; this shape is evidenced as `unsupported-local`. |
| Generic date-only `time[datetime]` | Page content remains unchanged because generic processing is instant-only. |
| Invalid, incomplete, or ambiguous timestamp | Page content remains unchanged. |
| New eligible timestamp added dynamically | It is processed using current settings. |
| Global or top-level site switch is disabled | Original page content is restored across reachable frames. |
| Format or time zone changes | Existing output is reformatted when reachable. |

The completed capture-backed list matrix classifies the investigated modern
Home lockup, legacy Search main result, and Channel Videos modern grid lockup
as `unsupported-local`. Therefore no captured local list surface is delivered.
The finalized Watch-only scope keeps those captures as safe no-op research
evidence. Canonical Watch remains the only positive YouTube surface; no
fallback request, provider, permission, or runtime behavior exists.

## Permissions and Privacy

The extension requests:

- **Access to all HTTP and HTTPS sites:** allows standard timestamps on
  accessible pages, keeps per-host preferences available, and supports future
  specialized sources.
- **Scripting:** registers, updates, and removes one universal content runtime
  at document start for all frames.
- **Web navigation:** enumerates reachable HTTP(S) frames so settings refreshes
  can verify each frame's revision acknowledgement, and sends a payload-free
  route-reconciliation signal to the exact frame after a history-state update.
- **Storage:** keeps settings and optional diagnostic entries locally.

No More Ago does not derive dates from visible relative or absolute labels,
link destinations, ARIA labels, nearby text, or elapsed time. The Hacker News
specialized source trusts only the explicit zoned timestamp in its approved
`span.age[title]` shape. The Stack Exchange source reads `title` only from its
listed timestamp widgets and accepts only strict explicit-zone values plus the
known comment-license suffix. In-place sources change only their simple label
text: the `title`, link destination, element identity, attributes, and event
listeners remain intact. Standard processing remains limited to ordinary
light-DOM `time[datetime]` elements.

The Telegram Web K source trusts only a matching message bubble's ten-digit
Unix-seconds `data-timestamp` and one structurally proven ordinary clock. It
does not inspect message text, authors, identifiers, localized titles, or full
Telegram URLs. Public `t.me/s/*` pages remain on standard `time[datetime]`
processing.

YouTube publication processing reads only recognized values already present
in the document. It does not make a network request or perform a player lookup.

It does not derive YouTube dates from visible relative text, page titles, ARIA
labels, arbitrary `data-*` attributes, nearby text, or elapsed time, and does
not modify those page-provided attributes. Standard processing remains limited
to ordinary light-DOM `time[datetime]` elements; Shadow DOM and additional
source types are deferred.

## Limitations

- Generic support applies to eligible standard timestamps on accessible
  HTTP(S) pages. Arbitrary page labels remain out of scope unless an explicitly
  registered specialized source accepts them.
- GitHub, Hacker News, Stack Exchange, Instagram, Telegram Web K, and YouTube
  are best-effort integrations whose markup can change independently of the
  extension.
- Telegram Web A and Telegram-specific processing outside public `t.me/s/*`
  pages and Web K are unsupported. Independently eligible standard timestamps
  may still use the universal generic rule.
- YouTube support is limited to canonical desktop
  `www.youtube.com/watch?v=<11-character-video-id>` pages with the approved
  visible label and recognized loaded publication data, or one
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
- Canonical Watch is the only positive YouTube source. The captured Home,
  Search, and Channel list shapes remain `unsupported-local`. The selected
  local-only outcome adds no player request; positive list replacement remains
  outside the finalized Watch-only scope.
- The recorded modern YouTube Home lockup shape contains relative-only local
  data and remains unchanged. Its `unsupported-local` qualification applies
  only to that captured shape; it is not Home replacement support or a promise
  about other experiments, future markup, or all list surfaces.
- The recorded legacy YouTube Search main-result shape also contains only
  relative local publication data and remains unchanged. Its
  `unsupported-local` qualification is not positive Search replacement
  support and does not generalize to shelves, the three excluded DOM
  identities, other Search experiments, future markup, or every list surface.
- The recorded Channel Videos modern grid lockup also contains relative-only
  local publication data and remains unchanged. Its `unsupported-local`
  qualification is not positive Channel replacement support and does not
  generalize to other Channel tabs, routes, shelves, Shorts, experiments,
  future markup, or all Channel pages.
- The interface is available in English only.
- Safari is not a current build target.
- Browser-internal and other restricted pages cannot run the content script.
- Frames that are inaccessible or use a non-HTTP(S) scheme remain unchanged.
- Shadow DOM, unapproved page labels, durations, generic date-only values,
  local date-times, and other unsupported timestamp forms remain unchanged.
- Website markup can change at any time, so compatibility is best-effort and
  is not a promise about future markup.
- The extension is not yet distributed through browser stores.

## Documentation

- [Development](DEVELOPMENT.md)
- [LLM agent rules](AGENTS.md)
- [Feature specifications](specs/)
