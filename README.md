# No More Ago

No More Ago is a browser extension for people who prefer exact dates to text
such as “3 months ago.” It replaces trusted relative timestamps with
localized date and time text while preserving the original page state for
restoration.

The current version processes GitHub. Support for additional sites may be
added later.

## Key Concepts

- **Exact date:** the absolute date and time shown in place of a relative
  timestamp.
- **Supported site:** a website with explicit rules for trustworthy
  timestamps. GitHub is currently supported.
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
2. Open any page on `github.com` that contains relative timestamps.
3. Open the No More Ago toolbar popup.
4. Leave **Global enabled** and **Enabled on github.com** switched on.
5. The supported relative timestamps are replaced with exact dates.

For example, a GitHub timestamp such as “3 months ago” may become
“Aug 23, 2026, 2:37 PM.” The exact result follows the selected format,
browser locale, and time zone.

## Features

### Exact Date Replacement

No More Ago processes GitHub timestamps only when GitHub supplies an
unambiguous machine-readable date and time. Ambiguous, incomplete, or invalid
values remain unchanged.

The extension also watches supported dynamic GitHub content. Newly added
timestamps are processed without requiring a full page reload.

### Global and Site Controls

The toolbar popup shows the current hostname and processing status.

- **Global enabled** controls the extension everywhere.
- **Enabled on _hostname_** controls the exact current hostname.
- **Report this site** opens a prefilled GitHub issue for missing or broken
  support.

Disabling the extension globally or for a site restores the original relative
text immediately. Enabling it again immediately processes the current page.

A site preference can be saved even when that site has no adapter. The setting
will remain available, but the page will not change until support is added.

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

Diagnostic collection is disabled by default. To collect information for a
problem report:

1. Open the options page.
2. Enable **Debug logs**.
3. Reproduce the problem.
4. Choose **Download logs** to save
   `no-more-ago-diagnostics.zip`.
5. Choose **Open GitHub issue** and attach the archive if it is useful.

Logs are stored locally and capped at 5,000,000 bytes. **Clear logs** removes
the current entries. Disabling **Debug logs** also deletes retained logs.

The extension does not submit diagnostic data automatically. Reporting opens a
GitHub form for review and manual submission.

## Common Workflows

### Disable One Site

1. Open the site.
2. Open the toolbar popup.
3. Switch off **Enabled on _hostname_**.

The preference is stored for that exact hostname and the original text is
restored without reloading the page.

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
| Trusted GitHub timestamp with an explicit date and zone | Relative text is replaced with an exact date. |
| Invalid or ambiguous timestamp | Page content remains unchanged. |
| New supported timestamp added dynamically | It is processed using current settings. |
| Global or site switch is disabled | Original relative text is restored. |
| Format or time zone changes | Existing supported output is reformatted when reachable. |

## Permissions and Privacy

The extension requests:

- **Access to all HTTP and HTTPS sites:** keeps the permission model stable as
  supported sites are added and allows per-host preferences. Only explicitly
  supported sites are transformed; currently that is GitHub.
- **Scripting:** registers, updates, and removes the supported content script.
- **Storage:** keeps settings and optional diagnostic entries locally.

No More Ago does not derive dates from visible relative text, page titles,
ARIA labels, or arbitrary `data-*` attributes. The rules for a supported site
must explicitly accept the timestamp source.

## Limitations

- GitHub is the only supported site.
- The interface is available in English only.
- Safari is not a current build target.
- Browser-internal and other restricted pages cannot run the content script.
- Website markup can change at any time, so site compatibility is best-effort.
- The extension is not yet distributed through browser stores.

## Documentation

- [Development](DEVELOPMENT.md)
- [LLM agent rules](AGENTS.md)
- [Feature specifications](specs/)
