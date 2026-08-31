/**
 * Reconciles one universal document runtime across HTTP(S) tabs and frames.
 *
 * @file Chrome scripting and tab reconciliation for the document runtime.
 */
import { CONTENT_SCRIPT_FILE } from "../../shared/extension-files";
import { HTTP_MATCH_PATTERNS, parseHttpUrl } from "../../shared/url/http";
import { isSiteEnabled } from "../../shared/settings/snapshot";
import {
    isDocumentPolicyReconciledMessage,
    RECONCILE_DOCUMENT_POLICY_MESSAGE,
    type ReconcileDocumentPolicyMessage,
} from "../../shared/messaging/document-messages";
import type { RuntimeTab, TabsRuntime } from "./tabs";
import type { ScriptingRuntime } from "./scripting";
import {
    DOCUMENT_RUNTIME_REGISTRATION,
    DOCUMENT_RUNTIME_REGISTRATION_ID,
    registrationMatches,
} from "./register-documents";
import { settleBrowserOperation } from "./settle";

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
 * Reconciles the universal registration.
 *
 * @param scripting - Scripting API boundary.
 * @param enabled - Whether global processing is enabled.
 * @param failures - Failure collection to append to.
 * @param onLateWrite - Optional convergence request after a timed-out write succeeds.
 * @returns - Registration operation outcome.
 */
async function registration(
    scripting: ScriptingRuntime,
    enabled: boolean,
    failures: ReconcileFailure[],
    onLateWrite?: () => void,
): Promise<RegistrationOutcome> {
    const inspected = await settleBrowserOperation(
        () => scripting.getRegisteredContentScripts({
            ids: [DOCUMENT_RUNTIME_REGISTRATION_ID],
        }),
    );
    if (!inspected.ok) {
        failures.push({
            scope: RECONCILE_FAILURE_SCOPE.REGISTRATION,
            operation: REGISTRATION_OPERATION.GET,
        });
        return REGISTRATION_OUTCOME.FAILED;
    }
    const found = inspected.value;
    const current = found.find((entry) => entry.id === DOCUMENT_RUNTIME_REGISTRATION_ID);
    if (!enabled) {
        const registeredIds = found.map((entry) => entry.id);
        if (registeredIds.length === 0) {
            return REGISTRATION_OUTCOME.UNCHANGED;
        }
        const removed = await settleRegistrationWrite(
            () => scripting.unregisterContentScripts({ ids: registeredIds }),
            onLateWrite,
        );
        if (removed) {
            return REGISTRATION_OUTCOME.UNREGISTERED;
        }
        failures.push({
            scope: RECONCILE_FAILURE_SCOPE.REGISTRATION,
            operation: REGISTRATION_OPERATION.UNREGISTER,
        });
        return REGISTRATION_OUTCOME.FAILED;
    }
    if (current && registrationMatches(current, DOCUMENT_RUNTIME_REGISTRATION)) {
        return REGISTRATION_OUTCOME.UNCHANGED;
    }
    const written = await settleRegistrationWrite(
        () => current
            ? scripting.updateContentScripts([DOCUMENT_RUNTIME_REGISTRATION])
            : scripting.registerContentScripts([DOCUMENT_RUNTIME_REGISTRATION]),
        onLateWrite,
    );
    if (written) {
        return current ? REGISTRATION_OUTCOME.UPDATED : REGISTRATION_OUTCOME.REGISTERED;
    }
    failures.push({
        scope: RECONCILE_FAILURE_SCOPE.REGISTRATION,
        operation: current ? REGISTRATION_OPERATION.UPDATE : REGISTRATION_OPERATION.REGISTER,
    });
    return REGISTRATION_OUTCOME.FAILED;
}

/**
 * Bounds one idempotent registration write and observes a successful late completion.
 *
 * @param operation - Registration mutation to invoke once.
 * @param onLateWrite - Callback requesting convergence after a timed-out write succeeds.
 * @returns - Whether the write completed successfully before the deadline.
 */
async function settleRegistrationWrite(
    operation: () => Promise<void>,
    onLateWrite?: () => void,
): Promise<boolean> {
    let pending: Promise<void>;
    try {
        pending = Promise.resolve(operation());
    } catch {
        return false;
    }
    let deadlineElapsed = false;
    void pending.then(
        () => {
            if (deadlineElapsed) {
                onLateWrite?.();
            }
        },
        () => undefined,
    );
    const result = await settleBrowserOperation(() => pending);
    if (!result.ok) {
        deadlineElapsed = true;
    }
    return result.ok;
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
    const queried = await settleBrowserOperation(
        () => tabs.query({ url: [...HTTP_MATCH_PATTERNS] }),
    );
    if (!queried.ok) {
        failures.push({ scope: RECONCILE_FAILURE_SCOPE.MATCHING_TABS_QUERY });
        return [];
    }
    const seen = new Set<number>();
    return queried.value.filter((tab) => {
        const url = parseHttpUrl(tab.url);
        if (!url || seen.has(tab.id)) {
            return false;
        }
        seen.add(tab.id);
        return true;
    });
}

/**
 * Delivers one idempotent policy command and verifies its retained revision.
 *
 * @param tabs - Tabs API boundary.
 * @param tabId - Target top-level tab identifier.
 * @param frameId - Exact reachable frame receiving the command.
 * @param message - Effective policy and associated settings revision.
 * @returns - Whether a document runtime acknowledged the exact revision.
 */
async function deliverPolicy(
    tabs: TabsRuntime,
    tabId: number,
    frameId: number,
    message: ReconcileDocumentPolicyMessage,
): Promise<boolean> {
    const result = await settleBrowserOperation(
        () => tabs.sendMessage(tabId, message, { frameId }),
    );
    return result.ok
        && isDocumentPolicyReconciledMessage(result.value, message.revision);
}

/**
 * Enumerates reachable HTTP(S) frames within the shared browser-operation deadline.
 *
 * @param tabs - Tabs and frame browser boundary.
 * @param tabId - Tab whose frames are requested.
 * @returns - Distinct reachable frame IDs, or an empty list on failure.
 */
async function frameIds(tabs: TabsRuntime, tabId: number): Promise<readonly number[]> {
    const frames = await settleBrowserOperation(() => tabs.getAllFrames(tabId));
    if (!frames.ok) {
        return [];
    }
    return [...new Set(frames.value.map((frame) => frame.frameId))];
}

/**
 * Delivers one policy to every supplied frame and requires every acknowledgement.
 *
 * @param tabs - Tabs browser boundary.
 * @param tabId - Target tab identifier.
 * @param frames - Exact frame identifiers receiving the command.
 * @param message - Effective policy command.
 * @returns - Acknowledgement state keyed by frame identifier.
 */
async function deliverPolicyToFrames(
    tabs: TabsRuntime,
    tabId: number,
    frames: readonly number[],
    message: ReconcileDocumentPolicyMessage,
): Promise<ReadonlyMap<number, boolean>> {
    const acknowledged = await Promise.all(frames.map(async (frameId) => [
        frameId,
        await deliverPolicy(tabs, tabId, frameId, message),
    ] as const));
    return new Map(acknowledged);
}

/**
 * Ensures the content runtime in all frames and converges it on the requested policy.
 *
 * @param tab - Target tab.
 * @param hostname - Canonical top-level hostname for the target tab.
 * @param enabled - Whether the site's effective policy is enabled.
 * @param revision - Settings revision associated with this operation.
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
    revision: number | null,
    scripting: ScriptingRuntime,
    tabs: TabsRuntime,
    failures: ReconcileFailure[],
    records: TabOutcomeSink,
): Promise<void> {
    const message = {
        type: RECONCILE_DOCUMENT_POLICY_MESSAGE,
        revision,
        enabled,
    } as const;
    const initialFrames = frameIds(tabs, tab.id);
    const [initialPolicy, ensured] = await Promise.all([
        initialFrames.then((frames) => deliverPolicyToFrames(tabs, tab.id, frames, message)),
        settleBrowserOperation(
            () => scripting.executeScript({
                target: { tabId: tab.id, allFrames: true },
                files: [CONTENT_SCRIPT_FILE],
            }),
        ),
    ]);
    const ensuredFrames = ensured.ok
        ? [...new Set(ensured.value.map((result) => result.frameId))]
        : [];
    const runtimeEnsured = ensuredFrames.length > 0;
    const retryFrames = ensuredFrames.filter((frameId) => initialPolicy.get(frameId) !== true);
    const retriedPolicy = await deliverPolicyToFrames(
        tabs,
        tab.id,
        retryFrames,
        message,
    );
    const policyOk = ensuredFrames.length > 0 && ensuredFrames.every(
        (frameId) => initialPolicy.get(frameId) === true || retriedPolicy.get(frameId) === true,
    );
    const ok = runtimeEnsured && policyOk;
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
 * Reconciles every reachable frame to a disabled global policy.
 *
 * @param tab - Target tab.
 * @param hostname - Canonical top-level hostname for the target tab.
 * @param revision - Settings revision associated with this operation.
 * @param tabs - Tabs API boundary.
 * @param failures - Failure collection to append to.
 * @param records - Tab outcome collection to append to.
 * @returns - Promise settled after the broadcast.
 */
async function teardown(
    tab: RuntimeTab,
    hostname: string,
    revision: number | null,
    tabs: TabsRuntime,
    failures: ReconcileFailure[],
    records: TabOutcomeSink,
): Promise<void> {
    const frames = await frameIds(tabs, tab.id);
    const acknowledgements = await deliverPolicyToFrames(tabs, tab.id, frames, {
        type: RECONCILE_DOCUMENT_POLICY_MESSAGE,
        revision,
        enabled: false,
    });
    const ok = frames.length > 0 && frames.every(
        (frameId) => acknowledgements.get(frameId) === true,
    );
    if (!ok) {
        failures.push({
            scope: RECONCILE_FAILURE_SCOPE.TAB,
            tabId: tab.id,
            hostname,
            action: TAB_ACTION.TEARDOWN,
        });
    }
    records.push({ tabId: tab.id, hostname, action: TAB_ACTION.TEARDOWN, ok });
}

/**
 * Coordinates universal registration and tab/frame lifecycle.
 */
export class DocumentActivationCoordinator {
    /**
     * Monotonic intent token used to recognize registration writes that settle late.
     */
    private registrationGeneration = 0;

    /**
     * Latest desired universal registration state.
     */
    private registrationEnabled = false;

    /**
     * Whether another registration convergence pass is required.
     */
    private registrationRepairRequested = false;

    /**
     * Shared background repair flight for successful stale writes.
     */
    private registrationRepairFlight: Promise<void> | undefined;

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
     * Requests a convergence pass after an older timed-out registration write succeeds.
     *
     * @param completedGeneration - Intent generation owning the late browser write.
     */
    private requestRegistrationRepair(completedGeneration: number): void {
        if (completedGeneration === this.registrationGeneration) {
            return;
        }
        this.registrationRepairRequested = true;
        this.startRegistrationRepair();
    }

    /**
     * Starts one shared repair drain without delaying application responses.
     */
    private startRegistrationRepair(): void {
        if (this.registrationRepairFlight) {
            return;
        }
        this.registrationRepairFlight = this.drainRegistrationRepairs().finally(() => {
            this.registrationRepairFlight = undefined;
            if (this.registrationRepairRequested) {
                this.startRegistrationRepair();
            }
        });
    }

    /**
     * Reconciles the latest desired registration state after stale writes settle.
     */
    private async drainRegistrationRepairs(): Promise<void> {
        while (this.registrationRepairRequested) {
            this.registrationRepairRequested = false;
            const generation = this.registrationGeneration;
            await registration(
                this.input.scripting,
                this.registrationEnabled,
                [],
                () => {
                    this.requestRegistrationRepair(generation);
                },
            );
        }
    }

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
        this.registrationEnabled = enabled;
        const registrationGeneration = ++this.registrationGeneration;
        const registered = await registration(
            this.input.scripting,
            enabled,
            failures,
            () => {
                this.requestRegistrationRepair(registrationGeneration);
            },
        );
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
                await teardown(
                    tab,
                    url.hostname,
                    input.revision,
                    this.input.tabs,
                    failures,
                    records,
                );
                return;
            }
            const siteEnabled = isSiteEnabled(input.sitePreferences ?? {}, url.hostname);
            await refresh(
                tab,
                url.hostname,
                siteEnabled,
                input.revision,
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
