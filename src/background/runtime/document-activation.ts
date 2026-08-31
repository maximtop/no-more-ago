/**
 * Reconciles one universal document runtime across HTTP(S) tabs and frames.
 *
 * @file Chrome scripting and tab reconciliation for the document runtime.
 */
import { CONTENT_SCRIPT_FILE } from "../../shared/extension-files";
import { HTTP_MATCH_PATTERNS, parseHttpUrl } from "../../shared/url/http";
import { isSiteEnabled } from "../../shared/settings/snapshot";
import {
    REFRESH_DOCUMENT_POLICY_MESSAGE,
    SUSPEND_AND_REFRESH_DOCUMENT_POLICY_MESSAGE,
    TEARDOWN_DOCUMENT_MESSAGE,
} from "../../shared/messaging/document-messages";
import type { RuntimeTab, TabsRuntime } from "./tabs";
import type {
    RegisteredContentScriptReference,
    ScriptingRuntime,
} from "./scripting";
import {
    DOCUMENT_RUNTIME_REGISTRATION,
    DOCUMENT_RUNTIME_REGISTRATION_ID,
    registrationMatches,
} from "./register-documents";

const TAB_OPERATION_TIMEOUT_MS = 1_000;

/**
 * Global activation policy values.
 */
export const ACTIVATION_POLICY = {
    ENABLED: "enabled",
    DISABLED: "disabled",
    UNKNOWN: "unknown",
} as const;

/**
 * Registration operation outcomes.
 */
export const REGISTRATION_OUTCOME = {
    UNCHANGED: "unchanged",
    REGISTERED: "registered",
    UPDATED: "updated",
    UNREGISTERED: "unregistered",
    FAILED: "failed",
} as const;

/**
 * Reconciliation failure scopes.
 */
export const RECONCILE_FAILURE_SCOPE = {
    REGISTRATION: "registration",
    MATCHING_TABS_QUERY: "matching-tabs-query",
    TAB: "tab",
} as const;

/**
 * Registration operations retained in reconciliation failures.
 */
export const REGISTRATION_OPERATION = {
    GET: "get",
    REGISTER: "register",
    UPDATE: "update",
    UNREGISTER: "unregister",
} as const;

/**
 * Tab actions retained in reconciliation failures and outcomes.
 */
export const TAB_ACTION = {
    INJECT: "inject",
    TEARDOWN: "teardown",
} as const;

/**
 * Global activation policy.
 */
export type ActivationPolicy = (typeof ACTIVATION_POLICY)[keyof typeof ACTIVATION_POLICY];

/**
 * Registration operation outcome.
 */
export type RegistrationOutcome =
    (typeof REGISTRATION_OUTCOME)[keyof typeof REGISTRATION_OUTCOME];

/**
 * Reconciliation failure retained with independent successes.
 */
export type ReconcileFailure =
    | {
        /**
         * Identifies a registration operation failure.
         */
        readonly scope: typeof RECONCILE_FAILURE_SCOPE.REGISTRATION;

        /**
         * Failed registration operation.
         */
        readonly operation: (typeof REGISTRATION_OPERATION)[keyof typeof REGISTRATION_OPERATION];
    }
    | {
        /**
         * Identifies a matching-tab query failure.
         */
        readonly scope: typeof RECONCILE_FAILURE_SCOPE.MATCHING_TABS_QUERY;
    }
    | {
        /**
         * Identifies a tab operation failure.
         */
        readonly scope: typeof RECONCILE_FAILURE_SCOPE.TAB;

        /**
         * Affected tab identifier.
         */
        readonly tabId: number;

        /**
         * Canonical top-level hostname at the time of the failed operation.
         */
        readonly hostname: string;

        /**
         * Failed tab action.
         */
        readonly action: (typeof TAB_ACTION)[keyof typeof TAB_ACTION];
    };

/**
 * Complete universal-runtime reconciliation result.
 */
export interface ActivationReconcileResult {
    /**
     * Settings revision associated with this result.
     */
    readonly revision: number | null;

    /**
     * Global activation policy applied.
     */
    readonly policy: ActivationPolicy;

    /**
     * Failures observed during reconciliation.
     */
    readonly failures: readonly ReconcileFailure[];

    /**
     * Universal registration operation outcome.
     */
    readonly registration: RegistrationOutcome;

    /**
     * Outcomes recorded for each selected tab.
     */
    readonly tabs: readonly TabOutcome[];
}

/**
 * Reconciliation policy and optional host filter.
 */
interface ReconcileOptions {
    /**
     * Settings revision associated with this operation.
     */
    readonly revision: number | null;

    /**
     * Global activation policy to apply.
     */
    readonly policy: ActivationPolicy;

    /**
     * Per-host activation preferences.
     */
    readonly sitePreferences?: Readonly<Record<string, boolean>>;

    /**
     * Optional host filter for a settings update.
     */
    readonly affectedHostnames?: readonly string[];
}

/**
 * Outcome of an operation attempted for one top-level tab.
 */
interface TabOutcome {
    /**
     * Top-level tab identifier.
     */
    readonly tabId: number;

    /**
     * Canonical top-level hostname at the time of the operation.
     */
    readonly hostname: string;

    /**
     * Operation attempted for the tab.
     */
    readonly action: (typeof TAB_ACTION)[keyof typeof TAB_ACTION];

    /**
     * Whether the operation succeeded.
     */
    readonly ok: boolean;
}

/**
 * Mutable sink used to collect tab operation outcomes.
 */
interface TabOutcomeSink {
    /**
     * Adds one tab operation outcome.
     *
     * @param value - Outcome to retain.
     * @returns - Ignored collection result.
     */
    push(value: TabOutcome): unknown;
}

/**
 * Browser boundaries required by the activation coordinator.
 */
interface DocumentActivationDependencies {
    /**
     * Scripting API boundary.
     */
    readonly scripting: ScriptingRuntime;

    /**
     * Tabs API boundary.
     */
    readonly tabs: TabsRuntime;
}

/**
 * Settles a browser operation without rejecting reconciliation.
 *
 * @param operation - Operation to invoke and settle.
 * @returns - A tagged success or failure result.
 */
function settle<T>(operation: () => Promise<T>): Promise<
    { readonly ok: true; readonly value: T } | { readonly ok: false }
> {
    try {
        return Promise.resolve(operation()).then(
            (value) => ({ ok: true, value } as const),
            () => ({ ok: false } as const),
        );
    } catch {
        return Promise.resolve({ ok: false } as const);
    }
}

/**
 * Settles a browser operation within a bounded interval.
 *
 * @param operation - Browser operation to invoke.
 * @param timeoutMs - Maximum time to wait for settlement.
 * @returns - The operation result, or a tagged failure after the timeout.
 */
async function settleWithin<T>(
    operation: () => Promise<T>,
    timeoutMs: number,
): Promise<{ readonly ok: true; readonly value: T } | { readonly ok: false }> {
    let timeoutId: ReturnType<typeof globalThis.setTimeout> | undefined;
    const timeout = new Promise<{ readonly ok: false }>((resolve) => {
        timeoutId = globalThis.setTimeout(() => {
            resolve({ ok: false });
        }, timeoutMs);
    });
    try {
        return await Promise.race([settle(operation), timeout]);
    } finally {
        if (timeoutId !== undefined) {
            globalThis.clearTimeout(timeoutId);
        }
    }
}

/**
 * Reconciles the universal registration.
 *
 * @param scripting - Scripting API boundary.
 * @param enabled - Whether global processing is enabled.
 * @param failures - Failure collection to append to.
 * @returns - Registration operation outcome.
 */
async function registration(
    scripting: ScriptingRuntime,
    enabled: boolean,
    failures: ReconcileFailure[],
): Promise<RegistrationOutcome> {
    let found: readonly RegisteredContentScriptReference[];
    let current: RegisteredContentScriptReference | undefined;
    try {
        found = await scripting.getRegisteredContentScripts({
            ids: [DOCUMENT_RUNTIME_REGISTRATION_ID],
        });
        current = found.find((entry) => entry.id === DOCUMENT_RUNTIME_REGISTRATION_ID);
    } catch {
        failures.push({
            scope: RECONCILE_FAILURE_SCOPE.REGISTRATION,
            operation: REGISTRATION_OPERATION.GET,
        });
        return REGISTRATION_OUTCOME.FAILED;
    }
    if (!enabled) {
        const registeredIds = found.map((entry) => entry.id);
        if (registeredIds.length === 0) {
            return REGISTRATION_OUTCOME.UNCHANGED;
        }
        try {
            await scripting.unregisterContentScripts({ ids: registeredIds });
            return REGISTRATION_OUTCOME.UNREGISTERED;
        } catch {
            failures.push({
                scope: RECONCILE_FAILURE_SCOPE.REGISTRATION,
                operation: REGISTRATION_OPERATION.UNREGISTER,
            });
            return REGISTRATION_OUTCOME.FAILED;
        }
    }
    if (current && registrationMatches(current, DOCUMENT_RUNTIME_REGISTRATION)) {
        return REGISTRATION_OUTCOME.UNCHANGED;
    }
    try {
        if (current) {
            await scripting.updateContentScripts([DOCUMENT_RUNTIME_REGISTRATION]);
            return REGISTRATION_OUTCOME.UPDATED;
        }
        await scripting.registerContentScripts([DOCUMENT_RUNTIME_REGISTRATION]);
        return REGISTRATION_OUTCOME.REGISTERED;
    } catch {
        failures.push({
            scope: RECONCILE_FAILURE_SCOPE.REGISTRATION,
            operation: current ? REGISTRATION_OPERATION.UPDATE : REGISTRATION_OPERATION.REGISTER,
        });
        return REGISTRATION_OUTCOME.FAILED;
    }
}

/**
 * Queries and validates HTTP(S) tabs.
 *
 * @param tabs - Tabs API boundary.
 * @param failures - Failure collection to append to.
 * @returns - Distinct HTTP(S) runtime tabs.
 */
async function httpTabs(
    tabs: TabsRuntime,
    failures: ReconcileFailure[],
): Promise<readonly RuntimeTab[]> {
    try {
        const found = await tabs.query({ url: [...HTTP_MATCH_PATTERNS] });
        const seen = new Set<number>();
        return found.filter((tab) => {
            const url = parseHttpUrl(tab.url);
            if (!url || seen.has(tab.id)) {
                return false;
            }
            seen.add(tab.id);
            return true;
        });
    } catch {
        failures.push({ scope: RECONCILE_FAILURE_SCOPE.MATCHING_TABS_QUERY });
        return [];
    }
}

/**
 * Broadcasts policy, then ensures the content runtime in all frames.
 *
 * @param tab - Target tab.
 * @param hostname - Canonical top-level hostname for the target tab.
 * @param enabled - Whether the site's effective policy is enabled.
 * @param scripting - Scripting API boundary.
 * @param tabs - Tabs API boundary.
 * @param failures - Failure collection to append to.
 * @param records - Tab outcome collection to append to.
 * @returns - Promise settled after both operations.
 */
async function refresh(
    tab: RuntimeTab,
    hostname: string,
    enabled: boolean,
    scripting: ScriptingRuntime,
    tabs: TabsRuntime,
    failures: ReconcileFailure[],
    records: TabOutcomeSink,
): Promise<void> {
    await settleWithin(() => tabs.sendMessage(tab.id, {
        type: enabled
            ? REFRESH_DOCUMENT_POLICY_MESSAGE
            : SUSPEND_AND_REFRESH_DOCUMENT_POLICY_MESSAGE,
    }), TAB_OPERATION_TIMEOUT_MS);
    const ensured = await settleWithin(() => scripting.executeScript({
        target: { tabId: tab.id, allFrames: true },
        files: [CONTENT_SCRIPT_FILE],
    }), TAB_OPERATION_TIMEOUT_MS);
    const ok = ensured.ok && Array.isArray(ensured.value) && ensured.value.length > 0;
    if (!ok) {
        failures.push({
            scope: RECONCILE_FAILURE_SCOPE.TAB,
            tabId: tab.id,
            hostname,
            action: TAB_ACTION.INJECT,
        });
    }
    records.push({ tabId: tab.id, hostname, action: TAB_ACTION.INJECT, ok });
}

/**
 * Broadcasts synchronous teardown to every reachable frame.
 *
 * @param tab - Target tab.
 * @param hostname - Canonical top-level hostname for the target tab.
 * @param tabs - Tabs API boundary.
 * @param failures - Failure collection to append to.
 * @param records - Tab outcome collection to append to.
 * @returns - Promise settled after the broadcast.
 */
async function teardown(
    tab: RuntimeTab,
    hostname: string,
    tabs: TabsRuntime,
    failures: ReconcileFailure[],
    records: TabOutcomeSink,
): Promise<void> {
    const result = await settleWithin(
        () => tabs.sendMessage(tab.id, { type: TEARDOWN_DOCUMENT_MESSAGE }),
        TAB_OPERATION_TIMEOUT_MS,
    );
    if (!result.ok) {
        failures.push({
            scope: RECONCILE_FAILURE_SCOPE.TAB,
            tabId: tab.id,
            hostname,
            action: TAB_ACTION.TEARDOWN,
        });
    }
    records.push({ tabId: tab.id, hostname, action: TAB_ACTION.TEARDOWN, ok: result.ok });
}

/**
 * Coordinates universal registration and tab/frame lifecycle.
 */
export class DocumentActivationCoordinator {
    /**
     * Creates a coordinator over browser API boundaries.
     *
     * @param input - Browser scripting and tabs boundaries.
     * @returns - A coordinator over those boundaries.
     */
    public constructor(
        private readonly input: DocumentActivationDependencies,
    ) {}

    /**
     * Reconciles registration and selected top-level documents.
     *
     * @param input - Reconciliation policy and optional host filter.
     * @returns - Complete reconciliation result.
     */
    public async reconcile(
        input: ReconcileOptions,
    ): Promise<ActivationReconcileResult> {
        const failures: ReconcileFailure[] = [];
        const records: TabOutcome[] = [];
        const enabled = input.policy === ACTIVATION_POLICY.ENABLED;
        const registered = await registration(this.input.scripting, enabled, failures);
        const tabs = await httpTabs(this.input.tabs, failures);
        const affected = input.affectedHostnames === undefined
            ? undefined
            : new Set(input.affectedHostnames);
        const selected = tabs.filter((tab) => {
            const url = parseHttpUrl(tab.url);
            return url !== null && (affected === undefined || affected.has(url.hostname));
        });
        await Promise.all(selected.map(async (tab) => {
            const url = parseHttpUrl(tab.url);
            if (!url) {
                return;
            }
            if (!enabled) {
                await teardown(tab, url.hostname, this.input.tabs, failures, records);
                return;
            }
            const siteEnabled = isSiteEnabled(input.sitePreferences ?? {}, url.hostname);
            await refresh(
                tab,
                url.hostname,
                siteEnabled,
                this.input.scripting,
                this.input.tabs,
                failures,
                records,
            );
        }));
        return {
            revision: input.revision,
            policy: input.policy,
            failures,
            registration: registered,
            tabs: records,
        };
    }
}
