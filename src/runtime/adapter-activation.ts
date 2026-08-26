import type { RuntimeTab, TabsRuntime, DocumentPhase } from "./tabs";
import type { RegisteredContentScriptReference, RegisteredContentScriptSpec, ScriptingRuntime } from "./scripting";
import {
    DOCUMENT_STATUS_MESSAGE,
    TEARDOWN_DOCUMENT_MESSAGE,
    isDocumentStatusResponse,
    type DocumentStatusResponse
} from "./messages";
import { isSiteEnabled } from "../settings/snapshot";

export type ActivationMode = "cold-worker" | "activation-sweep" | "settings-change" | "failed-closed";
export type ActivationPolicy = "enabled" | "disabled" | "unknown";

export interface RuntimeAdapterDefinition {
    readonly id: string;
    readonly hostname: string;
    readonly registration: RegisteredContentScriptSpec;
    readonly matches: (url: URL) => boolean;
}

export type ReconcileFailure =
  | { readonly scope: "registration"; readonly adapterId: string; readonly operation: "get" | "register" | "update" | "unregister" }
  | { readonly scope: "matching-tabs-query"; readonly adapterId: string }
  | { readonly scope: "tab"; readonly adapterId: string; readonly tabId: number; readonly action: "inject" | "teardown" | "status" };

export interface ActivationReconcileResult {
    readonly revision: number | null;
    readonly mode: ActivationMode;
    readonly policy: ActivationPolicy;
    readonly failures: readonly ReconcileFailure[];
    readonly registration: Readonly<Record<string, "unchanged" | "registered" | "updated" | "unregistered" | "failed">>;
    readonly tabs: { readonly adapterId: string; readonly tabId: number; readonly action: "inject" | "teardown" | "status"; readonly phase?: DocumentPhase; readonly ok: boolean }[];
}

export interface ReconcileInput {
    readonly revision: number | null;
    readonly mode: ActivationMode;
    readonly policy: ActivationPolicy;
    readonly adapters?: readonly RuntimeAdapterDefinition[];
    readonly sitePreferences?: Readonly<Record<string, boolean>>;
    readonly affectedHostnames?: readonly string[];
    readonly scripting: ScriptingRuntime;
    readonly tabs: TabsRuntime;
}

function sameArray(left: readonly string[] | undefined, right: readonly string[] | undefined): boolean {
    if (left === undefined || right === undefined) return left === right;
    return left.length === right.length && left.every((value, index) => value === right[index]);
}

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

function getUrl(tab: RuntimeTab): URL | null {
    if (!tab.url) return null;
    try { return new URL(tab.url); } catch { return null; }
}

function isStopped(value: DocumentStatusResponse): boolean {
    return value.phase === "stopped";
}

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

export class AdapterActivationCoordinator {
    private readonly adapters: readonly RuntimeAdapterDefinition[];
    private readonly scripting: ScriptingRuntime;
    private readonly tabs: TabsRuntime;

    public constructor(input: { readonly adapters?: readonly RuntimeAdapterDefinition[]; readonly scripting: ScriptingRuntime; readonly tabs: TabsRuntime }) {
        this.adapters = input.adapters ?? [];
        this.scripting = input.scripting;
        this.tabs = input.tabs;
    }

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

export async function reconcileActivation(input: ReconcileInput): Promise<ActivationReconcileResult> {
    return new AdapterActivationCoordinator(input).reconcile(input);
}
