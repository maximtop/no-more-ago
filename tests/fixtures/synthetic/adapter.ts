import { githubAdapter } from "../../../src/adapters/github";
import { AdapterRegistry } from "../../../src/adapters/registry";
import { EXPLICIT_ZONED_DATETIME_RULE, type SiteAdapter } from "../../../src/adapters/types";
import type { RegisteredContentScriptSpec } from "../../../src/runtime/scripting";
import type { RuntimeAdapterDefinition } from "../../../src/runtime/adapter-activation";

export const SYNTHETIC_HOSTNAME = "synthetic.test" as const;
export const SYNTHETIC_SELECTOR = "time-ago.synthetic-event" as const;

export const SYNTHETIC_REGISTRATION: RegisteredContentScriptSpec = {
    id: "no-more-ago-synthetic",
    matches: ["http://synthetic.test/*", "https://synthetic.test/*"],
    js: ["content.js"],
    runAt: "document_start",
    allFrames: false,
    persistAcrossSessions: true
};

export const syntheticAdapter: SiteAdapter = {
    id: "synthetic",
    matches: (url) =>
        (url.protocol === "https:" || url.protocol === "http:") && url.hostname === SYNTHETIC_HOSTNAME,
    discover: (root) => {
        const candidates: Element[] = [];
        if (root instanceof Element && root.matches(SYNTHETIC_SELECTOR)) candidates.push(root);
        candidates.push(...root.querySelectorAll(SYNTHETIC_SELECTOR));
        return candidates;
    },
    extract: (element) => {
        if (!element.matches(SYNTHETIC_SELECTOR)) return null;
        const rawDatetime = element.getAttribute("datetime");
        if (!rawDatetime || rawDatetime.trim() === "") return null;
        return {
            adapterId: "synthetic",
            source: element,
            sourceKind: "time-ago",
            rawDatetime,
            timestampRule: EXPLICIT_ZONED_DATETIME_RULE
        };
    }
};

export const syntheticRuntimeDefinition: RuntimeAdapterDefinition = {
    id: "synthetic",
    hostname: SYNTHETIC_HOSTNAME,
    registration: SYNTHETIC_REGISTRATION,
    matches: (url) => syntheticAdapter.matches(url)
};

export function createSyntheticRegistry(): AdapterRegistry {
    return new AdapterRegistry([githubAdapter, syntheticAdapter]);
}

export const syntheticRegistry = createSyntheticRegistry();

export function createSyntheticRuntimeDefinitions(): readonly RuntimeAdapterDefinition[] {
    return [syntheticRuntimeDefinition];
}
