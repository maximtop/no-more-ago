# Firefox Add-ons Review Notes

These instructions reproduce the submitted Firefox package from source.

## Build environment

- Linux or macOS
- Node.js 24 (`>=24 <25` from `package.json`)
- pnpm 11.18.0 (the exact version in the `packageManager` field)

Install pnpm if it is not already available:

```sh
npm install --global pnpm@11.18.0
```

From the root of the source archive, install the exactly locked dependencies
and build the Firefox release:

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm release firefox
```

The package to compare with the submitted extension is
`dist/release/firefox.zip`. The build produces the unpacked equivalent under
`dist/release/firefox/`. No environment variables, credentials, network
services or private repositories are required after dependency installation.

## Functional review

No account or setup is required. Install the signed add-on and open
`https://news.ycombinator.com/`. Supported relative story timestamps should
become exact dates. Turn the add-on off in its toolbar popup to restore the
original labels. Settings lets the reviewer change the date format, time zone
and site scope. Absolute or unrecognized labels remain unchanged.

Bluesky support makes credential-free requests to
`https://public.api.bsky.app` using public post identifiers. Facebook support
inspects selected Story-bearing page responses while processing is enabled.
These behaviors and all requested permissions are described in
`docs/PRIVACY.md` and the project `README.md`.

The Firefox manifest declares `browsingActivity` and `websiteContent` as
required data collection permissions because the Bluesky integration sends
public actor and post identifiers to the public AppView. It requires Firefox
140 or later so Firefox provides the built-in installation consent experience.

## Third-party libraries

Exact versions are pinned in `package.json` and `pnpm-lock.yaml`. The bundled
runtime libraries and their source repositories are:

- `@adguard/translate`: https://github.com/AdGuardSoftwareLimited/ext-translate
- `@date-fns/tz` and `date-fns`: https://github.com/date-fns/date-fns
- `@mantine/core` and `@mantine/hooks`: https://github.com/mantinedev/mantine
- `@xstate/react` and `xstate`: https://github.com/statelyai/xstate
- `react` and `react-dom`: https://github.com/react/react
- `valibot`: https://github.com/open-circle/valibot

Build-only dependencies and their exact versions are also declared in
`package.json` and locked in `pnpm-lock.yaml`.
