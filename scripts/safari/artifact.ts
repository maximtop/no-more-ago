/**
 * @file Validates a built Safari containing app against the metadata Apple and Safari read.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { MANIFEST_FILE } from '../../src/shared/extension-files.ts';

import {
    SAFARI_APP_BUNDLE_IDENTIFIER,
    SAFARI_APP_CATEGORY,
    SAFARI_EXTENSION_BUNDLE_IDENTIFIER,
    SAFARI_EXTENSION_RELATIVE_PATH,
    readAppleTeamIdentifier,
    readPackageVersion,
    validateBuildNumber,
} from './config.ts';

/**
 * Validation profile for one Safari artifact.
 */
export interface SafariArtifactExpectation {
    /**
     * Containing-app bundle to inspect.
     */
    readonly appPath: string;

    /**
     * Build number both bundles must carry, when the caller chose one.
     */
    readonly buildNumber?: string | undefined;

    /**
     * Whether every executable must contain both Apple Silicon and Intel slices.
     */
    readonly universal: boolean;

    /**
     * Whether code signatures and sandbox entitlements are checked.
     */
    readonly signed: boolean;

    /**
     * Whether the build must be signed by the Apple team with Mac App Store profiles.
     */
    readonly appStore: boolean;
}

/**
 * Fails when an expected artifact path is missing.
 *
 * @param target - Expected path.
 *
 * @throws If the path does not exist.
 */
function requirePath(target: string): void {
    if (!existsSync(target)) {
        throw new Error(`Missing Safari artifact: ${target}`);
    }
}

/**
 * Reads one raw value from a bundle's Info.plist.
 *
 * @param bundlePath - App or extension bundle.
 * @param key - Info.plist key.
 *
 * @returns - Raw value printed by plutil.
 */
function readBundleValue(bundlePath: string, key: string): string {
    return execFileSync('plutil', ['-extract', key, 'raw', path.join(bundlePath, 'Contents/Info.plist')], {
        encoding: 'utf8',
    }).trim();
}

/**
 * Reads the effective code-signing entitlements of a bundle.
 *
 * @param target - Signed bundle.
 *
 * @returns - Entitlement dictionary.
 *
 * @throws If codesign reports no entitlements.
 */
function readEntitlements(target: string): Record<string, unknown> {
    const plist = execFileSync('codesign', ['--display', '--xml', '--entitlements', '-', target], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
    });
    if (!plist.includes('<plist')) {
        throw new Error(`Missing entitlements for ${target}`);
    }
    const converted = spawnSync('plutil', ['-convert', 'json', '-o', '-', '-'], { input: plist, encoding: 'utf8' });
    return JSON.parse(converted.stdout) as Record<string, unknown>;
}

/**
 * Reads the team identifier and certificate authorities of a signature.
 *
 * @param target - Signed bundle.
 *
 * @returns - Team identifier and authority names reported by codesign.
 */
function readSigner(target: string): { readonly team: string; readonly authorities: readonly string[] } {
    // codesign prints signature details to stderr.
    const result = spawnSync('codesign', ['--display', '--verbose=4', target], { encoding: 'utf8' });
    const output = `${result.stdout}\n${result.stderr}`;
    return {
        team: /^TeamIdentifier=(.+)$/mu.exec(output)?.[1] ?? '',
        authorities: [...output.matchAll(/^Authority=(.+)$/gmu)].map((match) => match[1] ?? ''),
    };
}

/**
 * Validates signatures, sandboxing, and, for the App Store, the team identity of both bundles.
 *
 * @param appPath - Containing app.
 * @param extensionPath - Embedded extension.
 * @param appStore - Whether the Apple team and its App Store identifiers are required.
 *
 * @throws If a signature or entitlement does not match the product contract.
 */
function validateSignatures(appPath: string, extensionPath: string, appStore: boolean): void {
    const team = readAppleTeamIdentifier();
    for (const [target, bundleIdentifier] of [
        [extensionPath, SAFARI_EXTENSION_BUNDLE_IDENTIFIER],
        [appPath, SAFARI_APP_BUNDLE_IDENTIFIER],
    ] as const) {
        execFileSync('codesign', ['--verify', '--strict', target], { stdio: 'inherit' });
        const entitlements = readEntitlements(target);
        if (entitlements['com.apple.security.app-sandbox'] !== true) {
            throw new Error(`Safari bundle is not sandboxed: ${target}`);
        }
        if (appStore) {
            const signer = readSigner(target);
            if (signer.team !== team || !signer.authorities.some((name) => name.startsWith('Apple Distribution:'))) {
                throw new Error(`Safari bundle is not signed by Apple Distribution for team ${team}: ${target}`);
            }
            if (entitlements['com.apple.application-identifier'] !== `${team}.${bundleIdentifier}`) {
                throw new Error(`Safari bundle is not signed for ${team}.${bundleIdentifier}`);
            }
            requirePath(path.join(target, 'Contents/embedded.provisionprofile'));
        }
    }
}

/**
 * Validates the layout, Apple metadata, embedded manifest, and signatures of a Safari app.
 *
 * @param expectation - Artifact and validation profile.
 *
 * @throws If any checked artifact contract is violated.
 */
export function validateSafariArtifact(expectation: SafariArtifactExpectation): void {
    const { appPath } = expectation;
    const version = readPackageVersion();
    const extensionPath = path.join(appPath, SAFARI_EXTENSION_RELATIVE_PATH);
    const manifestPath = path.join(extensionPath, 'Contents/Resources', MANIFEST_FILE);
    [
        appPath,
        extensionPath,
        manifestPath,
        path.join(appPath, 'Contents/Resources/AppIcon.icns'),
        path.join(appPath, 'Contents/Resources/PrivacyInfo.xcprivacy'),
        path.join(appPath, 'Contents/Resources/en.lproj/Localizable.strings'),
        path.join(extensionPath, 'Contents/Resources/PrivacyInfo.xcprivacy'),
    ].forEach(requirePath);

    if (readBundleValue(appPath, 'CFBundleIdentifier') !== SAFARI_APP_BUNDLE_IDENTIFIER
        || readBundleValue(extensionPath, 'CFBundleIdentifier') !== SAFARI_EXTENSION_BUNDLE_IDENTIFIER) {
        throw new Error('Unexpected Safari bundle identifiers');
    }
    for (const bundle of [appPath, extensionPath]) {
        if (readBundleValue(bundle, 'CFBundleShortVersionString') !== version) {
            throw new Error(`Safari bundle version must be ${version}: ${bundle}`);
        }
        if (readBundleValue(bundle, 'ITSAppUsesNonExemptEncryption') !== 'false') {
            throw new Error(`Safari export-compliance metadata is missing: ${bundle}`);
        }
    }
    const buildNumber = validateBuildNumber(readBundleValue(appPath, 'CFBundleVersion'));
    if (readBundleValue(extensionPath, 'CFBundleVersion') !== buildNumber
        || (expectation.buildNumber !== undefined && buildNumber !== expectation.buildNumber)) {
        throw new Error('Safari app and extension must carry the expected build number');
    }
    if (readBundleValue(appPath, 'LSApplicationCategoryType') !== SAFARI_APP_CATEGORY) {
        throw new Error(`Safari containing app must use the ${SAFARI_APP_CATEGORY} category`);
    }

    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
        readonly version: string;
        readonly background: { readonly service_worker?: string };
    };
    if (manifest.version !== version || !manifest.background.service_worker) {
        throw new Error('Embedded Safari manifest must be the current service-worker build');
    }
    requirePath(path.join(extensionPath, 'Contents/Resources', manifest.background.service_worker));

    if (expectation.universal) {
        for (const bundle of [appPath, extensionPath]) {
            const executable = path.join(bundle, 'Contents/MacOS', readBundleValue(bundle, 'CFBundleExecutable'));
            const architectures = execFileSync('lipo', ['-archs', executable], { encoding: 'utf8' })
                .trim()
                .split(/\s+/u)
                .sort();
            if (architectures.join(' ') !== 'arm64 x86_64') {
                throw new Error(`Mac App Store executable is not universal: ${executable}`);
            }
        }
    }
    if (expectation.signed) {
        validateSignatures(appPath, extensionPath, expectation.appStore);
    }
}
