# Mac App Store

No More Ago reaches Safari as a macOS app, `No More Ago.app`, with the
extension embedded in it. The Xcode project lives in `safari/macos`; it copies
the WebExtension built by `pnpm dev safari` or `pnpm release safari` into the
extension bundle. Nothing about the WebExtension itself differs from the other
browsers except the manifest variant `src/manifest/safari.json`, which sets
the Safari 16.4 floor needed by `scripting.registerContentScripts`.

The upload workflow only delivers a build to App Store Connect. Selecting the
build for a version, filling in the listing, and submitting it for App Review
stay manual.

- [Set up the Apple account](#set-up-the-apple-account)
- [Configure GitHub](#configure-github)
- [Upload a release](#upload-a-release)
- [Archive and upload locally](#archive-and-upload-locally)
- [Submit for App Review](#submit-for-app-review)

## Set up the Apple account

Do this once, in Apple Developer team `WF967PV46P`.

1. Accept the current agreements in App Store Connect.
2. In Certificates, Identifiers & Profiles, register two explicit App IDs:
    - containing app: `dev.maximtop.no-more-ago.safari`
    - extension: `dev.maximtop.no-more-ago.safari.Extension`
3. Create the macOS app record in App Store Connect with the containing-app
   ID. Use the name `No More Ago`, a permanent SKU such as
   `no-more-ago-safari`, and the Productivity category; the build declares
   `public.app-category.productivity`.
4. Create an Apple Distribution certificate and a Mac Installer Distribution
   certificate. Export each as a PKCS#12 file protected by the same password.
5. Create two Mac App Store provisioning profiles signed by the Apple
   Distribution certificate. The names are fixed in
   `scripts/safari/config.ts`:
    - `No More Ago Mac App Store` for the containing app
    - `No More Ago Safari Extension Mac App Store` for the extension
6. Create an App Store Connect API key with the App Manager role. Record its
   key ID and issuer ID, and download the `.p8` file.

## Configure GitHub

Create the GitHub environment `apple-app-store`. Add required reviewers to it
if every upload should need an explicit approval.

| Kind | Name | Value |
| --- | --- | --- |
| Secret | `APPLE_APP_STORE_CERTIFICATE_P12_BASE64` | Apple Distribution `.p12`, base64 |
| Secret | `APPLE_APP_STORE_INSTALLER_CERTIFICATE_P12_BASE64` | Mac Installer Distribution `.p12`, base64 |
| Secret | `APPLE_APP_STORE_CERTIFICATE_PASSWORD` | Password of both `.p12` files |
| Secret | `APP_STORE_CONNECT_API_KEY_P8_BASE64` | API key `.p8`, base64 |
| Variable | `APP_STORE_CONNECT_API_KEY_ID` | API key ID |
| Variable | `APP_STORE_CONNECT_API_ISSUER_ID` | API key issuer ID |

Encode a file without line breaks and store it without printing it:

```sh
base64 < AuthKey_KEYID.p8 | tr -d '\n' | gh secret set APP_STORE_CONNECT_API_KEY_P8_BASE64 --env apple-app-store
```

## Upload a release

The workflow archives the source of a published GitHub Release, so the tag
must already contain Safari support.

1. Check the release and the configuration without building:

   ```sh
   gh workflow run deploy-apple-app-store.yml -f tag=vX.Y.Z -f mode=validate
   ```

2. Archive, sign, and upload:

   ```sh
   gh workflow run deploy-apple-app-store.yml -f tag=vX.Y.Z
   ```

The workflow refuses a tag that is not `vX.Y.Z`, a draft or pre-release, a
commit not reachable from `master`, and a tagged `package.json` with another
version. It imports both certificates into a temporary keychain, downloads the
two profiles, builds a universal `arm64` and `x86_64` archive, validates its
bundle IDs, versions, sandbox, and team signature, and uploads it. The build
number comes from the run number and attempt, for example `1.57.1`, so a retry
gets a new number. The keychain and key files are removed even when a step
fails.

## Archive and upload locally

Run the credential-free check first. It builds and validates an unsigned
universal archive:

```sh
pnpm safari:archive --unsigned
```

For a signed local upload, sign in to the Apple account in Xcode or export the
API key variables, then use one build number higher than every build already
in App Store Connect:

```sh
export APP_STORE_CONNECT_API_KEY_PATH=/absolute/path/AuthKey_KEYID.p8
export APP_STORE_CONNECT_API_KEY_ID=KEYID
export APP_STORE_CONNECT_API_ISSUER_ID=00000000-0000-0000-0000-000000000000
pnpm safari:profiles
SAFARI_BUILD_NUMBER=<build> pnpm safari:archive
SAFARI_BUILD_NUMBER=<build> pnpm safari:upload
```

The archive is `dist/safari/store/No More Ago.xcarchive`. A local build number
above the workflow sequence blocks later workflow uploads, so prefer the
workflow.

## Submit for App Review

1. Wait until App Store Connect finishes processing the build.
2. Install it through TestFlight, open **No More Ago**, choose **Open Safari
   Extension Settings**, and enable the extension.
3. Allow it on a site with relative timestamps, such as GitHub, and confirm
   that they become exact dates. Check the popup and Settings.
4. Select the build on the macOS version page and fill in the description,
   keywords, screenshots, support URL, and privacy policy URL. The product and
   privacy pages are listed in the [README](../README.md#installation).
5. Answer App Privacy from [Privacy information](PRIVACY.md): no data is
   collected or tracked. The build declares `ITSAppUsesNonExemptEncryption`
   as `NO`.
6. Add review notes and submit. A starting point:

   > No More Ago replaces relative timestamps such as "3 hours ago" with exact
   > dates on websites. It needs website access because supported timestamps
   > can appear on any site. No account is needed. To try it, enable the
   > extension, allow it on github.com, and open any repository: commit times
   > show exact dates. The only network requests are credential-free lookups
   > of public Bluesky posts at https://public.api.bsky.app.

Apple references:

- [Distributing a Safari web extension](https://developer.apple.com/documentation/safariservices/distributing-your-safari-web-extension)
- [Upload builds](https://developer.apple.com/help/app-store-connect/manage-builds/upload-builds/)
- [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
