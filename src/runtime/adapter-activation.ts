/**
 * Reconciles adapter registrations and content-script lifecycle across tabs.
 *
 * @file Chrome scripting and tab reconciliation for runtime adapters.
 */


import type { RuntimeTab, TabsRuntime, DocumentPhase } from "./tabs";
import type { RegisteredContentScriptReference, RegisteredContentScriptSpec, ScriptingRuntime } from "./scripting";
import {
    DOCUMENT_STATUS_MESSAGE,
    TEARDOWN_DOCUMENT_MESSAGE,
    isDocumentStatusResponse,
    type DocumentStatusResponse
} from "./messages";
import { isSiteEnabled } from "../settings/snapshot";

/**
 * Trigger that determines whether registrations are refreshed, swept, or failed closed.
 */
export type ActivationMode = "cold-worker" | "activation-sweep" | "settings-change" | "failed-closed";

/**
 * Resolved global policy used to enable, disable, or conservatively stop adapters.
 */
export type ActivationPolicy = "enabled" | "disabled" | "unknown";

/**
 * Adapter metadata used to register, match, and reconcile one supported site.
 */
export interface RuntimeAdapterDefinition {
    /**
     * Stable identifier shared with the registered content script.
     */
    readonly id: string;

    /**
     * Canonical hostname whose preference controls this adapter.
     */
    readonly hostname: string;

    /**
     * Chrome content-script registration expected for the adapter.
     */
    readonly registration: RegisteredContentScriptSpec;

    /**
     * Applies adapter-specific URL matching after Chrome's pattern query.
     */
    readonly matches: (url: URL) => boolean;
}

/**
 * Structured registration, tab-query, and per-tab operation failures.
 */
export type ReconcileFailure =
  | { readonly scope: "registration"; readonly adapterId: string; readonly operation: "get" | "register" | "update" | "unregister" }
  | { readonly scope: "matching-tabs-query"; readonly adapterId: string }
  | { readonly scope: "tab"; readonly adapterId: string; readonly tabId: number; readonly action: "inject" | "teardown" | "status" };

/**
 * Complete reconciliation outcome for the requested revision, policy, and adapters.
 */
export interface ActivationReconcileResult {
    /**
     * Caller revision echoed so consumers can discard stale reconciliation results.
     */
    readonly revision: number | null;

    /**
     * Trigger mode that selected this reconciliation behavior.
     */
    readonly mode: ActivationMode;

    /**
     * Resolved policy applied while reconciling adapters.
     */
    readonly policy: ActivationPolicy;

    /**
     * All observed API failures, retained alongside partial successes.
     */
    readonly failures: readonly ReconcileFailure[];

    /**
     * Final registration outcome for each processed adapter.
     */
    readonly registration: Readonly<Record<string, "unchanged" | "registered" | "updated" | "unregistered" | "failed">>;

    /**
     * Injection, teardown, and status outcomes recorded for matching tabs.
     */
    readonly tabs: {
        /**
         * Adapter that selected the tab.
         */
        readonly adapterId: string;

        /**
         * Chrome tab ID targeted by the operation.
         */
        readonly tabId: number;

        /**
         * Lifecycle action attempted for the tab.
         */
        readonly action: "inject" | "teardown" | "status";

        /**
         * Reported document phase when a status probe succeeds.
         */
        readonly phase?: DocumentPhase;

        /**
         * Whether the attempted tab action completed successfully.
         */
        readonly ok: boolean
    }[];
}

/**
 * Dependencies and state supplied to a top-level activation reconciliation.
 */
export interface ReconcileInput {
    /**
     * Caller revision echoed in the result for stale-result handling.
     */
    readonly revision: number | null;

    /**
     * Event mode driving registration and tab actions.
     */
    readonly mode: ActivationMode;

    /**
     * Resolved global activation policy.
     */
    readonly policy: ActivationPolicy;

    /**
     * Adapter definitions to process; defaults to the coordinator's definitions.
     */
    readonly adapters?: readonly RuntimeAdapterDefinition[];

    /**
     * Per-host enabled flags used when global policy is enabled.
     */
    readonly sitePreferences?: Readonly<Record<string, boolean>>;

    /**
     * Optional hostname subset for a targeted settings update.
     */
    readonly affectedHostnames?: readonly string[];

    /**
     * Chrome Scripting API implementation for registered scripts and injection.
     */
    readonly scripting: ScriptingRuntime;

    /**
     * Chrome Tabs API implementation for matching and messaging tabs.
     */
    readonly tabs: TabsRuntime;
}

/**
 * Compares optional script fields with the exact order Chrome returned or expects.
 */
function sameArray(left: readonly string[] | undefined, right: readonly string[] | undefined): boolean {
    if (left === undefined || right === undefined) return left === right;
    return left.length === right.length && left.every((value, index) => value === right[index]);
}

/**
 * Checks whether Chrome's existing registration exactly matches the desired spec.
 */
export function registrationMatches(
    existing: RegisteredContentScriptReference,
    expected: RegisteredContentScriptSpec
): boolean {
    return existing.id === expected.id
    && sameArray(existing.matches, expected.matches)
    && sameArray(existing.js, expected.js)
    && existing.runAt === expected.runAt
    && existing.allFrames === expected.allFrames
    && existing.persistAcrossSessions === expected.persistAcrossSessions;
}

/**
 * Parses a tab URL, excluding absent or malformed values from adapter matching.
 */
function getUrl(tab: RuntimeTab): URL | null {
    if (!tab.url) return null;
    try { return new URL(tab.url); } catch { return null; }
}

/**
 * Identifies a document runtime that has already completed teardown.
 */
function isStopped(value: DocumentStatusResponse): boolean {
    return value.phase === "stopped";
}

/**
 * Queries Chrome by registration patterns, then filters results with the adapter matcher.
 */
async function queryMatchingTabs(
    definition: RuntimeAdapterDefinition,
    tabs: TabsRuntime,
    failures: ReconcileFailure[]
): Promise<readonly RuntimeTab[]> {
    let found: readonly RuntimeTab[];
    try {
        found = await tabs.query({ url: definition.registration.matches });
    } catch {
        failures.push({ scope: "matching-tabs-query", adapterId: definition.id });
        return [];
    }
    return found.filter((tab) => {
        const url = getUrl(tab);
        return url !== null && definition.matches(url);
    });
}

/**
 * Reconciles one Chrome content-script registration and records partial failures.
 */
async function registrationState(
    definition: RuntimeAdapterDefinition,
    scripting: ScriptingRuntime,
    mode: ActivationMode,
    desiredEnabled: boolean,
    failures: ReconcileFailure[],
    registration: Record<string, "unchanged" | "registered" | "updated" | "unregistered" | "failed">
): Promise<{ readonly present: boolean; readonly changed: boolean }> {
    let existing: readonly RegisteredContentScriptReference[];
    try {
        existing = await scripting.getRegisteredContentScripts({ ids: [definition.registration.id] });
    } catch {
        failures.push({ scope: "registration", adapterId: definition.id, operation: "get" });
        registration[definition.id] = "failed";
        if (!desiredEnabled && scripting.unregisterContentScripts) {
            try {
                await scripting.unregisterContentScripts({ ids: [definition.registration.id] });
                registration[definition.id] = "unregistered";
            } catch {
                failures.push({ scope: "registration", adapterId: definition.id, operation: "unregister" });
            }
        }
        return { present: false, changed: false };
    }
    const present = existing.some((item) => item.id === definition.registration.id);
    if (mode === "failed-closed" || mode === "settings-change") {
    // settings-change is handled by the caller based on policy; this branch only
    // describes registration inspection.
    }
    if (!desiredEnabled) {
        if (!present) { registration[definition.id] = "unchanged"; return { present: false, changed: false }; }
        try {
            if (!scripting.unregisterContentScripts) throw new Error("Unregister is unavailable");
            await scripting.unregisterContentScripts({ ids: [definition.registration.id] });
            registration[definition.id] = "unregistered";
            return { present: true, changed: true };
        } catch {
            failures.push({ scope: "registration", adapterId: definition.id, operation: "unregister" });
            registration[definition.id] = "failed";
            return { present: true, changed: false };
        }
    }
    const current = existing.find((item) => item.id === definition.registration.id);
    if (current && registrationMatches(current, definition.registration)) {
        registration[definition.id] = "unchanged";
        return { present: true, changed: false };
    }
    try {
        if (current) {
            await scripting.updateContentScripts([definition.registration]);
            registration[definition.id] = "updated";
        } else {
            await scripting.registerContentScripts([definition.registration]);
            registration[definition.id] = "registered";
        }
        return { present: true, changed: true };
    } catch {
        failures.push({ scope: "registration", adapterId: definition.id, operation: current ? "update" : "register" });
        registration[definition.id] = "failed";
        return { present: Boolean(current), changed: false };
    }
}

/**
 * Stops a matching top-frame runtime, optionally skipping teardown when already stopped.
 */
async function teardownTab(
    definition: RuntimeAdapterDefinition,
    tab: RuntimeTab,
    tabs: TabsRuntime,
    failures: ReconcileFailure[],
    records: ActivationReconcileResult["tabs"],
    checkStatus: boolean
): Promise<void> {
    if (checkStatus) {
        try {
            const response = await tabs.sendMessage(tab.id, { type: DOCUMENT_STATUS_MESSAGE }, { frameId: 0 });
            if (isDocumentStatusResponse(response) && isStopped(response)) {
                records.push({ adapterId: definition.id, tabId: tab.id, action: "status", phase: response.phase, ok: true });
                return;
            }
        } catch {
            failures.push({ scope: "tab", adapterId: definition.id, tabId: tab.id, action: "status" });
            records.push({ adapterId: definition.id, tabId: tab.id, action: "status", ok: false });
            // A status failure must not prevent fail-closed/disable teardown: send the
            // exact top-frame teardown message as a separate operation.
        }
    }
    try {
        await tabs.sendMessage(tab.id, { type: TEARDOWN_DOCUMENT_MESSAGE }, { frameId: 0 });
        records.push({ adapterId: definition.id, tabId: tab.id, action: "teardown", ok: true });
    } catch {
        failures.push({ scope: "tab", adapterId: definition.id, tabId: tab.id, action: "teardown" });
        records.push({ adapterId: definition.id, tabId: tab.id, action: "teardown", ok: false });
    }
}

/**
 * Stateful coordinator sharing adapter definitions and Chrome API dependencies.
 */
export class AdapterActivationCoordinator {
    /**
     * Adapter definitions reconciled by this coordinator.
     */
    private readonly adapters: readonly RuntimeAdapterDefinition[];

    /**
     * Chrome Scripting API used to manage registrations and inject adapters.
     */
    private readonly scripting: ScriptingRuntime;

    /**
     * Chrome Tabs API used to find matching documents and request teardown.
     */
    private readonly tabs: TabsRuntime;

    /**
     * Stores default adapter definitions and the Chrome Scripting and Tabs APIs.
     */
    public constructor(input: { readonly adapters?: readonly RuntimeAdapterDefinition[]; readonly scripting: ScriptingRuntime; readonly tabs: TabsRuntime }) {
        this.adapters = input.adapters ?? [];
        this.scripting = input.scripting;
        this.tabs = input.tabs;
    }

    /**
     * Reconciles registrations, injections, and teardown for the supplied activation state.
     */
    public async reconcile(input: {
        readonly revision: number | null;
        readonly mode: ActivationMode;
        readonly policy: ActivationPolicy;
        readonly sitePreferences?: Readonly<Record<string, boolean>>;
        readonly affectedHostnames?: readonly string[];
    }): Promise<ActivationReconcileResult> {
        const failures: ReconcileFailure[] = [];
        const registration: Record<string, "unchanged" | "registered" | "updated" | "unregistered" | "failed"> = {};
        const records: ActivationReconcileResult["tabs"] = [];
        for (const definition of this.adapters) {
            if (input.affectedHostnames !== undefined && !input.affectedHostnames.includes(definition.hostname)) continue;
            const desiredEnabled = input.policy === "enabled" && isSiteEnabled(input.sitePreferences ?? {}, definition.hostname);
            const state = await registrationState(
                definition,
                this.scripting,
                desiredEnabled ? input.mode : (input.mode === "failed-closed" || input.policy !== "enabled" ? "failed-closed" : input.mode),
                desiredEnabled,
                failures,
                registration
            );
            if (desiredEnabled) {
                const shouldInject = input.mode !== "cold-worker" || state.changed;
                if (!shouldInject) continue;
                const matching = await queryMatchingTabs(definition, this.tabs, failures);
                await Promise.all(matching.map(async (tab) => {
                    try {
                        if (!this.scripting.executeScript) throw new Error("Script execution is unavailable");
                        await this.scripting.executeScript({ target: { tabId: tab.id, allFrames: false }, files: definition.registration.js });
                        records.push({ adapterId: definition.id, tabId: tab.id, action: "inject", ok: true });
                    } catch {
                        failures.push({ scope: "tab", adapterId: definition.id, tabId: tab.id, action: "inject" });
                        records.push({ adapterId: definition.id, tabId: tab.id, action: "inject", ok: false });
                    }
                }));
            } else {
                const matching = await queryMatchingTabs(definition, this.tabs, failures);
                await Promise.all(matching.map((tab) => teardownTab(definition, tab, this.tabs, failures, records, input.policy !== "unknown" && input.mode !== "failed-closed")));
            }
        }
        return { revision: input.revision, mode: input.mode, policy: input.policy, failures, registration, tabs: records };
    }
}

/**
 * Reconciles activation once using a coordinator constructed from the input dependencies.
 */
export async function reconcileActivation(input: ReconcileInput): Promise<ActivationReconcileResult> {
    return new AdapterActivationCoordinator(input).reconcile(input);
}
