# No More Ago Privacy Information

Last updated: 2026-09-07

No More Ago replaces supported relative timestamp labels with exact dates.
It does not require an account, collect analytics or telemetry, sell data, or
send browsing activity to a developer-operated server.

## Data processed on pages

The extension reads supported timestamp elements and limited associated page
data to identify and display dates. Processing happens in your browser. It
does not infer dates by counting backwards from relative text. Site support
is best-effort and depends on the data the website makes available.

Facebook support examines selected loaded page payloads and responses while
processing is enabled. It extracts bounded associations between opaque
tracking tokens and timestamps. These associations stay in document memory
and are discarded when processing stops. It does not retain response bodies,
post content, authors or account data in logs, or transmit them as telemetry.

Other supported integrations generally use data already present on the page.
Bluesky has the specific network behavior described below.

## Bluesky public lookups

On supported public Bluesky posts, the extension sends public actor identifiers
and public post identifiers to `https://public.api.bsky.app` to retrieve the
server-observed timestamp. Requests are anonymous and credential-free: they do
not include your cookies, account tokens, authorization headers, settings, or
post text. Like other internet requests, the connection exposes network
information such as the source IP address to the receiving service.

These requests are necessary for this integration; the extension is not
entirely offline. Successful results are held temporarily in document memory
while the relevant page elements remain connected. Stopping processing or
closing the document discards that state. Disable processing on `bsky.app`, or
disable the extension globally, to stop this functionality.

## Settings stored locally

The extension stores its enabled state, site lists, date/time-zone preferences,
appearance, and a previous-settings recovery copy in browser extension local
storage. It does not synchronize these settings through a developer service.
Removing the extension removes its extension storage under normal browser
behavior.

## Optional diagnostic logs

Diagnostics are off by default. If enabled in Settings, a bounded local
journal records sanitized technical events to help investigate problems.
Events may include relevant hostnames, browser and extension versions, adapter
identifiers, counts and error categories. The stored journal is limited to
5,000,000 bytes. It is separate from your settings.

You can clear the journal, download it, or disable diagnostics in Settings.
Disabling diagnostics removes the stored logs. Downloading creates a file on
your device; the extension does not automatically upload it. You control whether
and with whom to share that file. Review it before attaching it to a report.

## Support reports

Choosing “Report this site” opens GitHub with a prefilled issue form. Depending
on where the report starts, the link may include the current page URL, browser,
reason and extension version. Opening that link sends its URL parameters to
GitHub; submitting the report is a separate action you control. Review and
remove private URLs or details before submission. Public GitHub issues and
attachments may be visible to everyone.

GitHub and Bluesky operate their own services and privacy practices. This
extension does not control their handling of requests or information you
choose to submit.

## Permissions

Access to websites allows the extension to inspect eligible timestamps and
restore labels when disabled. Script and navigation capabilities manage the
runtime in reachable frames and apply settings changes. Storage keeps settings
and optional logs locally. These capabilities do not authorize unrelated data
collection by the extension.

## Limited use of data

No More Ago's use of information received from browser APIs adheres to the
Chrome Web Store User Data Policy, including the Limited Use requirements.
The extension uses page data only to provide its timestamp functionality and
user-requested support features. It does not use or transfer that data for
advertising, profiling, or purposes unrelated to those features.

## Contact and updates

For questions, use the [project support instructions](SUPPORT.md). Changes to
this document accompany changes in extension behavior. This document describes
the current implementation; it does not claim store approval or certification.
