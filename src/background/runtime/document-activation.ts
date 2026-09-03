/**
 * Reconciles one universal document runtime across HTTP(S) tabs and frames.
 *
 * @file Chrome scripting and tab reconciliation for the document runtime.
 */
import {
    CONTENT_SCRIPT_FILE,
    FACEBOOK_PAYLOAD_BRIDGE_SCRIPT_FILE,
} from "../../shared/extension-files";
import { HTTP_MATCH_PATTERNS, parseHttpUrl } from "../../shared/url/http";
import { isFacebookUrl } from "../../shared/url/facebook";
import {
    DEFAULT_SITE_SCOPE,
    isSiteProcessingEnabled,
    type SiteScopePolicy,
} from "../../shared/settings/site-scope";
import {
    isDocumentPolicyAcknowledgement,
    RECONCILE_DOCUMENT_POLICY_MESSAGE,
    type ReconcileDocumentPolicyMessage,
} from "../../shared/messaging/document-messages";
import type { RuntimeFrame, RuntimeTab, TabsRuntime } from "./tabs";
import { SCRIPT_EXECUTION_WORLD, type ScriptingRuntime } from "./scripting";
import {
    DOCUMENT_RUNTIME_REGISTRATIONS,
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
 * Outcome retained for one independently reconciled registration.
 */
export interface RegistrationResult {
    /**
     * Stable browser registration identifier.
     */
    readonly id: string;

    /**
     * Operation outcome for this registration only.
     */
    readonly outcome: RegistrationOutcome;
}

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

        /**
         * Registration whose operation failed, when the failure was registration-specific.
         */
        readonly registrationId?: string;
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
     * Independent outcomes for the universal runtime and optional site bridges.
     */
    readonly registrations: readonly RegistrationResult[];

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
     * Active scope mode and hostname lists.
     */
    readonly siteScope?: SiteScopePolicy;

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
 * Reconciles one registration without coupling its outcome to sibling registrations.
 *
 * @param scripting - Scripting API boundary.
 * @param expected - Canonical registration to reconcile.
 * @param enabled - Whether global processing is enabled.
 * @param failures - Failure collection to append to.
 * @param onLateWrite - Optional convergence request after a timed-out write succeeds.
 * @returns - Registration operation outcome.
 */
async function registration(
    scripting: ScriptingRuntime,
    expected: (typeof DOCUMENT_RUNTIME_REGISTRATIONS)[number],
    enabled: boolean,
    failures: ReconcileFailure[],
    onLateWrite?: () => void,
): Promise<RegistrationOutcome> {
    const inspected = await settleBrowserOperation(
        () => scripting.getRegisteredContentScripts({
            ids: [expected.id],
        }),
    );
    if (!inspected.ok) {
        failures.push({
            scope: RECONCILE_FAILURE_SCOPE.REGISTRATION,
            operation: REGISTRATION_OPERATION.GET,
            registrationId: expected.id,
        });
        return REGISTRATION_OUTCOME.FAILED;
    }
    const found = inspected.value.find((entry) => entry.id === expected.id);
    if (!enabled) {
        if (!found) {
            return REGISTRATION_OUTCOME.UNCHANGED;
        }
        const removed = await settleRegistrationWrite(
            () => scripting.unregisterContentScripts({ ids: [expected.id] }),
            onLateWrite,
        );
        if (removed) {
            return REGISTRATION_OUTCOME.UNREGISTERED;
        }
        failures.push({
            scope: RECONCILE_FAILURE_SCOPE.REGISTRATION,
            operation: REGISTRATION_OPERATION.UNREGISTER,
            registrationId: expected.id,
        });
        return REGISTRATION_OUTCOME.FAILED;
    }
    if (found && registrationMatches(found, expected)) {
        return REGISTRATION_OUTCOME.UNCHANGED;
    }
    const operation = found
        ? REGISTRATION_OPERATION.UPDATE
        : REGISTRATION_OPERATION.REGISTER;
    const written = await settleRegistrationWrite(
        () => found
            ? scripting.updateContentScripts([{ ...expected }])
            : scripting.registerContentScripts([{ ...expected }]),
        onLateWrite,
    );
    if (written) {
        return found
            ? REGISTRATION_OUTCOME.UPDATED
            : REGISTRATION_OUTCOME.REGISTERED;
    }
    failures.push({
        scope: RECONCILE_FAILURE_SCOPE.REGISTRATION,
        operation,
        registrationId: expected.id,
    });
    return REGISTRATION_OUTCOME.FAILED;
}

/**
 * Derives the legacy aggregate registration outcome from independent results.
 *
 * @param results - Per-registration outcomes from the current pass.
 * @param enabled - Whether registrations were being installed or removed.
 * @returns - Aggregate outcome retained for existing projections.
 */
function aggregateRegistrationOutcome(
    results: readonly RegistrationResult[],
    enabled: boolean,
): RegistrationOutcome {
    if (results.some(({ outcome }) => outcome === REGISTRATION_OUTCOME.FAILED)) {
        return REGISTRATION_OUTCOME.FAILED;
    }
    if (enabled) {
        if (results.some(({ outcome }) => outcome === REGISTRATION_OUTCOME.UPDATED)) {
            return REGISTRATION_OUTCOME.UPDATED;
        }
        if (results.some(({ outcome }) => outcome === REGISTRATION_OUTCOME.REGISTERED)) {
            return REGISTRATION_OUTCOME.REGISTERED;
        }
    } else if (results.some(({ outcome }) => outcome === REGISTRATION_OUTCOME.UNREGISTERED)) {
        return REGISTRATION_OUTCOME.UNREGISTERED;
    }
    return REGISTRATION_OUTCOME.UNCHANGED;
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
        && isDocumentPolicyAcknowledgement(result.value, message.revision);
}

/**
 * Enumerates reachable HTTP(S) frames within the shared browser-operation deadline.
 *
 * @param tabs - Tabs and frame browser boundary.
 * @param tabId - Tab whose frames are requested.
 * @returns - Distinct reachable frames, or null when enumeration fails.
 */
async function enumerateFrames(
    tabs: TabsRuntime,
    tabId: number,
): Promise<readonly RuntimeFrame[] | null> {
    const frames = await settleBrowserOperation(() => tabs.getAllFrames(tabId));
    if (!frames.ok) {
        return null;
    }
    const seen = new Set<number>();
    return frames.value.filter((frame) => {
        if (seen.has(frame.frameId)) {
            return false;
        }
        seen.add(frame.frameId);
        return true;
    });
}

/**
 * Ensures the inert Facebook main-world bridge in every reachable Facebook frame.
 *
 * @param scripting - Scripting API boundary.
 * @param tabId - Tab whose Facebook frames receive the bridge.
 * @param enabled - Whether the top-level site's effective policy is enabled.
 * @param frames - Reachable frames, or null when enumeration failed.
 * @returns - Whether every required bridge injection completed.
 */
async function ensureFacebookBridge(
    scripting: ScriptingRuntime,
    tabId: number,
    enabled: boolean,
    frames: readonly RuntimeFrame[] | null,
): Promise<boolean> {
    if (!enabled) {
        return true;
    }
    if (frames === null) {
        return false;
    }
    const facebookFrameIds = frames.flatMap((frame) => {
        const url = parseHttpUrl(frame.url);
        return url && isFacebookUrl(url) ? [frame.frameId] : [];
    });
    if (facebookFrameIds.length === 0) {
        return true;
    }
    const injected = await settleBrowserOperation(() => scripting.executeScript({
        target: { tabId, frameIds: facebookFrameIds },
        files: [FACEBOOK_PAYLOAD_BRIDGE_SCRIPT_FILE],
        world: SCRIPT_EXECUTION_WORLD.MAIN,
    }));
    if (!injected.ok) {
        return false;
    }
    const injectedFrameIds = new Set(injected.value.map((result) => result.frameId));
    return injectedFrameIds.size === facebookFrameIds.length
        && facebookFrameIds.every((frameId) => injectedFrameIds.has(frameId));
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
    const initialFrames = enumerateFrames(tabs, tab.id);
    const [initialPolicy, ensured, bridgeReady] = await Promise.all([
        initialFrames.then((frames) => deliverPolicyToFrames(
            tabs,
            tab.id,
            frames?.map((frame) => frame.frameId) ?? [],
            message,
        )),
        settleBrowserOperation(
            () => scripting.executeScript({
                target: { tabId: tab.id, allFrames: true },
                files: [CONTENT_SCRIPT_FILE],
            }),
        ),
        initialFrames.then((frames) => ensureFacebookBridge(
            scripting,
            tab.id,
            enabled,
            frames,
        )),
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
    const ok = runtimeEnsured && policyOk && bridgeReady;
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
    const frames = await enumerateFrames(tabs, tab.id);
    const frameIds = frames?.map((frame) => frame.frameId) ?? [];
    const acknowledgements = await deliverPolicyToFrames(tabs, tab.id, frameIds, {
        type: RECONCILE_DOCUMENT_POLICY_MESSAGE,
        revision,
        enabled: false,
    });
    const ok = frames !== null && frameIds.length > 0 && frameIds.every(
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
            await Promise.all(DOCUMENT_RUNTIME_REGISTRATIONS.map((expected) =>
                registration(
                    this.input.scripting,
                    expected,
                    this.registrationEnabled,
                    [],
                    () => {
                        this.requestRegistrationRepair(generation);
                    },
                )));
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
        const registrations = await Promise.all(
            DOCUMENT_RUNTIME_REGISTRATIONS.map(async (expected) => ({
                id: expected.id,
                outcome: await registration(
                    this.input.scripting,
                    expected,
                    enabled,
                    failures,
                    () => {
                        this.requestRegistrationRepair(registrationGeneration);
                    },
                ),
            })),
        );
        const registered = aggregateRegistrationOutcome(registrations, enabled);
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
            const siteEnabled = isSiteProcessingEnabled(
                input.siteScope ?? DEFAULT_SITE_SCOPE,
                url.hostname,
            );
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
            registrations,
            tabs: records,
        };
    }
}
