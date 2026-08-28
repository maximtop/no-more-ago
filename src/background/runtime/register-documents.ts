/**
 * Owns the universal persistent document-start registration.
 *
 * @file Dynamic registration for all HTTP(S) document frames.
 */
import type {
    RegisteredContentScriptReference,
    RegisteredContentScriptSpec,
} from "./scripting";
import { CONTENT_SCRIPT_FILE } from "../../shared/extension-files";
import { HTTP_MATCH_PATTERNS } from "../../shared/url/http";

/**
 * Stable browser registration identifier.
 */
export const DOCUMENT_RUNTIME_REGISTRATION_ID = "no-more-ago-documents" as const;

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
};

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
        left !== undefined
        && left.length === right.length
        && left.every((value, index) => value === right[index]);
    return existing.id === expected.id
        && same(existing.matches, expected.matches)
        && same(existing.js, expected.js)
        && existing.runAt === expected.runAt
        && existing.allFrames === expected.allFrames
        && existing.persistAcrossSessions === expected.persistAcrossSessions;
}
