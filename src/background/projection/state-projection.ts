/**
 * @file Popup and sites-state projections derived from background runtime state.
 */
import {
    DOCUMENT_STATUS_MESSAGE,
    DOCUMENT_PHASE,
    readDocumentStatusPhase,
} from "../../shared/messaging/document-messages";
import {
    POPUP_RUNTIME_FAILURE,
    POPUP_STATUS,
    STATE_AVAILABILITY,
    type PopupRuntimeFailure,
    type ReadyPopupStatus,
} from "../../shared/messaging/view-state-values";
import {
    createUnavailablePopupState,
    createUnavailableSitesState,
    type PopupState,
    type SitesState,
} from "../../shared/messaging/view-state";
import { parseHttpUrl } from "../../shared/url/http";
import { isFacebookHostname } from "../../shared/url/facebook";
import {
    SITE_SCOPE_MODE,
    isSiteProcessingEnabled,
    type SiteScopeMode,
} from "../../shared/settings/site-scope";
import type { SettingsSnapshot } from "../../shared/settings/snapshot";
import type { RuntimeTab, TabsRuntime } from "../runtime/tabs";
import type { ReconcileFailure } from "../runtime/document-activation";
import {
    RECONCILE_FAILURE_SCOPE,
    TAB_ACTION,
} from "../runtime/document-activation";
import type { ActivationManager } from "../application/activation-manager";
import type { ApplicationStateView } from "../application/state";
import { APPLICATION_PHASE } from "../application/contracts";
import { settleBrowserOperation } from "../runtime/settle";
import { FACEBOOK_PAYLOAD_BRIDGE_REGISTRATION_ID } from
    "../runtime/register-documents";

/**
 * Maps a reconciliation failure to the popup failure vocabulary.
 *
 * @param failures - Failures observed during the latest reconciliation.
 * @param tabId - Active tab identifier.
 * @param hostname - Active tab's canonical top-level hostname.
 * @returns - Popup failure for the tab, when one exists.
 */
function failureFor(
    failures: readonly ReconcileFailure[],
    tabId: number,
    hostname: string,
): PopupRuntimeFailure | undefined {
    for (const failure of failures) {
        if (failure.scope === RECONCILE_FAILURE_SCOPE.REGISTRATION) {
            if (
                failure.registrationId === FACEBOOK_PAYLOAD_BRIDGE_REGISTRATION_ID
                && !isFacebookHostname(hostname)
            ) {
                continue;
            }
            return POPUP_RUNTIME_FAILURE.REGISTRATION;
        }
        if (failure.scope === RECONCILE_FAILURE_SCOPE.MATCHING_TABS_QUERY) {
            return POPUP_RUNTIME_FAILURE.MATCHING_TABS_QUERY;
        }
        if (failure.tabId === tabId && failure.hostname === hostname) {
            return failure.action === TAB_ACTION.INJECT
                ? POPUP_RUNTIME_FAILURE.CURRENT_TAB_INJECT
                : POPUP_RUNTIME_FAILURE.CURRENT_TAB_TEARDOWN;
        }
    }
    return undefined;
}

/**
 * Maps a disabled hostname to the status explaining which list excluded it.
 *
 * @param mode - Active scope mode.
 * @returns - Ready popup status for a hostname the active mode does not cover.
 */
function coverageStatus(mode: SiteScopeMode): ReadyPopupStatus {
    return mode === SITE_SCOPE_MODE.SELECTED_ONLY
        ? POPUP_STATUS.SITE_NOT_SELECTED
        : POPUP_STATUS.SITE_EXCLUDED;
}

/**
 * Owns active-tab and site-list projections plus a popup cache.
 */
export class StateProjection {
    /**
     * Cached popup projection.
     */
    private popupCache: PopupState | undefined;

    /**
     * Active tab identifier associated with the cache.
     */
    private popupTabId: number | undefined;

    /**
     * Creates projections over tabs and activation state.
     *
     * @param tabs - Browser tab query and messaging boundary.
     * @param activation - Latest universal-runtime reconciliation.
     * @returns - A new state projection.
     */
    public constructor(
        private readonly tabs: TabsRuntime,
        private readonly activation: ActivationManager,
    ) {}

    /**
     * Latest popup projection, when derived.
     *
     * @returns - Cached popup state, when one has been derived.
     */
    public get cachedPopup(): PopupState | undefined {
        return this.popupCache;
    }

    /**
     * Clears cached active-tab state.
     */
    public clear(): void {
        this.popupCache = undefined;
        this.popupTabId = undefined;
    }

    /**
     * Seeds the popup cache after initialization.
     *
     * @param state - Current application state.
     * @returns - Promise settled after the cache is seeded.
     */
    public async seed(state: ApplicationStateView): Promise<void> {
        if (
            !this.popupCache
            && state.phase === APPLICATION_PHASE.READY
            && state.snapshot
        ) {
            this.popupCache = await this.derivePopup(state);
        }
    }

    /**
     * Derives and caches popup state.
     *
     * @param state - Current application state.
     * @returns - Derived popup state.
     */
    public async deriveAndCachePopup(state: ApplicationStateView): Promise<PopupState> {
        const popup = await this.derivePopup(state);
        this.popupCache = popup;
        return popup;
    }

    /**
     * Updates cached policy fields after a settings transition.
     *
     * @param state - Current application state.
     */
    public refreshCachedPopup(state: ApplicationStateView): void {
        const cached = this.popupCache;
        const snapshot = state.snapshot;
        if (!cached || cached.availability !== STATE_AVAILABILITY.READY || !snapshot) {
            return;
        }
        if (cached.hostname === null) {
            this.popupCache = {
                ...cached,
                revision: snapshot.revision,
                globalEnabled: snapshot.globalEnabled,
                siteEnabled: null,
                scopeMode: snapshot.siteScope.mode,
                appearance: snapshot.appearance,
            };
            return;
        }
        const siteEnabled = isSiteProcessingEnabled(snapshot.siteScope, cached.hostname);
        const failure = this.popupTabId === undefined
            ? undefined
            : failureFor(this.activation.result?.failures ?? [], this.popupTabId, cached.hostname);
        let status: ReadyPopupStatus = cached.status;
        if (failure) {
            status = POPUP_STATUS.RUNTIME_FAILED;
        } else if (!snapshot.globalEnabled) {
            status = POPUP_STATUS.GLOBAL_DISABLED;
        } else if (!siteEnabled) {
            status = coverageStatus(snapshot.siteScope.mode);
        } else if (
            status === POPUP_STATUS.GLOBAL_DISABLED
            || status === POPUP_STATUS.SITE_EXCLUDED
            || status === POPUP_STATUS.SITE_NOT_SELECTED
            || status === POPUP_STATUS.RUNTIME_FAILED
        ) {
            status = POPUP_STATUS.ACTIVE;
        }
        this.popupCache = {
            availability: STATE_AVAILABILITY.READY,
            revision: snapshot.revision,
            globalEnabled: snapshot.globalEnabled,
            hostname: cached.hostname,
            siteEnabled,
            scopeMode: snapshot.siteScope.mode,
            appearance: snapshot.appearance,
            status,
            ...(failure ? { failure } : {}),
        };
    }

    /**
     * Derives popup state from active tab, settings, and frame-zero status.
     *
     * @param state - Current application state.
     * @returns - Derived popup state.
     */
    public async derivePopup(state: ApplicationStateView): Promise<PopupState> {
        const snapshot = state.snapshot;
        if (state.phase !== APPLICATION_PHASE.READY || !snapshot) {
            return this.unavailablePopup(state);
        }
        const current = await this.activeTab();
        this.popupTabId = current.tab?.id;
        if (current.error) {
            return {
                availability: STATE_AVAILABILITY.READY,
                revision: snapshot.revision,
                globalEnabled: snapshot.globalEnabled,
                hostname: null,
                siteEnabled: null,
                scopeMode: snapshot.siteScope.mode,
                appearance: snapshot.appearance,
                status: POPUP_STATUS.RUNTIME_FAILED,
                failure: POPUP_RUNTIME_FAILURE.CURRENT_TAB_QUERY,
            };
        }
        const url = parseHttpUrl(current.tab?.url);
        if (!url || !url.hostname) {
            return {
                availability: STATE_AVAILABILITY.READY,
                revision: snapshot.revision,
                globalEnabled: snapshot.globalEnabled,
                hostname: null,
                siteEnabled: null,
                scopeMode: snapshot.siteScope.mode,
                appearance: snapshot.appearance,
                status: POPUP_STATUS.INACCESSIBLE,
            };
        }
        const siteEnabled = isSiteProcessingEnabled(snapshot.siteScope, url.hostname);
        const failure = current.tab === undefined
            ? POPUP_RUNTIME_FAILURE.CURRENT_TAB_QUERY
            : failureFor(this.activation.result?.failures ?? [], current.tab.id, url.hostname);
        if (failure) {
            return this.ready(snapshot, url.hostname, siteEnabled, {
                status: POPUP_STATUS.RUNTIME_FAILED,
                failure,
            });
        }
        if (!snapshot.globalEnabled) {
            return this.ready(snapshot, url.hostname, siteEnabled, {
                status: POPUP_STATUS.GLOBAL_DISABLED,
            });
        }
        if (!siteEnabled) {
            return this.ready(snapshot, url.hostname, false, {
                status: coverageStatus(snapshot.siteScope.mode),
            });
        }
        if (current.tab === undefined) {
            return this.ready(snapshot, url.hostname, true, {
                status: POPUP_STATUS.RUNTIME_FAILED,
                failure: POPUP_RUNTIME_FAILURE.CURRENT_TAB_QUERY,
            });
        }
        const tabId = current.tab.id;
        const status = await settleBrowserOperation(
            () => this.tabs.sendMessage(
                tabId,
                { type: DOCUMENT_STATUS_MESSAGE },
                { frameId: 0 },
            ),
        );
        const phase = status.ok ? readDocumentStatusPhase(status.value) : undefined;
        if (phase !== DOCUMENT_PHASE.WAITING && phase !== DOCUMENT_PHASE.ACTIVE) {
            return this.ready(snapshot, url.hostname, true, {
                status: POPUP_STATUS.RUNTIME_FAILED,
                failure: POPUP_RUNTIME_FAILURE.DOCUMENT_STATUS,
            });
        }
        return this.ready(snapshot, url.hostname, true, { status: POPUP_STATUS.ACTIVE });
    }

    /**
     * Derives the scope mode and both retained hostname lists.
     *
     * @param state - Current application state.
     * @returns - Derived sites state.
     */
    public deriveSites(state: ApplicationStateView): SitesState {
        const snapshot = state.snapshot;
        if (state.phase !== APPLICATION_PHASE.READY || !snapshot) {
            return this.unavailableSites(state);
        }
        return {
            availability: STATE_AVAILABILITY.READY,
            revision: snapshot.revision,
            globalEnabled: snapshot.globalEnabled,
            scopeMode: snapshot.siteScope.mode,
            excludedSites: [...snapshot.siteScope.excludedSites],
            allowedSites: [...snapshot.siteScope.allowedSites],
        };
    }

    /**
     * Builds an unavailable popup state.
     *
     * @param state - Current application state.
     * @returns - Unavailable popup state.
     */
    public unavailablePopup(state: ApplicationStateView): PopupState {
        return createUnavailablePopupState(state.failure);
    }

    /**
     * Queries the active tab using the narrow tabs capability.
     *
     * @returns - Active runtime tab and whether the query failed.
     */
    private async activeTab(): Promise<{
        readonly tab: RuntimeTab | undefined;
        readonly error: boolean;
    }> {
        const result = await settleBrowserOperation(
            () => this.tabs.query({ active: true, currentWindow: true }),
        );
        if (!result.ok) {
            return { tab: undefined, error: true };
        }
        return { tab: result.value[0], error: false };
    }

    /**
     * Builds an unavailable sites projection.
     *
     * @param state - Current application state.
     * @returns - Unavailable sites state.
     */
    private unavailableSites(state: ApplicationStateView): SitesState {
        return createUnavailableSitesState(state.failure);
    }

    /**
     * Builds a ready popup projection.
     *
     * @param snapshot - Authoritative settings snapshot.
     * @param hostname - Active tab hostname.
     * @param siteEnabled - Effective site activation state.
     * @param outcome - Popup status and optional failure.
     * @param outcome.status - Ready popup status.
     * @param outcome.failure - Optional runtime failure.
     * @returns - Ready popup state.
     */
    private ready(
        snapshot: SettingsSnapshot,
        hostname: string,
        siteEnabled: boolean,
        outcome: { readonly status: ReadyPopupStatus; readonly failure?: PopupRuntimeFailure },
    ): PopupState {
        return {
            availability: STATE_AVAILABILITY.READY,
            revision: snapshot.revision,
            globalEnabled: snapshot.globalEnabled,
            hostname,
            siteEnabled,
            scopeMode: snapshot.siteScope.mode,
            appearance: snapshot.appearance,
            status: outcome.status,
            ...(outcome.failure ? { failure: outcome.failure } : {}),
        };
    }
}
