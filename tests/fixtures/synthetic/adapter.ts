/**
 * @file Defines a synthetic trusted adapter fixture for integration tests.
 */

import { githubAdapter } from "../../../src/adapters/github";
import { AdapterRegistry } from "../../../src/adapters/registry";
import { EXPLICIT_ZONED_DATETIME_RULE, type SiteAdapter } from "../../../src/adapters/types";
import type { RegisteredContentScriptSpec } from "../../../src/runtime/scripting";
import type { RuntimeAdapterDefinition } from "../../../src/runtime/adapter-activation";

/**
 * Canonical hostname accepted by the synthetic adapter.
 */
export const SYNTHETIC_HOSTNAME = "synthetic.test" as const;

/**
 * Selector used to discover authoritative synthetic timestamps.
 */
export const SYNTHETIC_SELECTOR = "time-ago.synthetic-event" as const;

/**
 * Persistent content-script registration for the synthetic hostname.
 */
export const SYNTHETIC_REGISTRATION: RegisteredContentScriptSpec = {
    id: "no-more-ago-synthetic",
    matches: ["http://synthetic.test/*", "https://synthetic.test/*"],
    js: ["content.js"],
    runAt: "document_start",
    allFrames: false,
    persistAcrossSessions: true
};

/**
 * Trusted synthetic adapter used to verify registry extensibility.
 */
export const syntheticAdapter: SiteAdapter = {
    id: "synthetic",
    matches: (url) =>
        (url.protocol === "https:" || url.protocol === "http:") && url.hostname === SYNTHETIC_HOSTNAME,
    discover: (root) => {
        const candidates: Element[] = [];
        if (root instanceof Element && root.matches(SYNTHETIC_SELECTOR)) {
            candidates.push(root);
        }
        candidates.push(...root.querySelectorAll(SYNTHETIC_SELECTOR));
        return candidates;
    },
    extract: (element) => {
        if (!element.matches(SYNTHETIC_SELECTOR)) {
            return null;
        }
        const rawDatetime = element.getAttribute("datetime");
        if (!rawDatetime || rawDatetime.trim() === "") {
            return null;
        }
        return {
            adapterId: "synthetic",
            source: element,
            sourceKind: "time-ago",
            rawDatetime,
            timestampRule: EXPLICIT_ZONED_DATETIME_RULE
        };
    }
};

/**
 * Runtime activation definition corresponding to the synthetic adapter.
 */
export const syntheticRuntimeDefinition: RuntimeAdapterDefinition = {
    id: "synthetic",
    hostname: SYNTHETIC_HOSTNAME,
    registration: SYNTHETIC_REGISTRATION,
    matches: (url) => syntheticAdapter.matches(url)
};

/**
 * Creates a registry containing both GitHub and synthetic adapters.
 *
 * @returns - Trusted adapter registry for cross-site integration tests.
 */
export function createSyntheticRegistry(): AdapterRegistry {
    return new AdapterRegistry([githubAdapter, syntheticAdapter]);
}

/**
 * Shared registry containing the production and synthetic adapters.
 */
export const syntheticRegistry = createSyntheticRegistry();

/**
 * Creates the runtime adapter list used by synthetic activation tests.
 *
 * @returns - Runtime definitions for the synthetic site.
 */
export function createSyntheticRuntimeDefinitions(): readonly RuntimeAdapterDefinition[] {
    return [syntheticRuntimeDefinition];
}
