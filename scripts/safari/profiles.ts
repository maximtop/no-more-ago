/**
 * @file Downloads the named Mac App Store provisioning profiles through the App Store Connect API.
 */

import { createPrivateKey, sign } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { SAFARI_APP_STORE_APP_PROFILE, SAFARI_APP_STORE_EXTENSION_PROFILE } from './config.ts';

const PROFILES_URL = 'https://api.appstoreconnect.apple.com/v1/profiles?limit=200';
const TOKEN_AUDIENCE = 'appstoreconnect-v1';
const TOKEN_LIFETIME_SECONDS = 15 * 60;

/**
 * One provisioning profile returned by App Store Connect.
 */
interface ProfileResource {
    /**
     * Profile fields used to select and install it.
     */
    readonly attributes: {
        /**
         * Profile name configured in the Apple Developer account.
         */
        readonly name: string;

        /**
         * Lifecycle state; only `ACTIVE` profiles sign builds.
         */
        readonly profileState: string;

        /**
         * Base64-encoded provisioning profile.
         */
        readonly profileContent: string;

        /**
         * Profile UUID, used as the installed file name.
         */
        readonly uuid: string;
    };
}

/**
 * Reads one required environment variable.
 *
 * @param name - Variable name.
 *
 * @returns - Its non-empty value.
 *
 * @throws If the variable is unset or empty.
 */
function requireEnvironment(name: string): string {
    const value = process.env[name];
    if (!value) {
        throw new Error(`${name} is required to download provisioning profiles`);
    }
    return value;
}

/**
 * Encodes one JWT segment.
 *
 * @param value - JSON value of the segment.
 *
 * @returns - Base64url text without padding.
 */
function jwtSegment(value: Record<string, unknown>): string {
    return Buffer.from(JSON.stringify(value)).toString('base64url');
}

/**
 * Creates a short-lived ES256 App Store Connect API token.
 *
 * @returns - Signed bearer token.
 */
function createToken(): string {
    const issuedAt = Math.floor(Date.now() / 1000);
    const unsigned = [
        jwtSegment({ alg: 'ES256', kid: requireEnvironment('APP_STORE_CONNECT_API_KEY_ID'), typ: 'JWT' }),
        jwtSegment({
            aud: TOKEN_AUDIENCE,
            iss: requireEnvironment('APP_STORE_CONNECT_API_ISSUER_ID'),
            iat: issuedAt,
            exp: issuedAt + TOKEN_LIFETIME_SECONDS,
        }),
    ].join('.');
    const key = createPrivateKey(readFileSync(requireEnvironment('APP_STORE_CONNECT_API_KEY_PATH')));
    const signature = sign('sha256', Buffer.from(unsigned), { key, dsaEncoding: 'ieee-p1363' });
    return `${unsigned}.${signature.toString('base64url')}`;
}

const response = await fetch(PROFILES_URL, { headers: { Authorization: `Bearer ${createToken()}` } });
if (!response.ok) {
    throw new Error(`Could not list provisioning profiles: HTTP ${String(response.status)}`);
}
const { data: profiles } = await response.json() as { readonly data: readonly ProfileResource[] };
const destination = process.env.SAFARI_PROVISIONING_PROFILES_PATH
    ?? path.join(os.homedir(), 'Library/MobileDevice/Provisioning Profiles');
mkdirSync(destination, { recursive: true, mode: 0o700 });

for (const name of [SAFARI_APP_STORE_APP_PROFILE, SAFARI_APP_STORE_EXTENSION_PROFILE]) {
    const profile = profiles.find(({ attributes }) => attributes.name === name && attributes.profileState === 'ACTIVE');
    if (!profile) {
        throw new Error(`Active provisioning profile not found: ${name}`);
    }
    const { uuid, profileContent } = profile.attributes;
    writeFileSync(path.join(destination, `${uuid}.provisionprofile`), Buffer.from(profileContent, 'base64'), {
        mode: 0o600,
    });
    process.stdout.write(`Installed ${name} (${uuid})\n`);
}
