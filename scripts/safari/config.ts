/**
 * @file Shared paths, Apple identifiers, and process helpers for the Safari containing app.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Repository root.
 */
export const ROOT_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * Xcode project of the macOS containing app and its Safari Web Extension.
 */
export const SAFARI_PROJECT_PATH = path.join(ROOT_PATH, 'safari/macos/No More Ago/No More Ago.xcodeproj');

/**
 * Xcode scheme that builds the containing app together with the embedded extension.
 */
export const SAFARI_SCHEME = 'No More Ago';

/**
 * Root of every generated Safari output: Xcode file lists, derived data, apps, and archives.
 */
export const SAFARI_OUTPUT_PATH = path.join(ROOT_PATH, 'dist/safari');

/**
 * Xcode archive produced for Mac App Store upload.
 */
export const SAFARI_ARCHIVE_PATH = path.join(SAFARI_OUTPUT_PATH, 'store/No More Ago.xcarchive');

/**
 * Containing-app bundle name inside build products and archives.
 */
export const SAFARI_APP_NAME = 'No More Ago.app';

/**
 * Extension bundle path relative to the containing app.
 */
export const SAFARI_EXTENSION_RELATIVE_PATH = 'Contents/PlugIns/No More Ago Extension.appex';

/**
 * Bundle identifier of the containing app and its App Store record.
 */
export const SAFARI_APP_BUNDLE_IDENTIFIER = 'dev.maximtop.no-more-ago.safari';

/**
 * Bundle identifier of the embedded Safari Web Extension.
 */
export const SAFARI_EXTENSION_BUNDLE_IDENTIFIER = 'dev.maximtop.no-more-ago.safari.Extension';

/**
 * Mac App Store category of the containing app.
 */
export const SAFARI_APP_CATEGORY = 'public.app-category.productivity';

/**
 * Apple Developer team that signs the App Store build; `APPLE_TEAM_ID` overrides it.
 */
export const APPLE_TEAM_IDENTIFIER = 'WF967PV46P';

/**
 * Name of the Mac App Store provisioning profile for the containing app.
 */
export const SAFARI_APP_STORE_APP_PROFILE = 'No More Ago Mac App Store';

/**
 * Name of the Mac App Store provisioning profile for the extension.
 */
export const SAFARI_APP_STORE_EXTENSION_PROFILE = 'No More Ago Safari Extension Mac App Store';

/**
 * Command-line flag that builds and validates an archive without Apple signing.
 */
export const UNSIGNED_OPTION = '--unsigned';

/**
 * Reads the public product version from package.json.
 *
 * @returns - Three-component product version accepted by Apple bundle metadata.
 *
 * @throws If package.json does not contain an `X.Y.Z` version.
 */
export function readPackageVersion(): string {
    const metadata = JSON.parse(readFileSync(path.join(ROOT_PATH, 'package.json'), 'utf8')) as {
        readonly version: string;
    };
    if (!/^\d+\.\d+\.\d+$/u.test(metadata.version)) {
        throw new Error('package.json must contain an X.Y.Z version');
    }
    return metadata.version;
}

/**
 * Validates an Apple bundle build number.
 *
 * @param value - Candidate build number.
 *
 * @returns - The build number: one to three integer components within Apple's digit limits.
 *
 * @throws If Apple bundle metadata would not accept the value.
 */
export function validateBuildNumber(value: string): string {
    if (!/^[1-9]\d*(?:\.\d+){0,2}$/u.test(value)) {
        throw new Error('SAFARI_BUILD_NUMBER must contain one to three integer components and start above zero');
    }
    const [major = 0, minor = 0, patch = 0] = value.split('.').map(Number);
    if (major > 9999 || minor > 99 || patch > 99) {
        throw new Error('SAFARI_BUILD_NUMBER components exceed Apple limits of four, two, and two digits');
    }
    return value;
}

/**
 * Reads the build number required for the current archive or upload.
 *
 * @param fallback - Build number used when `SAFARI_BUILD_NUMBER` is unset, if any.
 *
 * @returns - Validated build number, or `undefined` when neither value is present.
 */
export function readBuildNumber(fallback?: string): string | undefined {
    const value = process.env.SAFARI_BUILD_NUMBER ?? fallback;
    return value === undefined ? undefined : validateBuildNumber(value);
}

/**
 * Reads the Apple Developer team identifier.
 *
 * @returns - Ten-character team identifier.
 *
 * @throws If an `APPLE_TEAM_ID` override is malformed.
 */
export function readAppleTeamIdentifier(): string {
    const teamIdentifier = process.env.APPLE_TEAM_ID ?? APPLE_TEAM_IDENTIFIER;
    if (!/^[A-Z0-9]{10}$/u.test(teamIdentifier)) {
        throw new Error('APPLE_TEAM_ID must be a ten-character Apple team identifier');
    }
    return teamIdentifier;
}

/**
 * Parses the only option the archive scripts accept.
 *
 * @returns - Whether `--unsigned` was passed.
 *
 * @throws If any other argument was passed.
 */
export function parseUnsignedOption(): boolean {
    const args = process.argv.slice(2);
    const unknown = args.filter((arg) => arg !== UNSIGNED_OPTION);
    if (unknown.length > 0) {
        throw new Error(`Unknown options: ${unknown.join(', ')}`);
    }
    return args.includes(UNSIGNED_OPTION);
}

/**
 * Runs one fixed build tool without a shell and streams its output.
 *
 * @param command - Executable name.
 * @param args - Closed argument list chosen by the calling script.
 */
export function run(command: string, args: readonly string[]): void {
    process.stdout.write(`$ ${command} ${args.join(' ')}\n`);
    execFileSync(command, args, { cwd: ROOT_PATH, stdio: 'inherit' });
}

/**
 * Builds the optional App Store Connect API-key arguments for xcodebuild.
 *
 * @returns - No arguments for a signed-in Xcode account, or the complete API-key arguments.
 *
 * @throws If only part of the API-key environment is configured.
 */
export function appStoreConnectAuthenticationArgs(): string[] {
    const {
        APP_STORE_CONNECT_API_KEY_PATH: keyPath,
        APP_STORE_CONNECT_API_KEY_ID: keyId,
        APP_STORE_CONNECT_API_ISSUER_ID: issuerId,
    } = process.env;
    if (!keyPath && !keyId && !issuerId) {
        return [];
    }
    if (!keyPath || !keyId || !issuerId) {
        throw new Error(
            'APP_STORE_CONNECT_API_KEY_PATH, APP_STORE_CONNECT_API_KEY_ID, and '
            + 'APP_STORE_CONNECT_API_ISSUER_ID must be configured together',
        );
    }
    return [
        '-authenticationKeyPath',
        keyPath,
        '-authenticationKeyID',
        keyId,
        '-authenticationKeyIssuerID',
        issuerId,
    ];
}
