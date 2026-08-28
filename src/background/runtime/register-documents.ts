/**
 * Owns the universal persistent document-start registration.
 *
 * @file Dynamic registration for all HTTP(S) document frames.
 */
import type { RegisteredContentScriptSpec, ScriptingRuntime } from "./scripting";
import type { RegisteredContentScriptReference } from "./scripting";
import { CONTENT_SCRIPT_FILE } from "../../shared/extension-files";
import { HTTP_MATCH_PATTERNS } from "../../shared/url/http";

/**
 * Stable browser registration identifier.
 */
export const DOCUMENT_RUNTIME_REGISTRATION_ID = "no-more-ago-documents" as const;

/**
 * Persistent registration identifiers created by pre-universal development builds.
 */
export const LEGACY_DOCUMENT_RUNTIME_REGISTRATION_IDS = ["no-more-ago-github"] as const;

/**
 * Every owned registration identifier inspected during reconciliation.
 */
export const DOCUMENT_RUNTIME_REGISTRATION_IDS = [
    DOCUMENT_RUNTIME_REGISTRATION_ID,
    ...LEGACY_DOCUMENT_RUNTIME_REGISTRATION_IDS,
] as const;

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

/**
 * Ensures the universal registration exists with the canonical specification.
 *
 * @param runtime - Browser scripting API boundary.
 * @returns Promise settled after registration repair.
 */
export async function ensureDocumentRuntime(runtime: ScriptingRuntime): Promise<void> {
    const existing = await runtime.getRegisteredContentScripts({
        ids: [...DOCUMENT_RUNTIME_REGISTRATION_IDS],
    });
    const legacyIds = existing
        .map((entry) => entry.id)
        .filter((id) => (LEGACY_DOCUMENT_RUNTIME_REGISTRATION_IDS as readonly string[])
            .includes(id));
    if (legacyIds.length > 0) {
        await runtime.unregisterContentScripts({ ids: legacyIds });
    }
    const current = existing.find((entry) => entry.id === DOCUMENT_RUNTIME_REGISTRATION_ID);
    if (!current) {
        await runtime.registerContentScripts([DOCUMENT_RUNTIME_REGISTRATION]);
        return;
    }
    if (!registrationMatches(current, DOCUMENT_RUNTIME_REGISTRATION)) {
        await runtime.updateContentScripts([DOCUMENT_RUNTIME_REGISTRATION]);
    }
}
