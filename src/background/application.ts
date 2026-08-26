/**
 * @file Background lifecycle, runtime reconciliation, and UI state management.
 */

import type { SettingsService } from "../settings/settings-service";
import { isCanonicalHostname, isSiteEnabled, type DisplaySettings, type SettingsSnapshotV5 } from "../settings/snapshot";
export type { DisplaySettings } from "../settings/snapshot";
import { createDiagnosticEvent, sanitizeDiagnosticEvent, type DiagnosticBrowserFamily, type DiagnosticEvent, type DiagnosticEventInput, type DiagnosticSender } from "../diagnostics/events";
import type { DiagnosticJournal } from "../diagnostics/journal";
import type { RuntimeAdapterDefinition, ActivationReconcileResult, ActivationMode, ReconcileFailure } from "../runtime/adapter-activation";
import type { ClearDiagnosticsResponse, DiagnosticsEnvironment, GetDiagnosticsSnapshotResponse } from "./messages";
import type { TabsRuntime, RuntimeTab } from "../runtime/tabs";
import {
    DOCUMENT_STATUS_MESSAGE,
    isDocumentStatusResponse
} from "../runtime/messages";
import { UPDATE_DEBUG_POLICY_MESSAGE, UPDATE_PRESENTATION_MESSAGE, isDebugPolicyUpdateAcknowledgement, isPresentationUpdateAcknowledgement } from "../runtime/messages";
import { isRuntimeTab } from "../runtime/tabs";

/**
 * Availability and activation status presented for the active tab.
 */
export type PopupStatus =
  | "active"
  | "global-disabled"
  | "site-disabled"
  | "inaccessible"
  | "runtime-failed"
  | "no-rules"
  | "settings-unavailable";

/**
 * Failure that prevents the popup from reporting normal active-tab status.
 */
export type PopupFailure =
  | "current-tab-query"
  | "registration"
  | "matching-tabs-query"
  | "current-tab-inject"
  | "current-tab-teardown"
  | "document-status"
  | "settings-load"
  | "fail-closed-cleanup";

/**
 * Popup view of settings and runtime state for the active tab.
 */
export type PopupState =
  | {
      readonly availability: "ready";
      readonly revision: number;
      readonly globalEnabled: boolean;
      readonly hostname: string | null;
      readonly siteEnabled: boolean | null;
      readonly hasAdapter: boolean;
      readonly status: Exclude<PopupStatus, "settings-unavailable">;
      readonly failure?: Exclude<PopupFailure, "settings-load" | "fail-closed-cleanup">;
  }
  | {
      readonly availability: "unavailable";
      readonly revision: null;
      readonly globalEnabled: null;
      readonly hostname: string | null;
      readonly siteEnabled: null;
      readonly hasAdapter: false;
      readonly status: "settings-unavailable" | "runtime-failed";
      readonly failure: "settings-load" | "fail-closed-cleanup";
  };

/**
 * Result of changing the global activation setting, including the updated popup state.
 */
export type SetGlobalEnabledResponse =
  | { readonly ok: true; readonly acceptedRevision: number; readonly state: PopupState }
  | { readonly ok: false; readonly error: "save-failed" | "settings-unavailable"; readonly state: PopupState };

/**
 * A hostname shown in the site preferences list.
 */
export interface SiteListEntry {
    /**
     * Hostname whose preference is shown.
     */
    readonly hostname: string;

    /**
     * Whether timestamp rendering is enabled for this hostname.
     */
    readonly enabled: boolean;

    /**
     * Whether a runtime adapter supports this hostname.
     */
    readonly hasAdapter: boolean;
}

/**
 * Site-preferences view returned to the extension UI.
 */
export type SitesState =
  | {
      readonly availability: "ready";
      readonly revision: number;
      readonly globalEnabled: boolean;
      readonly sites: readonly SiteListEntry[];
  }
  | {
      readonly availability: "unavailable";
      readonly revision: null;
      readonly globalEnabled: null;
      readonly sites: readonly [];
      readonly failure: "settings-load" | "fail-closed-cleanup";
  };

/**
 * Result of changing one site's activation setting and refreshing its source surface.
 */
export type SetSiteEnabledResponse =
  | { readonly ok: true; readonly acceptedRevision: number; readonly surface: "popup"; readonly state: PopupState }
  | { readonly ok: true; readonly acceptedRevision: number; readonly surface: "sites"; readonly state: SitesState }
  | { readonly ok: false; readonly error: "save-failed" | "invalid-hostname" | "settings-unavailable"; readonly surface: "popup"; readonly state: PopupState }
  | { readonly ok: false; readonly error: "save-failed" | "invalid-hostname" | "settings-unavailable"; readonly surface: "sites"; readonly state: SitesState };

/**
 * Result of restoring all settings to their defaults.
 */
export type ResetAllSettingsResponse =
  | { readonly ok: true; readonly acceptedRevision: number; readonly state: Extract<SitesState, { readonly availability: "ready" }> }
  | { readonly ok: false; readonly error: "save-failed" | "settings-unavailable"; readonly state: SitesState };

/**
 * Current display configuration and its time-zone availability.
 */
export type DisplayState =
  | { readonly availability: "ready"; readonly revision: number; readonly display: DisplaySettings; readonly debugEnabled: boolean; readonly error?: "unavailable-time-zone" }
  | { readonly availability: "unavailable"; readonly revision: null; readonly display: null; readonly failure: "settings-load" | "fail-closed-cleanup" };

/**
 * Current diagnostic logging setting.
 */
export type DebugState =
  | { readonly availability: "ready"; readonly revision: number; readonly enabled: boolean }
  | { readonly availability: "unavailable"; readonly revision: null; readonly enabled: null; readonly failure: "settings-load" | "fail-closed-cleanup" };

/**
 * Result of changing diagnostic logging, including tabs that could not be updated.
 */
export type SetDebugEnabledResponse =
  | { readonly ok: true; readonly acceptedRevision: number; readonly state: DebugState; readonly refreshFailures?: readonly DebugRefreshFailure[] }
  | { readonly ok: false; readonly error: "save-failed" | "settings-unavailable"; readonly state: DebugState };

/**
 * A tab that did not acknowledge a diagnostic-policy update.
 */
export interface DebugRefreshFailure {
    /**
     * Adapter hostname whose matching tab could not be updated.
     */
    readonly hostname: string;

    /**
     * Identifier of the tab that failed, when tab discovery succeeded.
     */
    readonly tabId?: number;

    /**
     * Whether tab discovery or the per-tab message failed.
     */
    readonly reason: "matching-tabs-query" | "tab-update";
}

/**
 * A tab that did not acknowledge a display-settings update.
 */
export interface DisplayRefreshFailure {
    /**
     * Adapter hostname whose matching tab could not be updated.
     */
    readonly hostname: string;

    /**
     * Identifier of the tab that failed, when tab discovery succeeded.
     */
    readonly tabId?: number;

    /**
     * Whether tab discovery or the per-tab message failed.
     */
    readonly reason: "matching-tabs-query" | "tab-update";
}

/**
 * Result of changing display settings, including tabs that could not be refreshed.
 */
export type SetDisplaySettingsResponse =
  | { readonly ok: true; readonly acceptedRevision: number; readonly state: DisplayState; readonly refreshFailures: readonly DisplayRefreshFailure[] }
  | { readonly ok: false; readonly error: "invalid-format" | "invalid-time-zone" | "invalid-display-settings" | "save-failed" | "settings-unavailable"; readonly state: DisplayState };

/**
 * Lifecycle state of the background application.
 */
export type ApplicationPhase = "cold" | "initializing" | "ready" | "failed-closed";

/**
 * Reconciles registered scripts and matching tabs with the current settings.
 */
export interface ActivationCoordinator {
    /**
     * Applies an activation policy and reports registration and tab failures.
     */
    reconcile(input: {
        /**
         * Settings revision associated with this reconciliation, or null while failing closed.
         */
        readonly revision: number | null;

        /**
         * Reason for the reconciliation run.
         */
        readonly mode: ActivationMode;

        /**
         * Global activation policy to apply.
         */
        readonly policy: "enabled" | "disabled" | "unknown";

        /**
         * Per-host activation overrides used by adapters.
         */
        readonly sitePreferences?: Readonly<Record<string, boolean>>;

        /**
         * Limits reconciliation to adapters for these hostnames when provided.
         */
        readonly affectedHostnames?: readonly string[];
    }): Promise<ActivationReconcileResult>;
}

/**
 * Dependencies used by the background application.
 */
export interface BackgroundApplicationOptions {
    /**
     * Service that loads and persists extension settings.
     */
    readonly settings: SettingsService;

    /**
     * Runtime registration and tab-reconciliation implementation.
     */
    readonly coordinator: ActivationCoordinator;

    /**
     * Browser tab query and messaging API.
     */
    readonly tabs: TabsRuntime;

    /**
     * Runtime adapters that define supported sites and scripts.
     */
    readonly adapters: readonly RuntimeAdapterDefinition[];

    /**
     * Optional persistent diagnostic-event journal.
     */
    readonly journal?: DiagnosticJournal;

    /**
     * Optional browser and extension metadata added to diagnostic events.
     */
    readonly diagnosticEnvironment?: {
        /**
         * Extension version recorded with trusted diagnostic events.
         */
        readonly extensionVersion?: string;

        /**
         * Browser family recorded with trusted diagnostic events.
         */
        readonly browserFamily: DiagnosticBrowserFamily;
    };
}

/**
 * Event that triggered background initialization or reconciliation.
 */
export type LifecycleReason = "startup" | "installed" | "updated" | "cold-worker";

/**
 * Maps a reconcile failure for an adapter and tab to the corresponding popup failure.
 */
function matchingTabFailure(
    failures: readonly ReconcileFailure[],
    adapterId: string,
    tabId: number
): Exclude<PopupFailure, "settings-load" | "fail-closed-cleanup"> | undefined {
    for (const failure of failures) {
        if (failure.scope === "registration" && failure.adapterId === adapterId) {
            return "registration";
        }
        if (failure.scope === "matching-tabs-query" && failure.adapterId === adapterId) {
            return "matching-tabs-query";
        }
        if (failure.scope === "tab" && failure.adapterId === adapterId && failure.tabId === tabId) {
            if (failure.action === "inject") {
                return "current-tab-inject";
            }
            if (failure.action === "teardown") {
                return "current-tab-teardown";
            }
            return "document-status";
        }
    }
    return undefined;
}

/**
 * Parses a tab URL, returning null when it is absent or invalid.
 */
function urlFromTab(tab: RuntimeTab | undefined): URL | null {
    if (!tab?.url) {
        return null;
    }
    try {
        return new URL(tab.url);
    } catch {
        return null;
    }
}

/**
 * Checks whether an adapter is registered for a hostname.
 */
function adapterHostnameMatches(
    adapter: RuntimeAdapterDefinition,
    hostname: string
): boolean {
    return adapter.hostname === hostname;
}

/**
 * Checks whether a reconcile failure belongs to an adapter.
 */
function failureBelongsToAdapter(failure: ReconcileFailure, adapterId: string): boolean {
    return failure.adapterId === adapterId;
}

/**
 * Coordinates settings, runtime activation, and background-facing UI state.
 */
export class BackgroundApplication {
    /**
     * Persistence boundary retained for the application's lifetime.
     */
    private readonly settings: SettingsService;

    /**
     * Runtime reconciler owned by this application instance.
     */
    private readonly coordinator: ActivationCoordinator;

    /**
     * Browser tab boundary used to project and refresh active-tab state.
     */
    private readonly tabs: TabsRuntime;

    /**
     * Immutable supported-site catalog used throughout reconciliation.
     */
    private readonly adapters: readonly RuntimeAdapterDefinition[];

    /**
     * Optional durable sink for diagnostic events emitted by this instance.
     */
    private readonly journal: DiagnosticJournal | undefined;

    /**
     * Immutable metadata attached when serializing trusted diagnostic events.
     */
    private readonly diagnosticEnvironment: BackgroundApplicationOptions["diagnosticEnvironment"];

    /**
     * Lifecycle phase published to callers as initialization progresses.
     */
    private phaseValue: ApplicationPhase = "cold";

    /**
     * Last successfully loaded settings, held as the authority for runtime decisions.
     */
    private snapshot: SettingsSnapshotV5 | undefined;

    /**
     * Failure retained while the application remains in its fail-closed lifecycle.
     */
    private failure: "settings-load" | "fail-closed-cleanup" | undefined;

    /**
     * Most recent reconciliation, retained to merge scoped results and report failures.
     */
    private lastReconcile: ActivationReconcileResult | undefined;

    /**
     * Lazily seeded popup projection reused until settings or reconciliation change it.
     */
    private popupStateCache: PopupState | undefined;

    /**
     * Tab identity paired with the cached popup projection for failure matching.
     */
    private popupTabId: number | undefined;

    /**
     * Shared initialization or recovery promise that coalesces concurrent readiness requests.
     */
    private readinessFlight: Promise<void> | undefined;

    /**
     * Promise chain that serializes all state-changing background operations.
     */
    private transactionTail: Promise<void> = Promise.resolve();

    /**
     * Lifecycle triggers accumulated until one activation sweep consumes them.
     */
    private readonly lifecycleReasons = new Set<LifecycleReason>();

    /**
     * Shared drain promise that prevents duplicate lifecycle sweeps.
     */
    private lifecycleFlight: Promise<void> | undefined;

    /**
     * Creates an application with its runtime and settings dependencies.
     */
    public constructor(options: BackgroundApplicationOptions) {
        this.settings = options.settings;
        this.coordinator = options.coordinator;
        this.tabs = options.tabs;
        this.adapters = options.adapters;
        this.journal = options.journal;
        this.diagnosticEnvironment = options.diagnosticEnvironment;
    }

    /**
     * Current lifecycle phase.
     */
    public get phase(): ApplicationPhase {
        return this.phaseValue;
    }

    /**
     * Most recently loaded settings snapshot, if settings are available.
     */
    public get currentSnapshot(): SettingsSnapshotV5 | undefined {
        return this.snapshot;
    }

    /**
     * Most recent adapter reconciliation result, if one has completed.
     */
    public get reconcileResult(): ActivationReconcileResult | undefined {
        return this.lastReconcile;
    }

    /**
     * Serializes a state-changing operation after earlier background work.
     */
    private enqueue<T>(operation: () => Promise<T>): Promise<T> {
        const run = this.transactionTail.then(operation);
        this.transactionTail = run.then(() => undefined, () => undefined);
        return run;
    }

    /**
     * Reconciles runtime adapters and caches the newest non-stale result.
     */
    private async performReconcile(
        mode: ActivationMode,
        policy: "enabled" | "disabled" | "unknown",
        revision: number | null,
        sitePreferences: Readonly<Record<string, boolean>> = this.snapshot?.sitePreferences ?? {},
        affectedHostnames?: readonly string[]
    ): Promise<ActivationReconcileResult> {
        let result: ActivationReconcileResult;
        try {
            result = await this.coordinator.reconcile({ revision, mode, policy, sitePreferences, ...(affectedHostnames === undefined ? {} : { affectedHostnames }) });
        } catch {
            result = {
                revision,
                mode,
                policy,
                failures: this.adapters
                    .filter((adapter) => affectedHostnames === undefined || affectedHostnames.includes(adapter.hostname))
                    .map((adapter) => ({ scope: "registration" as const, adapterId: adapter.id, operation: "get" as const })),
                registration: {},
                tabs: []
            };
        }
        // Scoped site reconciliation replaces only the selected adapters. Results
        // for unrelated adapters remain authoritative until they are reconciled.
        if (affectedHostnames !== undefined && this.lastReconcile) {
            const affectedIds = new Set(this.adapters.filter((adapter) => affectedHostnames.includes(adapter.hostname)).map((adapter) => adapter.id));
            const failures = [
                ...this.lastReconcile.failures.filter((failure) => !affectedIds.has(failure.adapterId)),
                ...result.failures
            ];
            const registration: Record<string, "unchanged" | "registered" | "updated" | "unregistered" | "failed"> = {};
            for (const [id, value] of Object.entries(this.lastReconcile.registration)) {
                if (!affectedIds.has(id)) {
                    registration[id] = value;
                }
            }
            for (const [id, value] of Object.entries(result.registration)) {
                registration[id] = value;
            }
            const tabs = [
                ...this.lastReconcile.tabs.filter((record) => !affectedIds.has(record.adapterId)),
                ...result.tabs
            ];
            result = { ...result, failures, registration, tabs };
        }
        // Calls are serialized, but retain the revision guard for injected/custom
        // coordinators that resolve after a newer result was published.
        if (!this.lastReconcile || result.revision === null || this.lastReconcile.revision === null || result.revision >= this.lastReconcile.revision) {
            this.lastReconcile = result;
        }
        this.refreshCachedPopupProjection();
        return result;
    }

    /**
     * Updates the cached reconciliation revision after a no-op settings write.
     */
    private advanceReconcileRevision(revision: number): void {
        if (!this.lastReconcile) {
            return;
        }
        this.lastReconcile = { ...this.lastReconcile, revision };
    }

    /**
     * Loads settings and reconciles adapters; enters failed-closed mode when loading fails.
     */
    private async initialize(): Promise<void> {
        this.phaseValue = "initializing";
        const loaded = await this.settings.load();
        if (!loaded.ok) {
            this.snapshot = undefined;
            this.failure = "settings-load";
            try {
                const cleanup = await this.performReconcile("failed-closed", "unknown", null);
                if (cleanup.failures.length > 0) {
                    this.failure = "fail-closed-cleanup";
                }
            } catch {
                this.failure = "fail-closed-cleanup";
            }
            this.phaseValue = "failed-closed";
            return;
        }
        this.snapshot = loaded.snapshot;
        this.failure = undefined;
        if (loaded.snapshot.debugEnabled) {
            try {
                await this.journal?.setEnabled(true);
            } catch { /* diagnostics never block activation */ }
        }
        const mode: ActivationMode = this.lifecycleReasons.size > 0 ? "activation-sweep" : "cold-worker";
        try {
            await this.performReconcile(mode, loaded.snapshot.globalEnabled ? "enabled" : "disabled", loaded.snapshot.revision, loaded.snapshot.sitePreferences);
            this.lifecycleReasons.clear();
            this.phaseValue = "ready";
            await this.seedPopupProjection();
            this.logBackgroundEvent({ category: "lifecycle", count: 1 });
        } catch {
            // A coordinator failure is represented as a runtime result when possible;
            // settings remain authoritative and can be retried by an unchanged set.
            this.lastReconcile = {
                revision: loaded.snapshot.revision,
                mode,
                policy: loaded.snapshot.globalEnabled ? "enabled" : "disabled",
                failures: [],
                registration: {},
                tabs: []
            };
            this.lifecycleReasons.clear();
            this.phaseValue = "ready";
            this.logBackgroundEvent({ category: "error", reason: "processing-failed", count: 1 });
        }
    }

    /**
     * Ensures settings are loaded and runtime activation is reconciled for a lifecycle reason.
     */
    public ensureReady(reason: LifecycleReason = "cold-worker"): Promise<void> {
        if (reason !== "cold-worker") {
            this.lifecycleReasons.add(reason);
        }
        if (this.phaseValue === "ready") {
            return this.requestLifecycleDrain();
        }
        if (this.phaseValue === "failed-closed" && this.readinessFlight === undefined) {
            // Retry cleanup/read only; a failed-closed worker never silently adopts
            // the enabled default after an unreadable snapshot.
            this.readinessFlight = this.enqueue(async () => {
                const loaded = await this.settings.load();
                if (!loaded.ok || loaded.source === "default") {
                    try {
                        const cleanup = await this.performReconcile("failed-closed", "unknown", null);
                        this.failure = cleanup.failures.length > 0 ? "fail-closed-cleanup" : "settings-load";
                    } catch {
                        this.failure = "fail-closed-cleanup";
                    }
                    return;
                }
                this.snapshot = loaded.snapshot;
                this.failure = undefined;
                if (loaded.snapshot.debugEnabled) {
                    try {
                        await this.journal?.setEnabled(true);
                    } catch { /* diagnostics never block recovery */ }
                }
                const result = await this.performReconcile("activation-sweep", loaded.snapshot.globalEnabled ? "enabled" : "disabled", loaded.snapshot.revision, loaded.snapshot.sitePreferences);
                this.phaseValue = "ready";
                await this.seedPopupProjection();
                if (result.failures.length > 0) {
                    this.failure = undefined;
                }
            }).finally(() => {
                this.readinessFlight = undefined;
            });
            return this.readinessFlight;
        }
        if (this.readinessFlight) {
            return this.readinessFlight;
        }
        this.readinessFlight = this.enqueue(() => this.initialize()).finally(() => {
            this.readinessFlight = undefined;
        });
        return this.readinessFlight;
    }

    /**
     * Drains queued lifecycle events through one activation-sweep reconciliation.
     */
    private requestLifecycleDrain(): Promise<void> {
        if (this.lifecycleReasons.size === 0) {
            return Promise.resolve();
        }
        if (this.lifecycleFlight) {
            return this.lifecycleFlight;
        }
        this.lifecycleFlight = this.enqueue(async () => {
            while (this.lifecycleReasons.size > 0) {
                if (this.phaseValue !== "ready" || !this.snapshot) {
                    return;
                }
                await this.performReconcile("activation-sweep", this.snapshot.globalEnabled ? "enabled" : "disabled", this.snapshot.revision, this.snapshot.sitePreferences);
                this.lifecycleReasons.clear();
                this.logBackgroundEvent({ category: "lifecycle", count: 1 });
            }
        }).finally(() => {
            this.lifecycleFlight = undefined;
        });
        return this.lifecycleFlight;
    }

    /**
     * Queues a browser lifecycle event and ensures it is reconciled.
     */
    public requestLifecycle(reason: Exclude<LifecycleReason, "cold-worker">): Promise<void> {
        this.lifecycleReasons.add(reason);
        return this.ensureReady(reason);
    }

    /**
     * Queries the active tab and distinguishes lookup failures from an empty result.
     */
    private async activeTab(): Promise<{ readonly tab: RuntimeTab | undefined; readonly error: boolean }> {
        try {
            const tabs = await this.tabs.query({ active: true, currentWindow: true });
            const tab = tabs.find(isRuntimeTab);
            return { tab, error: false };
        } catch {
            return { tab: undefined, error: true };
        }
    }

    /**
     * Initializes the popup-state cache once the application is ready.
     */
    private async seedPopupProjection(): Promise<void> {
        if (this.popupStateCache || this.phaseValue !== "ready" || !this.snapshot) {
            return;
        }
        const state = await this.derivePopupState();
        this.popupStateCache = state;
    }

    /**
     * Refreshes cached popup state from settings and the latest reconciliation failures.
     */
    private refreshCachedPopupProjection(): void {
        const cached = this.popupStateCache;
        if (!cached || cached.availability !== "ready" || !this.snapshot) {
            return;
        }
        const hostname = cached.hostname;
        if (hostname === null) {
            this.popupStateCache = {
                ...cached,
                revision: this.snapshot.revision,
                globalEnabled: this.snapshot.globalEnabled,
                siteEnabled: null,
                hasAdapter: false
            };
            return;
        }
        const adapter = this.adapters.find((candidate) => candidate.hostname === hostname);
        const siteEnabled = isSiteEnabled(this.snapshot.sitePreferences, hostname);
        const relevantFailure = adapter && this.popupTabId !== undefined
            ? matchingTabFailure(this.lastReconcile?.failures ?? [], adapter.id, this.popupTabId)
            : undefined;
        let status: Exclude<PopupStatus, "settings-unavailable"> = cached.status;
        let failure: Exclude<PopupFailure, "settings-load" | "fail-closed-cleanup"> | undefined = cached.failure;
        if (relevantFailure) {
            status = "runtime-failed";
            failure = relevantFailure;
        } else if (!this.snapshot.globalEnabled) {
            status = "global-disabled";
            failure = undefined;
        } else if (!siteEnabled) {
            status = "site-disabled";
            failure = undefined;
        } else if (!adapter) {
            status = "no-rules";
            failure = undefined;
        } else if (status === "global-disabled" || status === "site-disabled" || status === "no-rules") {
            // A successful activation reconciliation is sufficient to carry the
            // previously verified host back to its normal active projection without
            // issuing a status probe during an unrelated invalid intent.
            status = "active";
            failure = undefined;
        }
        const next: Extract<PopupState, { readonly availability: "ready" }> = {
            availability: "ready",
            revision: this.snapshot.revision,
            globalEnabled: this.snapshot.globalEnabled,
            hostname,
            siteEnabled,
            hasAdapter: adapter !== undefined,
            status,
            ...(failure === undefined ? {} : { failure })
        };
        this.popupStateCache = next;
    }

    /**
     * Builds the popup state returned while settings cannot be used.
     */
    private unavailableState(): PopupState {
        return {
            availability: "unavailable",
            revision: null,
            globalEnabled: null,
            hostname: null,
            siteEnabled: null,
            hasAdapter: false,
            status: this.failure === "fail-closed-cleanup" ? "runtime-failed" : "settings-unavailable",
            failure: this.failure ?? "settings-load"
        };
    }

    /**
     * Builds the site-list state returned while settings cannot be used.
     */
    private unavailableSitesState(): SitesState {
        return {
            availability: "unavailable",
            revision: null,
            globalEnabled: null,
            sites: [],
            failure: this.failure ?? "settings-load"
        };
    }

    /**
     * Finds the adapter that accepts a page URL.
     */
    private adapterForUrl(url: URL): RuntimeAdapterDefinition | undefined {
        return this.adapters.find((candidate) => candidate.matches(url));
    }

    /**
     * Returns the effective activation preference for a hostname.
     */
    private siteEnabled(hostname: string): boolean {
        return isSiteEnabled(this.snapshot?.sitePreferences ?? {}, hostname);
    }

    /**
     * Derives popup state from the active tab, settings, and document runtime status.
     */
    private async derivePopupState(): Promise<PopupState> {
        if (this.phaseValue !== "ready" || !this.snapshot) {
            return this.unavailableState();
        }
        const current = await this.activeTab();
        this.popupTabId = current.tab?.id;
        if (current.error) {
            return { availability: "ready", revision: this.snapshot.revision, globalEnabled: this.snapshot.globalEnabled, hostname: null, siteEnabled: null, hasAdapter: false, status: "runtime-failed", failure: "current-tab-query" };
        }
        const url = urlFromTab(current.tab);
        if (!url || (url.protocol !== "http:" && url.protocol !== "https:") || !url.hostname) {
            return { availability: "ready", revision: this.snapshot.revision, globalEnabled: this.snapshot.globalEnabled, hostname: null, siteEnabled: null, hasAdapter: false, status: "inaccessible" };
        }
        const hostname = url.hostname;
        const adapter = this.adapterForUrl(url);
        const siteEnabled = this.siteEnabled(hostname);
        const tabId = current.tab?.id;
        if (adapter) {
            const failure = tabId === undefined ? "current-tab-query" : matchingTabFailure(this.lastReconcile?.failures ?? [], adapter.id, tabId);
            if (failure) {
                return { availability: "ready", revision: this.snapshot.revision, globalEnabled: this.snapshot.globalEnabled, hostname, siteEnabled, hasAdapter: true, status: "runtime-failed", failure };
            }
        }
        if (!this.snapshot.globalEnabled) {
            return { availability: "ready", revision: this.snapshot.revision, globalEnabled: false, hostname, siteEnabled, hasAdapter: adapter !== undefined, status: "global-disabled" };
        }
        if (!siteEnabled) {
            return { availability: "ready", revision: this.snapshot.revision, globalEnabled: true, hostname, siteEnabled: false, hasAdapter: adapter !== undefined, status: "site-disabled" };
        }
        if (!adapter) {
            return { availability: "ready", revision: this.snapshot.revision, globalEnabled: true, hostname, siteEnabled: true, hasAdapter: false, status: "no-rules" };
        }
        if (tabId === undefined) {
            return { availability: "ready", revision: this.snapshot.revision, globalEnabled: true, hostname, siteEnabled: true, hasAdapter: true, status: "runtime-failed", failure: "current-tab-query" };
        }
        try {
            const response = await this.tabs.sendMessage(tabId, { type: DOCUMENT_STATUS_MESSAGE }, { frameId: 0 });
            if (!isDocumentStatusResponse(response) || (response.phase !== "waiting" && response.phase !== "active")) {
                return { availability: "ready", revision: this.snapshot.revision, globalEnabled: true, hostname, siteEnabled: true, hasAdapter: true, status: "runtime-failed", failure: "document-status" };
            }
        } catch {
            return { availability: "ready", revision: this.snapshot.revision, globalEnabled: true, hostname, siteEnabled: true, hasAdapter: true, status: "runtime-failed", failure: "document-status" };
        }
        return { availability: "ready", revision: this.snapshot.revision, globalEnabled: true, hostname, siteEnabled: true, hasAdapter: true, status: "active" };
    }

    /**
     * Builds the sorted site list from adapters and explicit preferences.
     */
    private deriveSitesState(): SitesState {
        if (this.phaseValue !== "ready" || !this.snapshot) {
            return this.unavailableSitesState();
        }
        const adapterHostnames = this.adapters.map((adapter) => adapter.hostname);
        const explicitHostnames = Object.keys(this.snapshot.sitePreferences);
        const hostnames = [...new Set([...adapterHostnames, ...explicitHostnames])].sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
        return {
            availability: "ready",
            revision: this.snapshot.revision,
            globalEnabled: this.snapshot.globalEnabled,
            sites: hostnames.map((hostname) => ({
                hostname,
                enabled: this.siteEnabled(hostname),
                hasAdapter: this.adapters.some((adapter) => adapterHostnameMatches(adapter, hostname))
            }))
        };
    }

    /**
     * Returns and caches popup state after initialization and lifecycle reconciliation.
     */
    public async getPopupState(): Promise<PopupState> {
        await this.ensureReady("cold-worker");
        await this.requestLifecycleDrain();
        return this.enqueue(async () => {
            const state = await this.derivePopupState();
            this.popupStateCache = state;
            return state;
        });
    }

    /**
     * Returns the current site-preferences state after lifecycle reconciliation.
     */
    public async getSitesState(): Promise<SitesState> {
        await this.ensureReady("cold-worker");
        await this.requestLifecycleDrain();
        return this.enqueue(() => Promise.resolve(this.deriveSitesState()));
    }

    /**
     * Builds diagnostic logging state from the current settings snapshot.
     */
    private debugState(): DebugState {
        if (this.phaseValue !== "ready" || !this.snapshot) {
            return {
                availability: "unavailable",
                revision: null,
                enabled: null,
                failure: this.failure === "fail-closed-cleanup" ? "fail-closed-cleanup" : "settings-load"
            };
        }
        return { availability: "ready", revision: this.snapshot.revision, enabled: this.snapshot.debugEnabled };
    }

    /**
     * Returns current diagnostic logging state after lifecycle reconciliation.
     */
    public async getDebugState(): Promise<DebugState> {
        await this.ensureReady("cold-worker");
        await this.requestLifecycleDrain();
        return this.enqueue(() => Promise.resolve(this.debugState()));
    }

    /**
     * Reads persisted diagnostics when diagnostic logging and its journal are available.
     */
    public async getDiagnosticsSnapshot(): Promise<GetDiagnosticsSnapshotResponse> {
        await this.ensureReady("cold-worker");
        await this.requestLifecycleDrain();
        return this.enqueue(async (): Promise<GetDiagnosticsSnapshotResponse> => {
            if (this.phaseValue !== "ready" || !this.snapshot || !this.journal) {
                return { ok: false, error: "unavailable" };
            }
            if (!this.snapshot.debugEnabled) {
                return { ok: false, error: "disabled" };
            }
            const result = await this.journal.readSnapshot();
            if (!result.ok) {
                return result;
            }
            const family = this.diagnosticEnvironment?.browserFamily;
            const browserFamily: DiagnosticBrowserFamily = family === "chromium" || family === "firefox" || family === "other" ? family : "other";
            const version = this.diagnosticEnvironment?.extensionVersion;
            const environment: DiagnosticsEnvironment = {
                browserFamily,
                ...(typeof version === "string" && /^[0-9A-Za-z][0-9A-Za-z._+-]{0,31}$/u.test(version) ? { extensionVersion: version } : {})
            };
            return { ok: true, snapshot: { entries: result.entries, environment } };
        });
    }

    /**
     * Clears persisted diagnostics when diagnostic logging and its journal are available.
     */
    public async clearDiagnostics(): Promise<ClearDiagnosticsResponse> {
        await this.ensureReady("cold-worker");
        await this.requestLifecycleDrain();
        return this.enqueue(async (): Promise<ClearDiagnosticsResponse> => {
            if (this.phaseValue !== "ready" || !this.snapshot || !this.journal) {
                return { ok: false, error: "unavailable" };
            }
            if (!this.snapshot.debugEnabled) {
                return { ok: false, error: "disabled" };
            }
            return this.journal.clearEntries();
        });
    }

    /**
     * Replaces document-supplied environment metadata with trusted background values.
     */
    private trustedDiagnosticEvent(event: DiagnosticEvent): DiagnosticEvent {
        const trusted = { ...event };
        delete trusted.adapterVersion;
        delete trusted.extensionVersion;
        delete trusted.browserFamily;
        const version = this.diagnosticEnvironment?.extensionVersion;
        if (typeof version === "string" && /^[0-9A-Za-z][0-9A-Za-z._+-]{0,31}$/u.test(version)) {
            trusted.extensionVersion = version;
        }
        const family = this.diagnosticEnvironment?.browserFamily;
        if (family === "chromium" || family === "firefox" || family === "other") {
            trusted.browserFamily = family;
        }
        return Object.freeze(trusted);
    }

    /**
     * Appends a sanitized background diagnostic event without blocking background work.
     */
    private logBackgroundEvent(input: DiagnosticEventInput): void {
        if (!this.snapshot?.debugEnabled || !this.journal) {
            return;
        }
        const hostname = this.adapters[0]?.hostname;
        if (!hostname) {
            return;
        }
        const event = sanitizeDiagnosticEvent(input, { hostname, pageCategory: "other", incognito: false });
        if (!event) {
            return;
        }
        void this.journal.append(this.trustedDiagnosticEvent(event)).catch(() => undefined);
    }

    /**
     * Validates and records a top-frame document diagnostic event for an enabled adapter.
     */
    public async recordDocumentEvent(
        input: unknown,
        sender: DiagnosticSender & { readonly frameId?: unknown }
    ): Promise<boolean> {
        if (this.phaseValue !== "ready" || !this.snapshot?.debugEnabled || !this.snapshot.globalEnabled || !this.journal) {
            return false;
        }
        if (sender.frameId !== undefined && sender.frameId !== 0) {
            return false;
        }
        const event = createDiagnosticEvent(input, sender);
        if (!event || !isSiteEnabled(this.snapshot.sitePreferences, event.hostname)) {
            return false;
        }
        if (!this.adapters.some((adapter) => adapter.hostname === event.hostname)) {
            return false;
        }
        try {
            await this.journal.append(this.trustedDiagnosticEvent(event));
        } catch { /* diagnostics never block timestamp processing */ }
        return true;
    }

    /**
     * Builds display state and flags an unavailable configured IANA time zone.
     */
    private displayState(): DisplayState {
        if (this.phaseValue !== "ready" || !this.snapshot) {
            return this.unavailableDisplayState();
        }
        const display = this.snapshot.display;
        const unavailable = display.timeZone.mode === "iana" && !this.isZoneAvailable(display.timeZone.identifier);
        return {
            availability: "ready",
            revision: this.snapshot.revision,
            display,
            debugEnabled: this.snapshot.debugEnabled,
            ...(unavailable ? { error: "unavailable-time-zone" as const } : {})
        };
    }

    /**
     * Builds display state returned while settings cannot be used.
     */
    private unavailableDisplayState(): DisplayState {
        return {
            availability: "unavailable",
            revision: null,
            display: null,
            failure: this.failure === "fail-closed-cleanup" ? "fail-closed-cleanup" : "settings-load"
        };
    }

    /**
     * Checks whether the runtime supports an IANA time-zone identifier.
     */
    private isZoneAvailable(identifier: string): boolean {
        try {
            new Intl.DateTimeFormat(undefined, { timeZone: identifier }).resolvedOptions();
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Returns current display settings after lifecycle reconciliation.
     */
    public async getDisplayState(): Promise<DisplayState> {
        await this.ensureReady("cold-worker");
        await this.requestLifecycleDrain();
        return this.enqueue(() => Promise.resolve(this.displayState()));
    }

    /**
     * Notifies matching enabled-site tabs of a diagnostic-policy revision and collects failures.
     */
    private async refreshDebugPolicyTabs(enabled: boolean, revision: number): Promise<readonly DebugRefreshFailure[]> {
        if (!this.snapshot?.globalEnabled) {
            return [];
        }
        const failures: DebugRefreshFailure[] = [];
        for (const adapter of this.adapters) {
            if (!isSiteEnabled(this.snapshot.sitePreferences, adapter.hostname)) {
                continue;
            }
            let tabs: readonly RuntimeTab[];
            try {
                tabs = await this.tabs.query({ url: adapter.registration.matches });
            } catch {
                failures.push({ hostname: adapter.hostname, reason: "matching-tabs-query" }); continue;
            }
            const seen = new Set<number>();
            for (const tab of tabs) {
                const url = urlFromTab(tab);
                if (!url || !adapter.matches(url) || seen.has(tab.id)) {
                    continue;
                }
                seen.add(tab.id);
                try {
                    const acknowledgement = await this.tabs.sendMessage(tab.id, { type: UPDATE_DEBUG_POLICY_MESSAGE, revision, enabled }, { frameId: 0 });
                    if (!isDebugPolicyUpdateAcknowledgement(acknowledgement, revision)) {
                        failures.push({ hostname: adapter.hostname, tabId: tab.id, reason: "tab-update" });
                    }
                } catch {
                    failures.push({ hostname: adapter.hostname, tabId: tab.id, reason: "tab-update" });
                }
            }
        }
        return failures;
    }

    /**
     * Persists the diagnostic logging setting and notifies matching enabled-site tabs.
     */
    public async setDebugEnabled(enabled: boolean): Promise<SetDebugEnabledResponse> {
        await this.ensureReady("cold-worker");
        await this.requestLifecycleDrain();
        let acceptedRevision: number | undefined;
        let refreshFailures: readonly DebugRefreshFailure[] = [];
        let error: "save-failed" | "settings-unavailable" | undefined;
        await this.enqueue(async () => {
            if (this.phaseValue !== "ready" || !this.snapshot) {
                error = "settings-unavailable"; return;
            }
            const write = await this.settings.setDebugEnabled(enabled);
            if (!write.ok) {
                error = this.settings.lastLoadError ? "settings-unavailable" : "save-failed";
                if (this.settings.lastLoadError) {
                    this.snapshot = undefined;
                    this.failure = "settings-load";
                    await this.performReconcile("failed-closed", "unknown", null);
                    this.phaseValue = "failed-closed";
                }
                return;
            }
            this.snapshot = write.snapshot;
            acceptedRevision = write.snapshot.revision;
            this.advanceReconcileRevision(write.snapshot.revision);
            if (!write.changed) {
                return;
            }
            if (enabled) {
                try {
                    await this.journal?.setEnabled(true);
                } catch { /* diagnostics never block processing */ }
                this.logBackgroundEvent({ category: "settings", reason: "settings-updated", count: 1 });
            }
            refreshFailures = await this.refreshDebugPolicyTabs(enabled, write.snapshot.revision);
            if (!enabled) {
                try {
                    await this.journal?.setEnabled(false);
                } catch { /* diagnostics never block processing */ }
            }
            this.refreshCachedPopupProjection();
        });
        const state = await this.enqueue(() => Promise.resolve(this.debugState()));
        if (error !== undefined) {
            return { ok: false, error, state };
        }
        if (acceptedRevision === undefined) {
            return { ok: false, error: "settings-unavailable", state };
        }
        return { ok: true, acceptedRevision, state, ...(refreshFailures.length === 0 ? {} : { refreshFailures }) };
    }

    /**
     * Sends a display-settings revision to matching enabled-site tabs and collects failures.
     */
    private async refreshDisplayTabs(display: DisplaySettings, revision: number): Promise<readonly DisplayRefreshFailure[]> {
        if (!this.snapshot?.globalEnabled) {
            return [];
        }
        const failures: DisplayRefreshFailure[] = [];
        for (const adapter of this.adapters) {
            if (!isSiteEnabled(this.snapshot.sitePreferences, adapter.hostname)) {
                continue;
            }
            let tabs: readonly RuntimeTab[];
            try {
                tabs = await this.tabs.query({ url: adapter.registration.matches });
            } catch {
                failures.push({ hostname: adapter.hostname, reason: "matching-tabs-query" });
                continue;
            }
            const matching = tabs.filter((tab) => {
                const url = urlFromTab(tab);
                return url !== null && adapter.matches(url);
            });
            const seen = new Set<number>();
            for (const tab of matching) {
                if (seen.has(tab.id)) {
                    continue;
                }
                seen.add(tab.id);
                try {
                    const response = await this.tabs.sendMessage(tab.id, {
                        type: UPDATE_PRESENTATION_MESSAGE,
                        revision,
                        display
                    }, { frameId: 0 });
                    if (!isPresentationUpdateAcknowledgement(response, revision)) {
                        failures.push({ hostname: adapter.hostname, tabId: tab.id, reason: "tab-update" });
                    }
                } catch {
                    failures.push({ hostname: adapter.hostname, tabId: tab.id, reason: "tab-update" });
                }
            }
        }
        return failures;
    }

    /**
     * Validates and persists display settings, then refreshes matching enabled-site tabs.
     */
    public async setDisplaySettings(display: unknown): Promise<SetDisplaySettingsResponse> {
        await this.ensureReady("cold-worker");
        await this.requestLifecycleDrain();
        let acceptedRevision: number | undefined;
        let refreshFailures: readonly DisplayRefreshFailure[] = [];
        let error: "invalid-format" | "invalid-time-zone" | "invalid-display-settings" | "save-failed" | "settings-unavailable" | undefined;
        await this.enqueue(async () => {
            if (this.phaseValue !== "ready" || !this.snapshot) {
                error = "settings-unavailable"; return;
            }
            const write = await this.settings.setDisplaySettings(display);
            if (!write.ok) {
                error = write.error === "invalid-format" || write.error === "invalid-time-zone" || write.error === "invalid-display-settings" ? write.error : (this.settings.lastLoadError ? "settings-unavailable" : "save-failed");
                if (this.settings.lastLoadError) {
                    this.snapshot = undefined;
                    this.failure = "settings-load";
                    await this.performReconcile("failed-closed", "unknown", null);
                    this.phaseValue = "failed-closed";
                }
                return;
            }
            this.snapshot = write.snapshot;
            acceptedRevision = write.snapshot.revision;
            this.advanceReconcileRevision(acceptedRevision);
            if (write.changed) {
                refreshFailures = await this.refreshDisplayTabs(write.snapshot.display, acceptedRevision);
                this.logBackgroundEvent({ category: "settings", reason: "settings-updated", count: 1 });
            }
            this.refreshCachedPopupProjection();
        });
        const state = await this.enqueue(() => Promise.resolve(this.displayState()));
        if (error !== undefined) {
            return { ok: false, error, state };
        }
        if (acceptedRevision === undefined) {
            return { ok: false, error: "settings-unavailable", state };
        }
        return { ok: true, acceptedRevision, state, refreshFailures };
    }

    /**
     * Restores defaults, clears diagnostics, and reconciles runtime activation.
     */
    public async resetAllSettings(): Promise<ResetAllSettingsResponse> {
        await this.ensureReady("cold-worker");
        await this.requestLifecycleDrain();
        let acceptedRevision: number | undefined;
        const outcome: { value: "accepted" | "save-failed" | "settings-unavailable" } = { value: "accepted" };
        await this.enqueue(async () => {
            const previousSnapshot = this.phaseValue === "ready" ? this.snapshot : undefined;
            const write = await this.settings.resetAll();
            if (!write.ok) {
                outcome.value = "save-failed";
                // A failed recovery write must not tear down an already healthy
                // application. Recovery is exposed only while unavailable, but the
                // background method remains safe for direct callers as well.
                if (this.phaseValue === "ready" && this.snapshot) {
                    return;
                }
                this.snapshot = undefined;
                this.failure = "settings-load";
                try {
                    const cleanup = await this.performReconcile("failed-closed", "unknown", null);
                    if (cleanup.failures.length > 0) {
                        this.failure = "fail-closed-cleanup";
                    }
                } catch {
                    this.failure = "fail-closed-cleanup";
                }
                this.phaseValue = "failed-closed";
                this.popupStateCache = undefined;
                return;
            }
            this.snapshot = write.snapshot;
            this.failure = undefined;
            this.phaseValue = "ready";
            acceptedRevision = write.snapshot.revision;
            this.lastReconcile = undefined;
            if (previousSnapshot?.globalEnabled) {
                await this.performReconcile("settings-change", "disabled", write.snapshot.revision, previousSnapshot.sitePreferences);
            }
            try {
                await this.journal?.clear();
            } catch { /* recovery must not depend on diagnostics */ }
            await this.performReconcile("activation-sweep", write.snapshot.globalEnabled ? "enabled" : "disabled", write.snapshot.revision, write.snapshot.sitePreferences);
            this.lifecycleReasons.clear();
            this.popupStateCache = undefined;
            await this.seedPopupProjection();
        });
        const state = await this.enqueue(() => Promise.resolve(this.deriveSitesState()));
        if (outcome.value === "accepted" && acceptedRevision !== undefined && state.availability === "ready") {
            return { ok: true, acceptedRevision, state };
        }
        return {
            ok: false,
            error: outcome.value === "save-failed" ? "save-failed" : "settings-unavailable",
            state
        };
    }

    /**
     * Persists global activation and reconciles every runtime adapter.
     */
    public async setGlobalEnabled(enabled: boolean): Promise<SetGlobalEnabledResponse> {
        await this.ensureReady("cold-worker");
        await this.requestLifecycleDrain();
        let acceptedRevision: number | undefined;
        const outcome: { value: "accepted" | "save-failed" | "settings-unavailable" } = { value: "accepted" };
        await this.enqueue(async () => {
            if (this.phaseValue !== "ready" || !this.snapshot) {
                outcome.value = "settings-unavailable";
                return;
            }
            const write = await this.settings.setGlobalEnabled(enabled);
            if (!write.ok) {
                if (this.settings.lastLoadError) {
                    outcome.value = "settings-unavailable";
                    this.snapshot = undefined;
                    this.failure = "settings-load";
                    await this.performReconcile("failed-closed", "unknown", null);
                    this.phaseValue = "failed-closed";
                } else {
                    outcome.value = "save-failed";
                }
                return;
            }
            this.snapshot = write.snapshot;
            acceptedRevision = write.snapshot.revision;
            await this.performReconcile("settings-change", write.snapshot.globalEnabled ? "enabled" : "disabled", write.snapshot.revision, write.snapshot.sitePreferences);
            if (write.changed) {
                this.logBackgroundEvent({ category: "settings", reason: "settings-updated", count: 1 });
            }
        });
        const state = await this.enqueue(async () => {
            const next = await this.derivePopupState();
            this.popupStateCache = next;
            return next;
        });
        if (outcome.value === "accepted" && acceptedRevision !== undefined) {
            return { ok: true, acceptedRevision, state };
        }
        return { ok: false, error: outcome.value === "save-failed" ? "save-failed" : "settings-unavailable", state };
    }

    /**
     * Reports whether the last reconciliation contains a failure for an adapter.
     */
    private hasFailureForAdapter(adapterId: string): boolean {
        return (this.lastReconcile?.failures ?? []).some((failure) => failureBelongsToAdapter(failure, adapterId));
    }

    /**
     * Persists the requested change and updates affected documents.
     */
    public async setSiteEnabled(
        hostname: string,
        enabled: boolean,
        surface: "popup" | "sites"
    ): Promise<SetSiteEnabledResponse> {
        await this.ensureReady("cold-worker");
        await this.requestLifecycleDrain();
        let acceptedRevision: number | undefined;
        const outcome: { value: "accepted" | "save-failed" | "invalid-hostname" | "settings-unavailable" } = { value: "accepted" };
        await this.enqueue(async () => {
            if (this.phaseValue !== "ready" || !this.snapshot) {
                outcome.value = "settings-unavailable";
                return;
            }
            // Keep this guard in the application as well as SettingsService so a
            // malformed direct caller cannot enter the transaction path.
            if (!isCanonicalHostname(hostname)) {
                outcome.value = "invalid-hostname";
                return;
            }
            const previous = this.snapshot;
            const write = await this.settings.setSiteEnabled(hostname, enabled);
            if (!write.ok) {
                outcome.value = write.error === "invalid-hostname" ? "invalid-hostname" : (this.settings.lastLoadError ? "settings-unavailable" : "save-failed");
                if (this.settings.lastLoadError) {
                    this.snapshot = undefined;
                    this.failure = "settings-load";
                    await this.performReconcile("failed-closed", "unknown", null);
                    this.phaseValue = "failed-closed";
                }
                return;
            }
            this.snapshot = write.snapshot;
            acceptedRevision = write.snapshot.revision;
            const affected = this.adapters
                .filter((adapter) => adapter.hostname === hostname)
                .filter((adapter) => {
                    const before = isSiteEnabled(previous.sitePreferences, adapter.hostname);
                    const after = isSiteEnabled(write.snapshot.sitePreferences, adapter.hostname);
                    return before !== after || (write.snapshot.globalEnabled && this.hasFailureForAdapter(adapter.id));
                })
                .map((adapter) => adapter.hostname);
            if (write.snapshot.globalEnabled && affected.length > 0) {
                await this.performReconcile("settings-change", "enabled", write.snapshot.revision, write.snapshot.sitePreferences, affected);
            } else {
                // A persisted no-effect/inactive edit must not touch runtime APIs, but
                // its authoritative revision still advances the response barrier.
                this.advanceReconcileRevision(write.snapshot.revision);
            }
            this.refreshCachedPopupProjection();
            if (write.changed) {
                this.logBackgroundEvent({ category: "settings", reason: "settings-updated", count: 1 });
            }
        });
        if (outcome.value === "invalid-hostname") {
            // Typed semantic rejection is deliberately side-effect free. Use the
            // latest already-read popup projection instead of querying the active tab
            // or document merely to construct an error response.
            const state = surface === "popup" ? (this.popupStateCache ?? this.unavailableState()) : this.deriveSitesState();
            if (surface === "popup") {
                return { ok: false, error: outcome.value, surface, state: state as PopupState };
            }
            return { ok: false, error: outcome.value, surface, state: state as SitesState };
        }
        const state = await this.enqueue(async () => {
            if (surface === "popup") {
                const next = await this.derivePopupState();
                this.popupStateCache = next;
                return next;
            }
            return this.deriveSitesState();
        });
        if (outcome.value === "accepted" && acceptedRevision !== undefined) {
            return surface === "popup"
                ? { ok: true, acceptedRevision, surface, state: state as PopupState }
                : { ok: true, acceptedRevision, surface, state: state as SitesState };
        }
        const error = outcome.value === "accepted" ? "settings-unavailable" : outcome.value;
        if (surface === "popup") {
            return { ok: false, error, surface, state: state as PopupState };
        }
        return { ok: false, error, surface, state: state as SitesState };
    }
}
