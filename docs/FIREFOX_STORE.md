# Firefox Add-ons Submission

This document records the first No More Ago submission to Firefox Add-ons
(AMO) and the materials used for its product page.

## Current status

AMO add-on `no-more-ago`, version 0.1.0, was submitted for review on
2026-09-11 from commit `89f63e2`. The submission was subsequently approved
and is publicly available from Firefox Add-ons.

- Product page: https://addons.mozilla.org/firefox/addon/no-more-ago/
- Version record:
  https://addons.mozilla.org/developers/addon/no-more-ago/versions/6479158
- Extension archive SHA-256:
  `380ec401ea3ebb5ddd6bed464913f2d5e2ebd543365a10c374d9e8f48e1d8006`
- Source archive SHA-256:
  `902ac75b95bf6511283f92b5a91c3b22e335127198f4db7d0f7d5039fdd5d8d9`

The submitted source archive reproduced the extension archive byte for byte
when built with the documented commands. Review notes are in
[AMO_REVIEW.md](AMO_REVIEW.md).

## Public verification — September 15, 2026

The anonymous AMO API reports add-on ID `3070516`, version record `6479158`,
and public file `5023325` for version 0.1.0. The downloaded XPI has SHA-256
`1fb8a023dc2308274a4977b4210c2ebef12625d81534187b0a52a5714c917961`,
matching the API response.

The public XPI contains the expected Gecko ID
`no-more-ago@maximtop.dev`, minimum Firefox version 140.0, all 40 locale
catalogs, and Mozilla signature files under `META-INF/`. A clean build from the
recorded submit commit `89f63e2` reproduced the recorded unsigned Firefox ZIP
SHA-256 `380ec401ea3ebb5ddd6bed464913f2d5e2ebd543365a10c374d9e8f48e1d8006`.
Of the 54 non-signature files in the public XPI, 53 are byte-identical to the
rebuilt ZIP. The remaining file, `manifest.json`, differs only because its final
newline is absent from the public XPI.

A fresh `git archive` from `89f63e2` also reproduced the recorded source ZIP
SHA-256 `902ac75b95bf6511283f92b5a91c3b22e335127198f4db7d0f7d5039fdd5d8d9`.
There is currently no Git tag or GitHub Release for v0.1.0, so these checks
establish the association through the recorded submission commit and hashes,
not through a published GitHub Release asset.

## Product page

The product page uses the name and summary from the packaged locale catalogs,
the detailed descriptions in `assets/store-listings/`, and the English image
set in `assets/store/chrome/`.

- Category: Appearance
- Homepage: https://github.com/maximtop/no-more-ago
- Support: https://github.com/maximtop/no-more-ago/issues
- License: All Rights Reserved
- Media: one custom icon and three 1280x800 screenshots
- Support email: omitted from the public listing

The privacy policy and reviewer notes disclose the limited anonymous Bluesky
AppView requests and the Firefox data categories declared by the manifest.

## Locales

The Firefox package ships all 40 UI locale catalogs:

```text
ar bg bn ca cs da de el en es es_419 fa fi fil fr he hi hr hu id it
ja ko ms nb nl pl pt_BR pt_PT ro ru sk sr sv th tr uk vi zh_CN zh_TW
```

AMO offers product-page localization for 28 members of that set. Detailed
descriptions were saved and reloaded for every one of them:

```text
cs de el en-US es-ES fi fr he hr hu it ja ko nb-NO nl pl pt-BR pt-PT
ro ru sk sr sv-SE tr uk vi zh-CN zh-TW
```

AMO does not offer separate product-page locales for these 12 packaged UI
locales:

```text
ar bg bn ca da es-419 fa fil hi id ms th
```

Those catalogs remain included in the extension and are selected by Firefox
at runtime. The limitation applies only to the AMO product-page description.

## Native verification — September 15, 2026

Native verification is **partial**. The signed AMO version 0.1.0 was installed
and enabled in Firefox 155.0.1 with access to all websites enabled and private
window access disabled.

On GitHub, commit `9b1b6d6` changed from `1 hour ago` to `2026-09-15 17:10`
with the custom `yyyy-MM-dd HH:mm` format and UTC time zone. Turning the global
switch off and on restored and reapplied the timestamp without a page reload.
Adding and removing `github.com` from Excluded sites did the same. The custom
format and UTC setting remained selected after reloading the options page.

Hacker News did not pass. Relative timestamps remained unchanged. Diagnostics
recorded an adapter match followed by 30 `invalid-timestamp` skips and zero
transformed timestamps. The live timestamp source was
`2026-09-15T12:31:10`, which has no explicit time-zone designator and is
therefore rejected by the adapter's `EXPLICIT_ISO_ZONE` validation rule.
Current `master` uses the same Hacker News parsing behavior.

Do not assume this unzoned Hacker News value is UTC. Before another release,
establish its authoritative time-zone semantics, add a regression test for the
live format, implement the narrowest evidenced fix, publish a new version, and
repeat the native Firefox test. Keep upload, review approval, public
availability, and runtime verification as separate release states.

## Official references

- [Data collection consent](https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/)
- [Source-code submission](https://extensionworkshop.com/documentation/publish/source-code-submission/)
- [Firefox manifest settings](https://developer.mozilla.org/docs/Mozilla/Add-ons/WebExtensions/manifest.json/browser_specific_settings)
