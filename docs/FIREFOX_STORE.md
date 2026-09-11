# Firefox Add-ons Submission

This document records the first No More Ago submission to Firefox Add-ons
(AMO) and the materials used for its product page.

## Current status

AMO add-on `no-more-ago`, version 0.1.0, was submitted for review on
2026-09-11 from commit `89f63e2`. Its current recorded status is
`Awaiting Review`. This confirms submission only; approval and public
availability have not yet been established.

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

## Publication follow-up

After AMO finishes review, verify the product page in a signed-out browser
before recording the extension as published. Keep upload, review approval and
public availability as separate release states.

## Official references

- [Data collection consent](https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/)
- [Source-code submission](https://extensionworkshop.com/documentation/publish/source-code-submission/)
- [Firefox manifest settings](https://developer.mozilla.org/docs/Mozilla/Add-ons/WebExtensions/manifest.json/browser_specific_settings)
