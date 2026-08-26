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

export type PopupStatus =
  | "active"
  | "global-disabled"
  | "site-disabled"
  | "inaccessible"
  | "runtime-failed"
  | "no-rules"
  | "settings-unavailable";

export type PopupFailure =
  | "current-tab-query"
  | "registration"
  | "matching-tabs-query"
  | "current-tab-inject"
  | "current-tab-teardown"
  | "document-status"
  | "settings-load"
  | "fail-closed-cleanup";

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

export type SetGlobalEnabledResponse =
  | { readonly ok: true; readonly acceptedRevision: number; readonly state: PopupState }
  | { readonly ok: false; readonly error: "save-failed" | "settings-unavailable"; readonly state: PopupState };

export interface SiteListEntry {
    readonly hostname: string;
    readonly enabled: boolean;
    readonly hasAdapter: boolean;
}

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

export type SetSiteEnabledResponse =
  | { readonly ok: true; readonly acceptedRevision: number; readonly surface: "popup"; readonly state: PopupState }
  | { readonly ok: true; readonly acceptedRevision: number; readonly surface: "sites"; readonly state: SitesState }
  | { readonly ok: false; readonly error: "save-failed" | "invalid-hostname" | "settings-unavailable"; readonly surface: "popup"; readonly state: PopupState }
  | { readonly ok: false; readonly error: "save-failed" | "invalid-hostname" | "settings-unavailable"; readonly surface: "sites"; readonly state: SitesState };

export type ResetAllSettingsResponse =
  | { readonly ok: true; readonly acceptedRevision: number; readonly state: Extract<SitesState, { readonly availability: "ready" }> }
  | { readonly ok: false; readonly error: "save-failed" | "settings-unavailable"; readonly state: SitesState };

export type DisplayState =
  | { readonly availability: "ready"; readonly revision: number; readonly display: DisplaySettings; readonly debugEnabled: boolean; readonly error?: "unavailable-time-zone" }
  | { readonly availability: "unavailable"; readonly revision: null; readonly display: null; readonly failure: "settings-load" | "fail-closed-cleanup" };

export type DebugState =
  | { readonly availability: "ready"; readonly revision: number; readonly enabled: boolean }
  | { readonly availability: "unavailable"; readonly revision: null; readonly enabled: null; readonly failure: "settings-load" | "fail-closed-cleanup" };

export type SetDebugEnabledResponse =
  | { readonly ok: true; readonly acceptedRevision: number; readonly state: DebugState; readonly refreshFailures?: readonly DebugRefreshFailure[] }
  | { readonly ok: false; readonly error: "save-failed" | "settings-unavailable"; readonly state: DebugState };

export interface DebugRefreshFailure {
    readonly hostname: string;
    readonly tabId?: number;
    readonly reason: "matching-tabs-query" | "tab-update";
}

export interface DisplayRefreshFailure { readonly hostname: string; readonly tabId?: number; readonly reason: "matching-tabs-query" | "tab-update"; }

export type SetDisplaySettingsResponse =
  | { readonly ok: true; readonly acceptedRevision: number; readonly state: DisplayState; readonly refreshFailures: readonly DisplayRefreshFailure[] }
  | { readonly ok: false; readonly error: "invalid-format" | "invalid-time-zone" | "invalid-display-settings" | "save-failed" | "settings-unavailable"; readonly state: DisplayState };

export type ApplicationPhase = "cold" | "initializing" | "ready" | "failed-closed";

export interface ActivationCoordinator {
    reconcile(input: {
        readonly revision: number | null;
        readonly mode: ActivationMode;
        readonly policy: "enabled" | "disabled" | "unknown";
        readonly sitePreferences?: Readonly<Record<string, boolean>>;
        readonly affectedHostnames?: readonly string[];
    }): Promise<ActivationReconcileResult>;
}

export interface BackgroundApplicationOptions {
    readonly settings: SettingsService;
    readonly coordinator: ActivationCoordinator;
    readonly tabs: TabsRuntime;
    readonly adapters: readonly RuntimeAdapterDefinition[];
    readonly journal?: DiagnosticJournal;
    readonly diagnosticEnvironment?: {
        readonly extensionVersion?: string;
        readonly browserFamily: DiagnosticBrowserFamily;
    };
}

export type LifecycleReason = "startup" | "installed" | "updated" | "cold-worker";

function matchingTabFailure(
    failures: readonly ReconcileFailure[],
    adapterId: string,
    tabId: number
): Exclude<PopupFailure, "settings-load" | "fail-closed-cleanup"> | undefined {
    for (const failure of failures) {
        if (failure.scope === "registration" && failure.adapterId === adapterId) return "registration";
        if (failure.scope === "matching-tabs-query" && failure.adapterId === adapterId) return "matching-tabs-query";
        if (failure.scope === "tab" && failure.adapterId === adapterId && failure.tabId === tabId) {
            if (failure.action === "inject") return "current-tab-inject";
            if (failure.action === "teardown") return "current-tab-teardown";
            return "document-status";
        }
    }
    return undefined;
}

function urlFromTab(tab: RuntimeTab | undefined): URL | null {
    if (!tab?.url) return null;
    try { return new URL(tab.url); } catch { return null; }
}

function adapterHostnameMatches(
    adapter: RuntimeAdapterDefinition,
    hostname: string
): boolean {
    return adapter.hostname === hostname;
}

function failureBelongsToAdapter(failure: ReconcileFailure, adapterId: string): boolean {
    return failure.adapterId === adapterId;
}

export class BackgroundApplication {
    private readonly settings: SettingsService;
    private readonly coordinator: ActivationCoordinator;
    private readonly tabs: TabsRuntime;
    private readonly adapters: readonly RuntimeAdapterDefinition[];
    private readonly journal: DiagnosticJournal | undefined;
    private readonly diagnosticEnvironment: BackgroundApplicationOptions["diagnosticEnvironment"];
    private phaseValue: ApplicationPhase = "cold";
    private snapshot: SettingsSnapshotV5 | undefined;
    private failure: "settings-load" | "fail-closed-cleanup" | undefined;
    private lastReconcile: ActivationReconcileResult | undefined;
    private popupStateCache: PopupState | undefined;
    private popupTabId: number | undefined;
    private readinessFlight: Promise<void> | undefined;
    private transactionTail: Promise<void> = Promise.resolve();
    private readonly lifecycleReasons = new Set<LifecycleReason>();
    private lifecycleFlight: Promise<void> | undefined;

    public constructor(options: BackgroundApplicationOptions) {
        this.settings = options.settings;
        this.coordinator = options.coordinator;
        this.tabs = options.tabs;
        this.adapters = options.adapters;
        this.journal = options.journal;
        this.diagnosticEnvironment = options.diagnosticEnvironment;
    }

    public get phase(): ApplicationPhase { return this.phaseValue; }
    public get currentSnapshot(): SettingsSnapshotV5 | undefined { return this.snapshot; }
    public get reconcileResult(): ActivationReconcileResult | undefined { return this.lastReconcile; }

    private enqueue<T>(operation: () => Promise<T>): Promise<T> {
        const run = this.transactionTail.then(operation);
        this.transactionTail = run.then(() => undefined, () => undefined);
        return run;
    }

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
                if (!affectedIds.has(id)) registration[id] = value;
            }
            for (const [id, value] of Object.entries(result.registration)) registration[id] = value;
            const tabs = [
                ...this.lastReconcile.tabs.filter((record) => !affectedIds.has(record.adapterId)),
                ...result.tabs
            ];
            result = { ...result, failures, registration, tabs };
        }
        // Calls are serialized, but retain the revision guard for injected/custom
        // coordinators that resolve after a newer result was published.
        if (!this.lastReconcile || result.revision === null || this.lastReconcile.revision === null || result.revision >= this.lastReconcile.revision) this.lastReconcile = result;
        this.refreshCachedPopupProjection();
        return result;
    }

    private advanceReconcileRevision(revision: number): void {
        if (!this.lastReconcile) return;
        this.lastReconcile = { ...this.lastReconcile, revision };
    }

    private async initialize(): Promise<void> {
        this.phaseValue = "initializing";
        const loaded = await this.settings.load();
        if (!loaded.ok) {
            this.snapshot = undefined;
            this.failure = "settings-load";
            try {
                const cleanup = await this.performReconcile("failed-closed", "unknown", null);
                if (cleanup.failures.length > 0) this.failure = "fail-closed-cleanup";
            } catch {
                this.failure = "fail-closed-cleanup";
            }
            this.phaseValue = "failed-closed";
            return;
        }
        this.snapshot = loaded.snapshot;
        this.failure = undefined;
        if (loaded.snapshot.debugEnabled) {
            try { await this.journal?.setEnabled(true); } catch { /* diagnostics never block activation */ }
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

    public ensureReady(reason: LifecycleReason = "cold-worker"): Promise<void> {
        if (reason !== "cold-worker") this.lifecycleReasons.add(reason);
        if (this.phaseValue === "ready") return this.requestLifecycleDrain();
        if (this.phaseValue === "failed-closed" && this.readinessFlight === undefined) {
            // Retry cleanup/read only; a failed-closed worker never silently adopts
            // the enabled default after an unreadable snapshot.
            this.readinessFlight = this.enqueue(async () => {
                const loaded = await this.settings.load();
                if (!loaded.ok || loaded.source === "default") {
                    try {
                        const cleanup = await this.performReconcile("failed-closed", "unknown", null);
                        this.failure = cleanup.failures.length > 0 ? "fail-closed-cleanup" : "settings-load";
                    } catch { this.failure = "fail-closed-cleanup"; }
                    return;
                }
                this.snapshot = loaded.snapshot;
                this.failure = undefined;
                if (loaded.snapshot.debugEnabled) {
                    try { await this.journal?.setEnabled(true); } catch { /* diagnostics never block recovery */ }
                }
                const result = await this.performReconcile("activation-sweep", loaded.snapshot.globalEnabled ? "enabled" : "disabled", loaded.snapshot.revision, loaded.snapshot.sitePreferences);
                this.phaseValue = "ready";
                await this.seedPopupProjection();
                if (result.failures.length > 0) this.failure = undefined;
            }).finally(() => { this.readinessFlight = undefined; });
            return this.readinessFlight;
        }
        if (this.readinessFlight) return this.readinessFlight;
        this.readinessFlight = this.enqueue(() => this.initialize()).finally(() => { this.readinessFlight = undefined; });
        return this.readinessFlight;
    }

    private requestLifecycleDrain(): Promise<void> {
        if (this.lifecycleReasons.size === 0) return Promise.resolve();
        if (this.lifecycleFlight) return this.lifecycleFlight;
        this.lifecycleFlight = this.enqueue(async () => {
            while (this.lifecycleReasons.size > 0) {
                if (this.phaseValue !== "ready" || !this.snapshot) return;
                await this.performReconcile("activation-sweep", this.snapshot.globalEnabled ? "enabled" : "disabled", this.snapshot.revision, this.snapshot.sitePreferences);
                this.lifecycleReasons.clear();
                this.logBackgroundEvent({ category: "lifecycle", count: 1 });
            }
        }).finally(() => { this.lifecycleFlight = undefined; });
        return this.lifecycleFlight;
    }

    public requestLifecycle(reason: Exclude<LifecycleReason, "cold-worker">): Promise<void> {
        this.lifecycleReasons.add(reason);
        return this.ensureReady(reason);
    }

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
   * Seed one truthful popup projection during normal readiness. Site/Sites
   * writes can then refresh its snapshot-derived fields without querying tabs
   * or probing a document merely to reject an invalid intent.
   */
    private async seedPopupProjection(): Promise<void> {
        if (this.popupStateCache || this.phaseValue !== "ready" || !this.snapshot) return;
        const state = await this.derivePopupState();
        this.popupStateCache = state;
    }

    private refreshCachedPopupProjection(): void {
        const cached = this.popupStateCache;
        if (!cached || cached.availability !== "ready" || !this.snapshot) return;
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

    private unavailableSitesState(): SitesState {
        return {
            availability: "unavailable",
            revision: null,
            globalEnabled: null,
            sites: [],
            failure: this.failure ?? "settings-load"
        };
    }

    private adapterForUrl(url: URL): RuntimeAdapterDefinition | undefined {
        return this.adapters.find((candidate) => candidate.matches(url));
    }

    private siteEnabled(hostname: string): boolean {
        return isSiteEnabled(this.snapshot?.sitePreferences ?? {}, hostname);
    }

    private async derivePopupState(): Promise<PopupState> {
        if (this.phaseValue !== "ready" || !this.snapshot) return this.unavailableState();
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

    private deriveSitesState(): SitesState {
        if (this.phaseValue !== "ready" || !this.snapshot) return this.unavailableSitesState();
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

    public async getPopupState(): Promise<PopupState> {
        await this.ensureReady("cold-worker");
        await this.requestLifecycleDrain();
        return this.enqueue(async () => {
            const state = await this.derivePopupState();
            this.popupStateCache = state;
            return state;
        });
    }

    public async getSitesState(): Promise<SitesState> {
        await this.ensureReady("cold-worker");
        await this.requestLifecycleDrain();
        return this.enqueue(() => Promise.resolve(this.deriveSitesState()));
    }

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

    public async getDebugState(): Promise<DebugState> {
        await this.ensureReady("cold-worker");
        await this.requestLifecycleDrain();
        return this.enqueue(() => Promise.resolve(this.debugState()));
    }

    public async getDiagnosticsSnapshot(): Promise<GetDiagnosticsSnapshotResponse> {
        await this.ensureReady("cold-worker");
        await this.requestLifecycleDrain();
        return this.enqueue(async (): Promise<GetDiagnosticsSnapshotResponse> => {
            if (this.phaseValue !== "ready" || !this.snapshot || !this.journal) return { ok: false, error: "unavailable" };
            if (!this.snapshot.debugEnabled) return { ok: false, error: "disabled" };
            const result = await this.journal.readSnapshot();
            if (!result.ok) return result;
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

    public async clearDiagnostics(): Promise<ClearDiagnosticsResponse> {
        await this.ensureReady("cold-worker");
        await this.requestLifecycleDrain();
        return this.enqueue(async (): Promise<ClearDiagnosticsResponse> => {
            if (this.phaseValue !== "ready" || !this.snapshot || !this.journal) return { ok: false, error: "unavailable" };
            if (!this.snapshot.debugEnabled) return { ok: false, error: "disabled" };
            return this.journal.clearEntries();
        });
    }

    private trustedDiagnosticEvent(event: DiagnosticEvent): DiagnosticEvent {
        const trusted = { ...event };
        delete trusted.adapterVersion;
        delete trusted.extensionVersion;
        delete trusted.browserFamily;
        const version = this.diagnosticEnvironment?.extensionVersion;
        if (typeof version === "string" && /^[0-9A-Za-z][0-9A-Za-z._+-]{0,31}$/u.test(version)) trusted.extensionVersion = version;
        const family = this.diagnosticEnvironment?.browserFamily;
        if (family === "chromium" || family === "firefox" || family === "other") trusted.browserFamily = family;
        return Object.freeze(trusted);
    }

    private logBackgroundEvent(input: DiagnosticEventInput): void {
        if (!this.snapshot?.debugEnabled || !this.journal) return;
        const hostname = this.adapters[0]?.hostname;
        if (!hostname) return;
        const event = sanitizeDiagnosticEvent(input, { hostname, pageCategory: "other", incognito: false });
        if (!event) return;
        void this.journal.append(this.trustedDiagnosticEvent(event)).catch(() => undefined);
    }

    public async recordDocumentEvent(
        input: unknown,
        sender: DiagnosticSender & { readonly frameId?: unknown }
    ): Promise<boolean> {
        if (this.phaseValue !== "ready" || !this.snapshot?.debugEnabled || !this.snapshot.globalEnabled || !this.journal) return false;
        if (sender.frameId !== undefined && sender.frameId !== 0) return false;
        const event = createDiagnosticEvent(input, sender);
        if (!event || !isSiteEnabled(this.snapshot.sitePreferences, event.hostname)) return false;
        if (!this.adapters.some((adapter) => adapter.hostname === event.hostname)) return false;
        try { await this.journal.append(this.trustedDiagnosticEvent(event)); } catch { /* diagnostics never block timestamp processing */ }
        return true;
    }

    private displayState(): DisplayState {
        if (this.phaseValue !== "ready" || !this.snapshot) return this.unavailableDisplayState();
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

    private unavailableDisplayState(): DisplayState {
        return {
            availability: "unavailable",
            revision: null,
            display: null,
            failure: this.failure === "fail-closed-cleanup" ? "fail-closed-cleanup" : "settings-load"
        };
    }

    private isZoneAvailable(identifier: string): boolean {
        try {
            new Intl.DateTimeFormat(undefined, { timeZone: identifier }).resolvedOptions();
            return true;
        } catch { return false; }
    }

    public async getDisplayState(): Promise<DisplayState> {
        await this.ensureReady("cold-worker");
        await this.requestLifecycleDrain();
        return this.enqueue(() => Promise.resolve(this.displayState()));
    }

    private async refreshDebugPolicyTabs(enabled: boolean, revision: number): Promise<readonly DebugRefreshFailure[]> {
        if (!this.snapshot?.globalEnabled) return [];
        const failures: DebugRefreshFailure[] = [];
        for (const adapter of this.adapters) {
            if (!isSiteEnabled(this.snapshot.sitePreferences, adapter.hostname)) continue;
            let tabs: readonly RuntimeTab[];
            try { tabs = await this.tabs.query({ url: adapter.registration.matches }); }
            catch { failures.push({ hostname: adapter.hostname, reason: "matching-tabs-query" }); continue; }
            const seen = new Set<number>();
            for (const tab of tabs) {
                const url = urlFromTab(tab);
                if (!url || !adapter.matches(url) || seen.has(tab.id)) continue;
                seen.add(tab.id);
                try {
                    const acknowledgement = await this.tabs.sendMessage(tab.id, { type: UPDATE_DEBUG_POLICY_MESSAGE, revision, enabled }, { frameId: 0 });
                    if (!isDebugPolicyUpdateAcknowledgement(acknowledgement, revision)) failures.push({ hostname: adapter.hostname, tabId: tab.id, reason: "tab-update" });
                } catch { failures.push({ hostname: adapter.hostname, tabId: tab.id, reason: "tab-update" }); }
            }
        }
        return failures;
    }

    public async setDebugEnabled(enabled: boolean): Promise<SetDebugEnabledResponse> {
        await this.ensureReady("cold-worker");
        await this.requestLifecycleDrain();
        let acceptedRevision: number | undefined;
        let refreshFailures: readonly DebugRefreshFailure[] = [];
        let error: "save-failed" | "settings-unavailable" | undefined;
        await this.enqueue(async () => {
            if (this.phaseValue !== "ready" || !this.snapshot) { error = "settings-unavailable"; return; }
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
            if (!write.changed) return;
            if (enabled) {
                try { await this.journal?.setEnabled(true); } catch { /* diagnostics never block processing */ }
                this.logBackgroundEvent({ category: "settings", reason: "settings-updated", count: 1 });
            }
            refreshFailures = await this.refreshDebugPolicyTabs(enabled, write.snapshot.revision);
            if (!enabled) {
                try { await this.journal?.setEnabled(false); } catch { /* diagnostics never block processing */ }
            }
            this.refreshCachedPopupProjection();
        });
        const state = await this.enqueue(() => Promise.resolve(this.debugState()));
        if (error !== undefined) return { ok: false, error, state };
        if (acceptedRevision === undefined) return { ok: false, error: "settings-unavailable", state };
        return { ok: true, acceptedRevision, state, ...(refreshFailures.length === 0 ? {} : { refreshFailures }) };
    }

    private async refreshDisplayTabs(display: DisplaySettings, revision: number): Promise<readonly DisplayRefreshFailure[]> {
        if (!this.snapshot?.globalEnabled) return [];
        const failures: DisplayRefreshFailure[] = [];
        for (const adapter of this.adapters) {
            if (!isSiteEnabled(this.snapshot.sitePreferences, adapter.hostname)) continue;
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
                if (seen.has(tab.id)) continue;
                seen.add(tab.id);
                try {
                    const response = await this.tabs.sendMessage(tab.id, {
                        type: UPDATE_PRESENTATION_MESSAGE,
                        revision,
                        display
                    }, { frameId: 0 });
                    if (!isPresentationUpdateAcknowledgement(response, revision)) failures.push({ hostname: adapter.hostname, tabId: tab.id, reason: "tab-update" });
                } catch {
                    failures.push({ hostname: adapter.hostname, tabId: tab.id, reason: "tab-update" });
                }
            }
        }
        return failures;
    }

    public async setDisplaySettings(display: unknown): Promise<SetDisplaySettingsResponse> {
        await this.ensureReady("cold-worker");
        await this.requestLifecycleDrain();
        let acceptedRevision: number | undefined;
        let refreshFailures: readonly DisplayRefreshFailure[] = [];
        let error: "invalid-format" | "invalid-time-zone" | "invalid-display-settings" | "save-failed" | "settings-unavailable" | undefined;
        await this.enqueue(async () => {
            if (this.phaseValue !== "ready" || !this.snapshot) { error = "settings-unavailable"; return; }
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
        if (error !== undefined) return { ok: false, error, state };
        if (acceptedRevision === undefined) return { ok: false, error: "settings-unavailable", state };
        return { ok: true, acceptedRevision, state, refreshFailures };
    }

    /**
   * Recovery is serialized with every other settings intent.  A successful
   * durable reset is the only path that leaves failed-closed mode; a failed
   * write cleans up runtime ownership and keeps the unavailable projection.
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
                if (this.phaseValue === "ready" && this.snapshot) return;
                this.snapshot = undefined;
                this.failure = "settings-load";
                try {
                    const cleanup = await this.performReconcile("failed-closed", "unknown", null);
                    if (cleanup.failures.length > 0) this.failure = "fail-closed-cleanup";
                } catch { this.failure = "fail-closed-cleanup"; }
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
            try { await this.journal?.clear(); } catch { /* recovery must not depend on diagnostics */ }
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
            if (write.changed) this.logBackgroundEvent({ category: "settings", reason: "settings-updated", count: 1 });
        });
        const state = await this.enqueue(async () => {
            const next = await this.derivePopupState();
            this.popupStateCache = next;
            return next;
        });
        if (outcome.value === "accepted" && acceptedRevision !== undefined) return { ok: true, acceptedRevision, state };
        return { ok: false, error: outcome.value === "save-failed" ? "save-failed" : "settings-unavailable", state };
    }

    private hasFailureForAdapter(adapterId: string): boolean {
        return (this.lastReconcile?.failures ?? []).some((failure) => failureBelongsToAdapter(failure, adapterId));
    }

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
            if (write.changed) this.logBackgroundEvent({ category: "settings", reason: "settings-updated", count: 1 });
        });
        if (outcome.value === "invalid-hostname") {
            // Typed semantic rejection is deliberately side-effect free. Use the
            // latest already-read popup projection instead of querying the active tab
            // or document merely to construct an error response.
            const state = surface === "popup" ? (this.popupStateCache ?? this.unavailableState()) : this.deriveSitesState();
            if (surface === "popup") return { ok: false, error: outcome.value, surface, state: state as PopupState };
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
        if (surface === "popup") return { ok: false, error, surface, state: state as PopupState };
        return { ok: false, error, surface, state: state as SitesState };
    }
}
