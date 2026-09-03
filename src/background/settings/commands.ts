/**
 * @file Serialized settings mutations and their runtime side effects.
 */

import type {
    SettingsPersistence,
    SettingsWriteFailure,
    SettingsWriteResult,
    SettingsWriteSuccess,
} from "./service";
import type { Appearance, DisplaySettings } from "../../shared/settings/snapshot";
import { isCanonicalHostname } from "../../shared/settings/hostname";
import type { SiteScopeMode } from "../../shared/settings/site-scope";
import type { ApplicationLifecycle } from "../application/lifecycle";
import type { DiagnosticsService } from "../diagnostics/service";
import { deriveDisplayState } from "../projection/display-state";
import type { DocumentRefresh } from "./document-refresh";
import type { StateProjection } from "../projection/state-projection";
import { ACTIVATION_POLICY } from "../runtime/document-activation";
import {
    APPLICATION_PHASE,
    LIFECYCLE_REASON,
    type SettingsBroadcast,
} from "../application/contracts";
import {
    DISPLAY_SETTINGS_ERROR,
    SETTINGS_PERSISTENCE_ERROR,
    SITE_SETTINGS_ERROR,
    SITE_SETTINGS_SURFACE,
    STATE_AVAILABILITY,
    type SettingsPersistenceError,
    type SiteSettingsSurface,
} from "../../shared/messaging/view-state-values";
import type {
    RefreshFailure,
    PopupState,
    SitesState,
} from "../../shared/messaging/view-state-schemas";
import type {
    ResetAllSettingsResponse,
    SetAppearanceResponse,
    SetDebugEnabledResponse,
    SetDisplaySettingsResponse,
    SetGlobalEnabledResponse,
    SetSiteEnabledResponse,
    SetSiteScopeModeResponse,
} from "../../shared/messaging/response-schemas";
import {
    DIAGNOSTIC_CATEGORY,
    DIAGNOSTIC_REASON,
} from "../../shared/diagnostics/contracts";

/**
 * Outcome of one serialized write: the committed revision or the error to report.
 */
interface WriteOutcome<TError extends string> {
    /**
     * Revision committed by the write, when it succeeded.
     */
    readonly acceptedRevision: number | undefined;

    /**
     * Error to report, when the write did not succeed.
     */
    readonly error: TError | SettingsPersistenceError | undefined;
}

/**
 * Applies persisted settings changes and coordinates their runtime effects.
 */
export class SettingsCommands {
    /**
     * Settings persistence boundary.
     */
    private readonly settings: SettingsPersistence;

    /**
     * Authoritative lifecycle and runtime reconciliation state.
     */
    private readonly lifecycle: ApplicationLifecycle;

    /**
     * Popup and sites-state projection service.
     */
    private readonly projection: StateProjection;

    /**
     * Diagnostic journal service.
     */
    private readonly diagnostics: DiagnosticsService;

    /**
     * Active-document settings broadcaster.
     */
    private readonly documentRefresh: DocumentRefresh;

    /**
     * Optional announcer for committed settings revisions.
     */
    private readonly broadcast: SettingsBroadcast | undefined;

    /**
     * Creates the settings command handler.
     *
     * @param settings - Settings persistence boundary.
     * @param lifecycle - Authoritative lifecycle coordinator.
     * @param projection - Popup and sites-state projections.
     * @param diagnostics - Diagnostic journal service.
     * @param documentRefresh - Active-document settings broadcaster.
     * @param broadcast - Optional announcer for committed settings revisions.
     */
    public constructor(
        settings: SettingsPersistence,
        lifecycle: ApplicationLifecycle,
        projection: StateProjection,
        diagnostics: DiagnosticsService,
        documentRefresh: DocumentRefresh,
        broadcast?: SettingsBroadcast,
    ) {
        this.settings = settings;
        this.lifecycle = lifecycle;
        this.projection = projection;
        this.diagnostics = diagnostics;
        this.documentRefresh = documentRefresh;
        this.broadcast = broadcast;
    }

    /**
     * Persists diagnostic logging and refreshes matching enabled-site tabs.
     *
     * @param enabled - Requested diagnostic logging state.
     * @returns - Persisted state and document refresh failures.
     */
    public async setDebugEnabled(enabled: boolean): Promise<SetDebugEnabledResponse> {
        let refreshFailures: readonly RefreshFailure[] = [];
        const outcome = await this.runWrite<never>(
            () => this.settings.setDebugEnabled(enabled),
            () => undefined,
            async (write) => {
                this.lifecycle.advanceReconcileRevision(write.snapshot.revision);
                if (!write.changed) {
                    return;
                }
                if (enabled) {
                    await this.diagnostics.setEnabled(true);
                }
                refreshFailures = await this.documentRefresh.refreshDebugPolicy(
                    write.snapshot,
                    enabled,
                    write.snapshot.revision,
                );
                if (!enabled) {
                    await this.diagnostics.setEnabled(false);
                }
            },
        );
        const state = await this.finish(outcome, () =>
            this.diagnostics.debugState(this.lifecycle.state));
        if (outcome.error !== undefined || outcome.acceptedRevision === undefined) {
            return {
                ok: false,
                error: outcome.error ?? SETTINGS_PERSISTENCE_ERROR.SETTINGS_UNAVAILABLE,
                state,
            };
        }
        return {
            ok: true,
            acceptedRevision: outcome.acceptedRevision,
            state,
            ...(refreshFailures.length === 0 ? {} : { refreshFailures }),
        };
    }

    /**
     * Validates and persists display settings, then refreshes enabled-site tabs.
     *
     * @param display - Typed display settings payload.
     * @returns - Persisted display state and document refresh failures.
     */
    public async setDisplaySettings(
        display: DisplaySettings,
    ): Promise<SetDisplaySettingsResponse> {
        let refreshFailures: readonly RefreshFailure[] = [];
        const outcome = await this.runWrite(
            () => this.settings.setDisplaySettings(display),
            (write) =>
                write.error === DISPLAY_SETTINGS_ERROR.INVALID_FORMAT
                || write.error === DISPLAY_SETTINGS_ERROR.INVALID_TIME_ZONE
                || write.error === DISPLAY_SETTINGS_ERROR.INVALID_DISPLAY_SETTINGS
                    ? write.error
                    : undefined,
            async (write) => {
                this.lifecycle.advanceReconcileRevision(write.snapshot.revision);
                if (write.changed) {
                    refreshFailures = await this.documentRefresh.refreshDisplay(
                        write.snapshot,
                        write.snapshot.display,
                        write.snapshot.revision,
                    );
                }
            },
        );
        const state = await this.finish(outcome, () => deriveDisplayState(this.lifecycle.state));
        if (outcome.error !== undefined || outcome.acceptedRevision === undefined) {
            return {
                ok: false,
                error: outcome.error ?? SETTINGS_PERSISTENCE_ERROR.SETTINGS_UNAVAILABLE,
                state,
            };
        }
        return { ok: true, acceptedRevision: outcome.acceptedRevision, state, refreshFailures };
    }

    /**
     * Persists the appearance applied to both extension surfaces.
     *
     * @param appearance - Requested appearance.
     * @returns - Persisted display state carrying the appearance.
     */
    public async setAppearance(appearance: Appearance): Promise<SetAppearanceResponse> {
        const outcome = await this.runWrite<never>(
            () => this.settings.setAppearance(appearance),
            () => undefined,
            (write) => {
                this.lifecycle.advanceReconcileRevision(write.snapshot.revision);
                return Promise.resolve();
            },
        );
        const state = await this.finish(outcome, () => deriveDisplayState(this.lifecycle.state));
        if (outcome.error !== undefined || outcome.acceptedRevision === undefined) {
            return {
                ok: false,
                error: outcome.error ?? SETTINGS_PERSISTENCE_ERROR.SETTINGS_UNAVAILABLE,
                state,
            };
        }
        return { ok: true, acceptedRevision: outcome.acceptedRevision, state };
    }

    /**
     * Restores defaults, clears diagnostics, and reconciles runtime activation.
     *
     * @returns - Reset result and default site state.
     */
    public async resetAllSettings(): Promise<ResetAllSettingsResponse> {
        await this.prepare();
        let acceptedRevision: number | undefined;
        const outcome: { error: SettingsPersistenceError | undefined } = { error: undefined };
        await this.lifecycle.enqueue(async () => {
            const previous = this.lifecycle.phase === APPLICATION_PHASE.READY
                ? this.lifecycle.snapshot
                : undefined;
            const write = await this.settings.resetAll();
            if (!write.ok) {
                outcome.error = SETTINGS_PERSISTENCE_ERROR.SAVE_FAILED;
                if (
                    this.lifecycle.phase === APPLICATION_PHASE.READY
                    && this.lifecycle.snapshot
                ) {
                    return;
                }
                await this.lifecycle.enterFailedClosed(true);
                this.projection.clear();
                return;
            }
            this.lifecycle.markReady(write.snapshot);
            acceptedRevision = write.snapshot.revision;
            this.lifecycle.clearReconcileResult();
            if (previous?.globalEnabled) {
                await this.lifecycle.reconcile(
                    ACTIVATION_POLICY.DISABLED,
                    write.snapshot.revision,
                    previous.siteScope,
                );
            }
            await this.diagnostics.reset();
            await this.lifecycle.reconcile(
                write.snapshot.globalEnabled
                    ? ACTIVATION_POLICY.ENABLED
                    : ACTIVATION_POLICY.DISABLED,
                write.snapshot.revision,
                write.snapshot.siteScope,
            );
            this.lifecycle.clearLifecycleReasons();
            this.projection.clear();
            await this.projection.seed(this.lifecycle.state);
        });
        const state = await this.lifecycle.enqueue(() =>
            Promise.resolve(this.projection.deriveSites(this.lifecycle.state)),
        );
        this.announce(acceptedRevision);
        if (acceptedRevision !== undefined && state.availability === STATE_AVAILABILITY.READY) {
            return { ok: true, acceptedRevision, state };
        }
        return {
            ok: false,
            error: outcome.error ?? SETTINGS_PERSISTENCE_ERROR.SETTINGS_UNAVAILABLE,
            state,
        };
    }

    /**
     * Persists global activation and reconciles the universal document runtime.
     *
     * @param enabled - Requested global activation state.
     * @param surface - Response projection requested by the caller.
     * @returns - Persisted global state and the popup or sites projection.
     */
    public async setGlobalEnabled(
        enabled: boolean,
        surface: SiteSettingsSurface,
    ): Promise<SetGlobalEnabledResponse> {
        const outcome = await this.runWrite<never>(
            () => this.settings.setGlobalEnabled(enabled),
            () => undefined,
            async (write) => {
                await this.lifecycle.reconcile(
                    write.snapshot.globalEnabled
                        ? ACTIVATION_POLICY.ENABLED
                        : ACTIVATION_POLICY.DISABLED,
                    write.snapshot.revision,
                    write.snapshot.siteScope,
                );
            },
        );
        const state = await this.finish(outcome, () => this.deriveSurface(surface));
        if (outcome.error !== undefined || outcome.acceptedRevision === undefined) {
            const error = outcome.error ?? SETTINGS_PERSISTENCE_ERROR.SETTINGS_UNAVAILABLE;
            return surface === SITE_SETTINGS_SURFACE.POPUP
                ? { ok: false, error, surface, state: state as PopupState }
                : { ok: false, error, surface, state: state as SitesState };
        }
        const acceptedRevision = outcome.acceptedRevision;
        return surface === SITE_SETTINGS_SURFACE.POPUP
            ? { ok: true, acceptedRevision, surface, state: state as PopupState }
            : { ok: true, acceptedRevision, surface, state: state as SitesState };
    }

    /**
     * Persists the active scope mode and reconciles every matching document.
     *
     * @param mode - Requested scope mode.
     * @returns - Persisted sites state for the settings page.
     */
    public async setSiteScopeMode(mode: SiteScopeMode): Promise<SetSiteScopeModeResponse> {
        const outcome = await this.runWrite<never>(
            () => this.settings.setSiteScopeMode(mode),
            () => undefined,
            (write) => this.reconcileSites(write),
        );
        const state = await this.finish(outcome, () =>
            this.projection.deriveSites(this.lifecycle.state));
        if (outcome.error !== undefined || outcome.acceptedRevision === undefined) {
            return {
                ok: false,
                error: outcome.error ?? SETTINGS_PERSISTENCE_ERROR.SETTINGS_UNAVAILABLE,
                state,
            };
        }
        return { ok: true, acceptedRevision: outcome.acceptedRevision, state };
    }

    /**
     * Applies one hostname decision to the list the active scope mode owns and
     * reconciles affected documents.
     *
     * @param hostname - Canonical hostname whose processing state changes.
     * @param enabled - Whether processing should apply to the hostname.
     * @param mode - Scope mode the caller rendered when it made the decision.
     * @param surface - Response projection requested by the caller.
     * @returns - Persisted update and popup or sites state.
     */
    public async setSiteEnabled(
        hostname: string,
        enabled: boolean,
        mode: SiteScopeMode,
        surface: SiteSettingsSurface,
    ): Promise<SetSiteEnabledResponse> {
        if (!isCanonicalHostname(hostname)) {
            await this.prepare();
            const state = surface === SITE_SETTINGS_SURFACE.POPUP
                ? (this.projection.cachedPopup
                    ?? this.projection.unavailablePopup(this.lifecycle.state))
                : this.projection.deriveSites(this.lifecycle.state);
            const error = SITE_SETTINGS_ERROR.INVALID_HOSTNAME;
            return surface === SITE_SETTINGS_SURFACE.POPUP
                ? { ok: false, error, surface, state: state as PopupState }
                : { ok: false, error, surface, state: state as SitesState };
        }
        const outcome = await this.runWrite(
            () => this.settings.setSiteEnabled(hostname, enabled, mode),
            (write) =>
                write.error === SITE_SETTINGS_ERROR.INVALID_HOSTNAME
                || write.error === SITE_SETTINGS_ERROR.LIST_FULL
                || write.error === SITE_SETTINGS_ERROR.SCOPE_CHANGED
                    ? write.error
                    : undefined,
            (write) => this.reconcileSites(write, [hostname]),
        );
        const state = await this.finish(outcome, () => this.deriveSurface(surface));
        if (outcome.error !== undefined || outcome.acceptedRevision === undefined) {
            const error = outcome.error ?? SETTINGS_PERSISTENCE_ERROR.SETTINGS_UNAVAILABLE;
            return surface === SITE_SETTINGS_SURFACE.POPUP
                ? { ok: false, error, surface, state: state as PopupState }
                : { ok: false, error, surface, state: state as SitesState };
        }
        const acceptedRevision = outcome.acceptedRevision;
        return surface === SITE_SETTINGS_SURFACE.POPUP
            ? { ok: true, acceptedRevision, surface, state: state as PopupState }
            : { ok: true, acceptedRevision, surface, state: state as SitesState };
    }

    /**
     * Runs one serialized settings write behind the READY guard, maps its
     * failure, adopts the committed snapshot, runs the command's own follow-up,
     * and records the change.
     *
     * @param write - Persistence call to run once the application is ready.
     * @param domainError - Maps a rejected write to a command-specific error, or
     * undefined when the rejection is a persistence failure.
     * @param onCommitted - Command-specific runtime effect for a committed write.
     * @returns - Committed revision or the error to report.
     */
    private async runWrite<TError extends string>(
        write: () => Promise<SettingsWriteResult>,
        domainError: (write: SettingsWriteFailure) => TError | undefined,
        onCommitted: (write: SettingsWriteSuccess) => Promise<void>,
    ): Promise<WriteOutcome<TError>> {
        await this.prepare();
        let acceptedRevision: number | undefined;
        let error: TError | SettingsPersistenceError | undefined;
        await this.lifecycle.enqueue(async () => {
            if (this.lifecycle.phase !== APPLICATION_PHASE.READY || !this.lifecycle.snapshot) {
                error = SETTINGS_PERSISTENCE_ERROR.SETTINGS_UNAVAILABLE;
                return;
            }
            const result = await write();
            if (!result.ok) {
                const mapped = domainError(result);
                if (mapped !== undefined) {
                    error = mapped;
                } else if (this.settings.lastLoadError) {
                    error = SETTINGS_PERSISTENCE_ERROR.SETTINGS_UNAVAILABLE;
                    await this.lifecycle.enterFailedClosed();
                } else {
                    error = SETTINGS_PERSISTENCE_ERROR.SAVE_FAILED;
                }
                return;
            }
            this.lifecycle.adoptSnapshot(result.snapshot);
            acceptedRevision = result.snapshot.revision;
            await onCommitted(result);
            this.projection.refreshCachedPopup(this.lifecycle.state);
            if (result.changed) {
                this.diagnostics.log(
                    {
                        category: DIAGNOSTIC_CATEGORY.SETTINGS,
                        reason: DIAGNOSTIC_REASON.SETTINGS_UPDATED,
                        count: 1,
                    },
                    this.lifecycle.state,
                );
            }
        });
        return { acceptedRevision, error };
    }

    /**
     * Derives the response projection after a write and announces its revision.
     *
     * @param outcome - Outcome of the serialized write.
     * @param derive - Projection derived under the lifecycle queue.
     * @returns - Derived projection.
     */
    private async finish<TState>(
        outcome: WriteOutcome<string>,
        derive: () => TState | Promise<TState>,
    ): Promise<TState> {
        const state = await this.lifecycle.enqueue(() => Promise.resolve(derive()));
        this.announce(outcome.acceptedRevision);
        return state;
    }

    /**
     * Reconciles documents after a site-scope change when processing is on.
     *
     * @param write - Committed site-scope write.
     * @param hostnames - Hostnames whose documents must be revisited, when limited.
     * @returns - Promise settled after reconciliation or revision advance.
     */
    private async reconcileSites(
        write: SettingsWriteSuccess,
        hostnames?: readonly string[],
    ): Promise<void> {
        if (write.snapshot.globalEnabled && write.changed) {
            await this.lifecycle.reconcile(
                ACTIVATION_POLICY.ENABLED,
                write.snapshot.revision,
                write.snapshot.siteScope,
                hostnames,
            );
            return;
        }
        this.lifecycle.advanceReconcileRevision(write.snapshot.revision);
    }

    /**
     * Derives the popup or sites projection requested by a caller.
     *
     * @param surface - Requested response surface.
     * @returns - Popup or sites projection.
     */
    private deriveSurface(surface: SiteSettingsSurface): Promise<PopupState | SitesState> {
        return surface === SITE_SETTINGS_SURFACE.POPUP
            ? this.projection.deriveAndCachePopup(this.lifecycle.state)
            : Promise.resolve(this.projection.deriveSites(this.lifecycle.state));
    }

    /**
     * Announces a committed revision. The broadcaster contains delivery failure itself.
     *
     * @param revision - Committed settings revision, when a write succeeded.
     */
    private announce(revision: number | undefined): void {
        if (revision !== undefined) {
            this.broadcast?.settingsChanged(revision);
        }
    }

    /**
     * Initializes the application and drains pending lifecycle work before a command.
     */
    private async prepare(): Promise<void> {
        await this.lifecycle.ensureReady(LIFECYCLE_REASON.COLD_WORKER);
        await this.lifecycle.drainLifecycle();
    }
}
