/**
 * @file Registers the content script required to process GitHub documents.
 */

import type { RegisteredContentScriptSpec, ScriptingRuntime } from "./scripting";
import type { RuntimeAdapterDefinition } from "./adapter-activation";

/**
 * Persistent document-start registration for top-level GitHub pages.
 */
export const GITHUB_REGISTRATION: RegisteredContentScriptSpec = {
    id: "no-more-ago-github",
    matches: ["http://github.com/*", "https://github.com/*"],
    js: ["content.js"],
    runAt: "document_start",
    allFrames: false,
    persistAcrossSessions: true,
};

/**
 * Registers the GitHub script when absent or updates it when its specification changed.
 *
 * @param runtime - Chrome scripting API boundary used to reconcile registration.
 */
export async function ensureGitHubRuntime(runtime: ScriptingRuntime): Promise<void> {
    const existing = await runtime.getRegisteredContentScripts({
        ids: [GITHUB_REGISTRATION.id],
    });
    const current = existing.find((script) => script.id === GITHUB_REGISTRATION.id);
    const same =
        current !== undefined &&
        current.matches !== undefined &&
        current.matches.length === GITHUB_REGISTRATION.matches.length &&
        current.matches.every((value, index) => value === GITHUB_REGISTRATION.matches[index]) &&
        current.js !== undefined &&
        current.js.length === GITHUB_REGISTRATION.js.length &&
        current.js.every((value, index) => value === GITHUB_REGISTRATION.js[index]) &&
        current.runAt === GITHUB_REGISTRATION.runAt &&
        current.allFrames === GITHUB_REGISTRATION.allFrames &&
        current.persistAcrossSessions === GITHUB_REGISTRATION.persistAcrossSessions;
    if (!current) {
        await runtime.registerContentScripts([GITHUB_REGISTRATION]);
    } else if (!same) {
        await runtime.updateContentScripts([GITHUB_REGISTRATION]);
    }
}

/**
 * GitHub adapter activation definition and its matching content-script registration.
 */
export const githubRuntimeDefinition: RuntimeAdapterDefinition = {
    id: "github",
    hostname: "github.com",
    registration: GITHUB_REGISTRATION,
    matches: (url) =>
        (url.protocol === "http:" || url.protocol === "https:") && url.hostname === "github.com",
};
