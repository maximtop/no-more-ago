# No More Ago

No More Ago is a browser extension for people who prefer exact dates to text
such as “3 months ago.” It replaces eligible standard and trusted specialized
timestamps with localized date and time text while preserving the original
page state for restoration.

The current version processes standard HTML timestamps on accessible HTTP(S)
pages, including public Telegram channel pages under `https://t.me/s/*`.
GitHub, Hacker News, supported Stack Exchange Q&A sites, Telegram Web K, and
LinkedIn have specialized sources for trusted or best-effort timestamp inputs.
These integrations preserve page-owned elements and links while updating
simple labels in place when needed. Instagram uses the standard timestamp
source with a specialized in-place presentation rule that preserves styling
hooks. Site markup support is best-effort and may change independently of the
extension.

## Key Concepts

- **Exact date:** the absolute date and time shown in place of a relative
  timestamp.
- **Standard timestamp:** a `time[datetime]` value containing a complete date
  and time with an explicit, known UTC offset.
- **Specialized source:** a site-specific rule for richer markup, such as
  GitHub's relative-time widgets, Hacker News age widgets, or approved Stack
  Exchange and Telegram Web K timestamps, plus best-effort LinkedIn ID
  timestamps.
  Specialized rules take precedence over the generic rule when both accept the
  same source.
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
Telegram Web K, and best-effort LinkedIn ID timestamps can also become exact
dates. Instagram's simple standard timestamp labels retain their page-owned
elements and styles. The result follows the selected format, browser locale,
and time zone.

## Features

### Exact Date Replacement

No More Ago processes standard `time[datetime]` values on accessible HTTP(S)
pages when they contain an unambiguous global date and time. Accepted values
have a complete date, a valid time, and `Z`, a colonized numeric offset, or a
compact numeric offset. Date-only, local, malformed, impossible, and
unknown-zone values remain unchanged. Visible text is never parsed as a
fallback.

GitHub, Hacker News, supported Stack Exchange Q&A sites, and LinkedIn have
specialized timestamp sources. Hacker News support applies to
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

LinkedIn posts, reshares, comments, and replies have a best-effort specialized
source when one visible timestamp label is locally associated with exactly one
explicit `activity`, `ugcPost`, `share`, or `comment` ID. The adapter derives
Unix milliseconds from the ID's upper bits and preserves the full millisecond
value through the selected format and time zone. This is best-effort ID
creation or allocation time: LinkedIn does not document the encoding, and the
result is not guaranteed to equal an official `createdAt`, `publishedAt`, or
visible publication time.

LinkedIn support never calculates a date from `1d`, `1w`, `1mo`, `Edited`, an
ARIA label, or nearby display text. Missing, malformed, future, or ambiguous ID
evidence leaves the label unchanged. The adapter makes no LinkedIn API or other
timestamp request and preserves adjacent metadata, links, attributes, and
page-owned element identity when replacing the timestamp text.

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

The extension watches relevant dynamic content in each reachable HTTP(S)
document. Newly added or changed timestamps are processed without requiring a
full page reload.

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

- **System** uses the browser locale's medium date and short time format.
- **Custom format** accepts Unicode date and time tokens and shows a preview.

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
| Eligible standard, GitHub, Hacker News, Stack Exchange, Telegram Web K, or LinkedIn timestamp | The trusted or best-effort ID instant is shown with the configured exact-date presentation. |
| Invalid, incomplete, or ambiguous timestamp | Page content remains unchanged. |
| New eligible timestamp added dynamically | It is processed using current settings. |
| Global or top-level site switch is disabled | Original page content is restored across reachable frames. |
| Format or time zone changes | Existing output is reformatted when reachable. |

## Permissions and Privacy

The extension requests:

- **Access to all HTTP and HTTPS sites:** allows standard timestamps on
  accessible pages, keeps per-host preferences available, and supports future
  specialized sources.
- **Scripting:** registers, updates, and removes one universal content runtime
  at document start for all frames.
- **Web navigation:** enumerates reachable HTTP(S) frames so settings refreshes
  can verify each frame's revision acknowledgement.
- **Storage:** keeps settings and optional diagnostic entries locally.

No More Ago does not derive dates from visible relative or absolute labels,
ARIA labels, nearby text, or elapsed time. The Hacker News specialized source
trusts only the explicit zoned timestamp in its approved `span.age[title]`
shape. The Stack Exchange source reads `title` only from its listed timestamp
widgets and accepts only strict explicit-zone values plus the known
comment-license suffix. LinkedIn is the best-effort derived-ID exception: it
accepts only explicit supported IDs in approved local URL, URN, component-key,
or data-anchor evidence and makes no network request. In-place sources change
only their selected label text; link destinations, element identity,
attributes, and event listeners remain intact. Standard processing remains
limited to ordinary light-DOM `time[datetime]` elements.

The Telegram Web K source trusts only a matching message bubble's ten-digit
Unix-seconds `data-timestamp` and one structurally proven ordinary clock. It
does not inspect message text, authors, identifiers, localized titles, or full
Telegram URLs. Public `t.me/s/*` pages remain on standard `time[datetime]`
processing.

## Limitations

- Generic support applies to eligible standard timestamps on accessible
  HTTP(S) pages. Arbitrary page labels remain out of scope unless an explicitly
  registered specialized source accepts them.
- GitHub, Hacker News, Stack Exchange, Instagram, Telegram Web K, and LinkedIn
  are best-effort integrations whose markup can change independently of the
  extension.
- Telegram Web A and Telegram-specific processing outside public `t.me/s/*`
  pages and Web K are unsupported. Independently eligible standard timestamps
  may still use the universal generic rule.
- The interface is available in English only.
- Safari is not a current build target.
- Browser-internal and other restricted pages cannot run the content script.
- Frames that are inaccessible or use a non-HTTP(S) scheme remain unchanged.
- Shadow DOM, unregistered page labels, durations, date-only values, local
  date-times, and other non-global timestamp forms are outside the current
  scope.
- Website markup can change at any time, so compatibility is best-effort and
  is not a promise about future markup.
- The extension is not yet distributed through browser stores.

## Documentation

- [Development](DEVELOPMENT.md)
- [LLM agent rules](AGENTS.md)
- [Feature specifications](specs/)
