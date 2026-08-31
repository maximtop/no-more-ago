/**
 * Owns the universal persistent document-start registration.
 *
 * @file Dynamic registration for all HTTP(S) document frames.
 */
import type {
    RegisteredContentScriptReference,
    RegisteredContentScriptSpec,
} from "./scripting";
import { SCRIPT_EXECUTION_WORLD } from "./scripting";
import {
    CONTENT_SCRIPT_FILE,
    FACEBOOK_PAYLOAD_BRIDGE_SCRIPT_FILE,
} from "../../shared/extension-files";
import { HTTP_MATCH_PATTERNS } from "../../shared/url/http";
import { FACEBOOK_MATCH_PATTERNS } from "../../shared/url/facebook";

/**
 * Stable browser registration identifier.
 */
export const DOCUMENT_RUNTIME_REGISTRATION_ID = "no-more-ago-documents" as const;

/**
 * Stable Facebook main-world bridge registration identifier.
 */
export const FACEBOOK_PAYLOAD_BRIDGE_REGISTRATION_ID =
    "no-more-ago-facebook-payload-bridge" as const;

/**
 * Universal persistent registration specification.
 */
export const DOCUMENT_RUNTIME_REGISTRATION: RegisteredContentScriptSpec = {
    id: DOCUMENT_RUNTIME_REGISTRATION_ID,
    matches: [...HTTP_MATCH_PATTERNS],
    js: [CONTENT_SCRIPT_FILE],
    runAt: "document_start",
    allFrames: true,
    persistAcrossSessions: true,
    world: SCRIPT_EXECUTION_WORLD.ISOLATED,
};

/**
 * Persistent Facebook-only main-world payload bridge registration.
 */
export const FACEBOOK_PAYLOAD_BRIDGE_REGISTRATION: RegisteredContentScriptSpec = {
    id: FACEBOOK_PAYLOAD_BRIDGE_REGISTRATION_ID,
    matches: [...FACEBOOK_MATCH_PATTERNS],
    js: [FACEBOOK_PAYLOAD_BRIDGE_SCRIPT_FILE],
    runAt: "document_start",
    allFrames: true,
    persistAcrossSessions: true,
    world: SCRIPT_EXECUTION_WORLD.MAIN,
};

/**
 * Complete dynamic registration set managed by the global activation policy.
 */
export const DOCUMENT_RUNTIME_REGISTRATIONS = [
    DOCUMENT_RUNTIME_REGISTRATION,
    FACEBOOK_PAYLOAD_BRIDGE_REGISTRATION,
] as const;

/**
 * Compares a browser registration with the canonical universal specification.
 *
 * @param existing - Registration returned by the browser.
 * @param expected - Canonical registration specification.
 * @returns - Whether all relevant fields match.
 */
export function registrationMatches(
    existing: RegisteredContentScriptReference,
    expected: RegisteredContentScriptSpec,
): boolean {
    const same = (left: readonly string[] | undefined, right: readonly string[]): boolean =>
        left === undefined
        || (
            left.length === right.length
            && left.every((value, index) => value === right[index])
        );
    const optionalMatches = <T>(left: T | undefined, right: T): boolean =>
        left === undefined || left === right;
    return existing.id === expected.id
        && same(existing.matches, expected.matches)
        && same(existing.js, expected.js)
        && optionalMatches(existing.runAt, expected.runAt)
        && optionalMatches(existing.allFrames, expected.allFrames)
        && optionalMatches(existing.persistAcrossSessions, expected.persistAcrossSessions)
        && optionalMatches(existing.world, expected.world);
}
