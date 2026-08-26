/**
 * @file Popup and sites-state projections derived from background runtime state.
 */

import type { ReconcileFailure, RuntimeAdapterDefinition } from "../runtime/adapter-activation";
import { DOCUMENT_STATUS_MESSAGE, isDocumentStatusResponse } from "../runtime/messages";
import { isRuntimeTab, type RuntimeTab, type TabsRuntime } from "../runtime/tabs";
import { isSiteEnabled } from "../settings/snapshot";
import type { ActivationManager } from "./activation-manager";
import type { ApplicationStateView } from "./application-state";
import type {
    PopupRuntimeFailure,
    ReadyPopupStatus,
} from "./view-state-values";
import type { PopupState, SitesState } from "./view-state";

/**
 * Maps a reconcile failure for an adapter and tab to a popup failure.
 *
 * @param failures - Reconciliation failures to inspect.
 * @param adapterId - Adapter whose tab failure is requested.
 * @param tabId - Browser tab whose failure is requested.
 * @returns - Matching popup failure code, or undefined when none exists.
 */
function matchingTabFailure(
    failures: readonly ReconcileFailure[],
    adapterId: string,
    tabId: number,
): PopupRuntimeFailure | undefined {
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
 *
 * @param tab - Browser tab, when one was returned.
 * @returns - Parsed tab URL, or null when absent or malformed.
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
 * Owns active-tab and site-list projections plus the popup cache.
 */
export class StateProjection {
    /**
     * Browser tab query and messaging boundary.
     */
    private readonly tabs: TabsRuntime;

    /**
     * Immutable runtime adapter catalog.
     */
    private readonly adapters: readonly RuntimeAdapterDefinition[];

    /**
     * Runtime reconciliation state used to map failures.
     */
    private readonly activation: ActivationManager;

    /**
     * Lazily seeded popup projection.
     */
    private popupCache: PopupState | undefined;

    /**
     * Tab identity paired with the cached popup projection.
     */
    private popupTabId: number | undefined;

    /**
     * Creates background state projections.
     *
     * @param tabs - Browser tab query and messaging boundary.
     * @param adapters - Runtime adapter catalog.
     * @param activation - Runtime reconciliation state.
     */
    public constructor(
        tabs: TabsRuntime,
        adapters: readonly RuntimeAdapterDefinition[],
        activation: ActivationManager,
    ) {
        this.tabs = tabs;
        this.adapters = adapters;
        this.activation = activation;
    }

    /**
     * Latest popup projection, when one has been derived.
     *
     * @returns - Cached popup state.
     */
    public get cachedPopup(): PopupState | undefined {
        return this.popupCache;
    }

    /**
     * Clears active-tab projection state.
     */
    public clear(): void {
        this.popupCache = undefined;
        this.popupTabId = undefined;
    }

    /**
     * Initializes the popup cache once the application becomes ready.
     *
     * @param state - Current lifecycle state.
     * @returns - Promise settled after optional projection seeding.
     */
    public async seed(state: ApplicationStateView): Promise<void> {
        if (this.popupCache || state.phase !== "ready" || !state.snapshot) {
            return;
        }
        this.popupCache = await this.derivePopup(state);
    }

    /**
     * Derives and stores a fresh active-tab popup projection.
     *
     * @param state - Current lifecycle state.
     * @returns - Fresh popup state.
     */
    public async deriveAndCachePopup(state: ApplicationStateView): Promise<PopupState> {
        const popup = await this.derivePopup(state);
        this.popupCache = popup;
        return popup;
    }

    /**
     * Refreshes cached popup state without querying the active document.
     *
     * @param state - Current lifecycle state.
     */
    public refreshCachedPopup(state: ApplicationStateView): void {
        const cached = this.popupCache;
        const snapshot = state.snapshot;
        if (!cached || cached.availability !== "ready" || !snapshot) {
            return;
        }
        const hostname = cached.hostname;
        if (hostname === null) {
            this.popupCache = {
                ...cached,
                revision: snapshot.revision,
                globalEnabled: snapshot.globalEnabled,
                siteEnabled: null,
                hasAdapter: false,
            };
            return;
        }
        const adapter = this.adapters.find((candidate) => candidate.hostname === hostname);
        const siteEnabled = isSiteEnabled(snapshot.sitePreferences, hostname);
        const relevantFailure = adapter && this.popupTabId !== undefined
            ? matchingTabFailure(
                this.activation.result?.failures ?? [],
                adapter.id,
                this.popupTabId,
            )
            : undefined;
        let status: ReadyPopupStatus = cached.status;
        let failure: PopupRuntimeFailure | undefined = cached.failure;
        if (relevantFailure) {
            status = "runtime-failed";
            failure = relevantFailure;
        } else if (!snapshot.globalEnabled) {
            status = "global-disabled";
            failure = undefined;
        } else if (!siteEnabled) {
            status = "site-disabled";
            failure = undefined;
        } else if (!adapter) {
            status = "no-rules";
            failure = undefined;
        } else if (
            status === "global-disabled"
            || status === "site-disabled"
            || status === "no-rules"
        ) {
            status = "active";
            failure = undefined;
        }
        this.popupCache = {
            availability: "ready",
            revision: snapshot.revision,
            globalEnabled: snapshot.globalEnabled,
            hostname,
            siteEnabled,
            hasAdapter: adapter !== undefined,
            status,
            ...(failure === undefined ? {} : { failure }),
        };
    }

    /**
     * Derives popup state from the active tab, settings, and runtime status.
     *
     * @param state - Current lifecycle state.
     * @returns - Popup state derived from the current tab.
     */
    public async derivePopup(state: ApplicationStateView): Promise<PopupState> {
        const snapshot = state.snapshot;
        if (state.phase !== "ready" || !snapshot) {
            return this.unavailablePopup(state);
        }
        const current = await this.activeTab();
        this.popupTabId = current.tab?.id;
        if (current.error) {
            return {
                availability: "ready",
                revision: snapshot.revision,
                globalEnabled: snapshot.globalEnabled,
                hostname: null,
                siteEnabled: null,
                hasAdapter: false,
                status: "runtime-failed",
                failure: "current-tab-query",
            };
        }
        const url = urlFromTab(current.tab);
        if (!url || (url.protocol !== "http:" && url.protocol !== "https:") || !url.hostname) {
            return {
                availability: "ready",
                revision: snapshot.revision,
                globalEnabled: snapshot.globalEnabled,
                hostname: null,
                siteEnabled: null,
                hasAdapter: false,
                status: "inaccessible",
            };
        }
        const hostname = url.hostname;
        const adapter = this.adapters.find((candidate) => candidate.matches(url));
        const siteEnabled = isSiteEnabled(snapshot.sitePreferences, hostname);
        const tabId = current.tab?.id;
        if (adapter) {
            const failure = tabId === undefined
                ? "current-tab-query"
                : matchingTabFailure(this.activation.result?.failures ?? [], adapter.id, tabId);
            if (failure) {
                return {
                    availability: "ready",
                    revision: snapshot.revision,
                    globalEnabled: snapshot.globalEnabled,
                    hostname,
                    siteEnabled,
                    hasAdapter: true,
                    status: "runtime-failed",
                    failure,
                };
            }
        }
        if (!snapshot.globalEnabled) {
            return this.readyPopup(snapshot.revision, false, hostname, siteEnabled, adapter, {
                status: "global-disabled",
            });
        }
        if (!siteEnabled) {
            return this.readyPopup(snapshot.revision, true, hostname, false, adapter, {
                status: "site-disabled",
            });
        }
        if (!adapter) {
            return this.readyPopup(snapshot.revision, true, hostname, true, adapter, {
                status: "no-rules",
            });
        }
        if (tabId === undefined) {
            return this.readyPopup(snapshot.revision, true, hostname, true, adapter, {
                status: "runtime-failed",
                failure: "current-tab-query",
            });
        }
        try {
            const response = await this.tabs.sendMessage(
                tabId,
                { type: DOCUMENT_STATUS_MESSAGE },
                { frameId: 0 },
            );
            if (
                !isDocumentStatusResponse(response)
                || (response.phase !== "waiting" && response.phase !== "active")
            ) {
                return this.documentStatusFailure(snapshot.revision, hostname);
            }
        } catch {
            return this.documentStatusFailure(snapshot.revision, hostname);
        }
        return this.readyPopup(snapshot.revision, true, hostname, true, adapter, {
            status: "active",
        });
    }

    /**
     * Builds the sorted site list from adapters and explicit preferences.
     *
     * @param state - Current lifecycle state.
     * @returns - Sorted effective site-preferences state.
     */
    public deriveSites(state: ApplicationStateView): SitesState {
        const snapshot = state.snapshot;
        if (state.phase !== "ready" || !snapshot) {
            return this.unavailableSites(state);
        }
        const adapterHostnames = this.adapters.map((adapter) => adapter.hostname);
        const explicitHostnames = Object.keys(snapshot.sitePreferences);
        const hostnames = [...new Set([...adapterHostnames, ...explicitHostnames])].sort(
            (left, right) => (left < right ? -1 : left > right ? 1 : 0),
        );
        return {
            availability: "ready",
            revision: snapshot.revision,
            globalEnabled: snapshot.globalEnabled,
            sites: hostnames.map((hostname) => ({
                hostname,
                enabled: isSiteEnabled(snapshot.sitePreferences, hostname),
                hasAdapter: this.adapters.some((adapter) => adapter.hostname === hostname),
            })),
        };
    }

    /**
     * Builds a fail-closed popup projection.
     *
     * @param state - Current lifecycle state.
     * @returns - Unavailable popup state.
     */
    public unavailablePopup(state: ApplicationStateView): PopupState {
        return {
            availability: "unavailable",
            revision: null,
            globalEnabled: null,
            hostname: null,
            siteEnabled: null,
            hasAdapter: false,
            status: state.failure === "fail-closed-cleanup"
                ? "runtime-failed"
                : "settings-unavailable",
            failure: state.failure ?? "settings-load",
        };
    }

    /**
     * Queries the active tab and distinguishes lookup failures from empty results.
     *
     * @returns - Active tab result and a query-failure flag.
     */
    private async activeTab(): Promise<{
        readonly tab: RuntimeTab | undefined;
        readonly error: boolean;
    }> {
        try {
            const tabs = await this.tabs.query({ active: true, currentWindow: true });
            return { tab: tabs.find(isRuntimeTab), error: false };
        } catch {
            return { tab: undefined, error: true };
        }
    }

    /**
     * Builds a fail-closed sites projection.
     *
     * @param state - Current lifecycle state.
     * @returns - Unavailable sites state.
     */
    private unavailableSites(state: ApplicationStateView): SitesState {
        return {
            availability: "unavailable",
            revision: null,
            globalEnabled: null,
            sites: [],
            failure: state.failure ?? "settings-load",
        };
    }

    /**
     * Builds a ready popup projection with common fields.
     *
     * @param revision - Authoritative settings revision.
     * @param globalEnabled - Global activation state.
     * @param hostname - Active page hostname.
     * @param siteEnabled - Effective site activation state.
     * @param adapter - Matching runtime adapter, when present.
     * @param outcome - Runtime status and optional failure.
     * @param outcome.status - Runtime status to expose.
     * @param outcome.failure - Optional runtime failure to expose.
     * @returns - Ready popup projection.
     */
    private readyPopup(
        revision: number,
        globalEnabled: boolean,
        hostname: string,
        siteEnabled: boolean,
        adapter: RuntimeAdapterDefinition | undefined,
        outcome: {
            readonly status: ReadyPopupStatus;
            readonly failure?: PopupRuntimeFailure;
        },
    ): PopupState {
        return {
            availability: "ready",
            revision,
            globalEnabled,
            hostname,
            siteEnabled,
            hasAdapter: adapter !== undefined,
            status: outcome.status,
            ...(outcome.failure === undefined ? {} : { failure: outcome.failure }),
        };
    }

    /**
     * Builds a document-status failure projection for a supported site.
     *
     * @param revision - Authoritative settings revision.
     * @param hostname - Active supported hostname.
     * @returns - Runtime-failed popup state.
     */
    private documentStatusFailure(revision: number, hostname: string): PopupState {
        return {
            availability: "ready",
            revision,
            globalEnabled: true,
            hostname,
            siteEnabled: true,
            hasAdapter: true,
            status: "runtime-failed",
            failure: "document-status",
        };
    }
}
