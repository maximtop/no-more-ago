# No More Ago Support

No More Ago works when a supported page exposes both a recognized relative
label and a trustworthy timestamp. Website integrations are best-effort.

## A date did not change

1. Open the extension popup and check that the extension is enabled.
2. Check the site's status. In “Selected sites only”, add the site to Allowed
   sites; in “All supported sites”, ensure it is not in Excluded sites.
3. Confirm the label is relative, such as “3 months ago”. Existing absolute
   dates, clock-only values, unknown labels, and missing labels stay unchanged.
4. Check the [current limitations](../README.md#limitations). Not every page
   on a supported website is eligible. Restricted browser pages cannot run
   extension content scripts.
5. If a previously supported page stopped working, reload it and check again.

## A date looks wrong

Open Settings and check the date format and time zone. A date with no source
time remains a calendar date; changing the time zone does not shift that day.
Specialized site timestamps may have the best-effort limitations documented
in the README. Report the observed result and the result you expected.

## Report a problem or request site support

Use **Report this site** in the popup, or open a
[new GitHub issue](https://github.com/maximtop/no-more-ago/issues/new).
Include the browser, extension version, steps to reproduce, expected result,
and observed result. A public example page is helpful when available.

The popup may prefill the current page URL. Opening the form sends the link
parameters to GitHub. Do not include account tokens, private pages, personal
messages, or other information you do not want to make public. Review the
form before submitting it.

## Optional diagnostics

Enable diagnostic logging in Settings, reproduce the problem, and download
logs if they would help explain it. Inspect the file before sharing it.
Downloading does not submit the file anywhere. Turn logging off when finished;
this also removes stored logs. See [privacy information](PRIVACY.md).
