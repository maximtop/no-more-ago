/**
 * @file Serialized settings mutations and their runtime side effects.
 */

import type { RuntimeAdapterDefinition } from "../runtime/adapter-activation";
import type { SettingsService } from "./service";
import { isCanonicalHostname, isSiteEnabled } from "../../shared/settings/snapshot";
import type { ApplicationLifecycle } from "../application/lifecycle";
import type { DiagnosticsService } from "../diagnostics/service";
import { deriveDisplayState } from "../projection/display-state";
import type { DocumentRefresh } from "./document-refresh";
import type { StateProjection } from "../projection/state-projection";
import {
    type DebugRefreshFailure,
    type DisplayRefreshFailure,
    type PopupState,
    type ResetAllSettingsResponse,
    type SetDebugEnabledResponse,
    type SetDisplaySettingsResponse,
    type SetGlobalEnabledResponse,
    type SetSiteEnabledResponse,
    type SitesState,
    SITE_SETTINGS_SURFACE,
    type SiteSettingsSurface,
} from "../../shared/messages";

/**
 * Applies persisted settings changes and coordinates their runtime effects.
 */
export class SettingsCommands {
    /**
     * Settings persistence boundary.
     */
    private readonly settings: SettingsService;

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
     * Immutable runtime adapter catalog.
     */
    private readonly adapters: readonly RuntimeAdapterDefinition[];

    /**
     * Creates the settings command handler.
     *
     * @param settings - Settings persistence boundary.
     * @param lifecycle - Authoritative lifecycle coordinator.
     * @param projection - Popup and sites-state projections.
     * @param diagnostics - Diagnostic journal service.
     * @param documentRefresh - Active-document settings broadcaster.
     * @param adapters - Runtime adapter catalog.
     */
    public constructor(
        settings: SettingsService,
        lifecycle: ApplicationLifecycle,
        projection: StateProjection,
        diagnostics: DiagnosticsService,
        documentRefresh: DocumentRefresh,
        adapters: readonly RuntimeAdapterDefinition[],
    ) {
        this.settings = settings;
        this.lifecycle = lifecycle;
        this.projection = projection;
        this.diagnostics = diagnostics;
        this.documentRefresh = documentRefresh;
        this.adapters = adapters;
    }

    /**
     * Persists diagnostic logging and refreshes matching enabled-site tabs.
     *
     * @param enabled - Requested diagnostic logging state.
     * @returns - Persisted state and document refresh failures.
     */
    public async setDebugEnabled(enabled: boolean): Promise<SetDebugEnabledResponse> {
        await this.prepare();
        let acceptedRevision: number | undefined;
        let refreshFailures: readonly DebugRefreshFailure[] = [];
        let error: "save-failed" | "settings-unavailable" | undefined;
        await this.lifecycle.enqueue(async () => {
            const snapshot = this.lifecycle.snapshot;
            if (this.lifecycle.phase !== "ready" || !snapshot) {
                error = "settings-unavailable";
                return;
            }
            const write = await this.settings.setDebugEnabled(enabled);
            if (!write.ok) {
                error = this.settings.lastLoadError ? "settings-unavailable" : "save-failed";
                if (this.settings.lastLoadError) {
                    await this.lifecycle.enterFailedClosed();
                }
                return;
            }
            this.lifecycle.adoptSnapshot(write.snapshot);
            acceptedRevision = write.snapshot.revision;
            this.lifecycle.advanceReconcileRevision(write.snapshot.revision);
            if (!write.changed) {
                return;
            }
            if (enabled) {
                await this.diagnostics.setEnabled(true);
                this.diagnostics.log(
                    { category: "settings", reason: "settings-updated", count: 1 },
                    this.lifecycle.state,
                );
            }
            refreshFailures = await this.documentRefresh.refreshDebugPolicy(
                write.snapshot,
                enabled,
                write.snapshot.revision,
            );
            if (!enabled) {
                await this.diagnostics.setEnabled(false);
            }
            this.projection.refreshCachedPopup(this.lifecycle.state);
        });
        const state = await this.lifecycle.enqueue(() =>
            Promise.resolve(this.diagnostics.debugState(this.lifecycle.state)),
        );
        if (error !== undefined) {
            return { ok: false, error, state };
        }
        if (acceptedRevision === undefined) {
            return { ok: false, error: "settings-unavailable", state };
        }
        return {
            ok: true,
            acceptedRevision,
            state,
            ...(refreshFailures.length === 0 ? {} : { refreshFailures }),
        };
    }

    /**
     * Validates and persists display settings, then refreshes enabled-site tabs.
     *
     * @param display - Untrusted display settings payload.
     * @returns - Persisted display state and document refresh failures.
     */
    public async setDisplaySettings(display: unknown): Promise<SetDisplaySettingsResponse> {
        await this.prepare();
        let acceptedRevision: number | undefined;
        let refreshFailures: readonly DisplayRefreshFailure[] = [];
        let error:
            | "invalid-format"
            | "invalid-time-zone"
            | "invalid-display-settings"
            | "save-failed"
            | "settings-unavailable"
            | undefined;
        await this.lifecycle.enqueue(async () => {
            const snapshot = this.lifecycle.snapshot;
            if (this.lifecycle.phase !== "ready" || !snapshot) {
                error = "settings-unavailable";
                return;
            }
            const write = await this.settings.setDisplaySettings(display);
            if (!write.ok) {
                error =
                    write.error === "invalid-format"
                    || write.error === "invalid-time-zone"
                    || write.error === "invalid-display-settings"
                        ? write.error
                        : this.settings.lastLoadError
                            ? "settings-unavailable"
                            : "save-failed";
                if (this.settings.lastLoadError) {
                    await this.lifecycle.enterFailedClosed();
                }
                return;
            }
            this.lifecycle.adoptSnapshot(write.snapshot);
            acceptedRevision = write.snapshot.revision;
            this.lifecycle.advanceReconcileRevision(acceptedRevision);
            if (write.changed) {
                refreshFailures = await this.documentRefresh.refreshDisplay(
                    write.snapshot,
                    write.snapshot.display,
                    acceptedRevision,
                );
                this.diagnostics.log(
                    { category: "settings", reason: "settings-updated", count: 1 },
                    this.lifecycle.state,
                );
            }
            this.projection.refreshCachedPopup(this.lifecycle.state);
        });
        const state = await this.lifecycle.enqueue(() =>
            Promise.resolve(deriveDisplayState(this.lifecycle.state)),
        );
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
     *
     * @returns - Reset result and default site state.
     */
    public async resetAllSettings(): Promise<ResetAllSettingsResponse> {
        await this.prepare();
        let acceptedRevision: number | undefined;
        const outcome: { value: "accepted" | "save-failed" } = { value: "accepted" };
        await this.lifecycle.enqueue(async () => {
            const previous = this.lifecycle.phase === "ready"
                ? this.lifecycle.snapshot
                : undefined;
            const write = await this.settings.resetAll();
            if (!write.ok) {
                outcome.value = "save-failed";
                if (this.lifecycle.phase === "ready" && this.lifecycle.snapshot) {
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
                    "settings-change",
                    "disabled",
                    write.snapshot.revision,
                    previous.sitePreferences,
                );
            }
            await this.diagnostics.reset();
            await this.lifecycle.reconcile(
                "activation-sweep",
                write.snapshot.globalEnabled ? "enabled" : "disabled",
                write.snapshot.revision,
                write.snapshot.sitePreferences,
            );
            this.lifecycle.clearLifecycleReasons();
            this.projection.clear();
            await this.projection.seed(this.lifecycle.state);
        });
        const state = await this.lifecycle.enqueue(() =>
            Promise.resolve(this.projection.deriveSites(this.lifecycle.state)),
        );
        if (acceptedRevision !== undefined && state.availability === "ready") {
            return { ok: true, acceptedRevision, state };
        }
        return {
            ok: false,
            error: outcome.value === "save-failed" ? "save-failed" : "settings-unavailable",
            state,
        };
    }

    /**
     * Persists global activation and reconciles every runtime adapter.
     *
     * @param enabled - Requested global activation state.
     * @returns - Persisted global state and popup projection.
     */
    public async setGlobalEnabled(enabled: boolean): Promise<SetGlobalEnabledResponse> {
        await this.prepare();
        let acceptedRevision: number | undefined;
        let error: "save-failed" | "settings-unavailable" | undefined;
        await this.lifecycle.enqueue(async () => {
            const snapshot = this.lifecycle.snapshot;
            if (this.lifecycle.phase !== "ready" || !snapshot) {
                error = "settings-unavailable";
                return;
            }
            const write = await this.settings.setGlobalEnabled(enabled);
            if (!write.ok) {
                if (this.settings.lastLoadError) {
                    error = "settings-unavailable";
                    await this.lifecycle.enterFailedClosed();
                } else {
                    error = "save-failed";
                }
                return;
            }
            this.lifecycle.adoptSnapshot(write.snapshot);
            acceptedRevision = write.snapshot.revision;
            await this.lifecycle.reconcile(
                "settings-change",
                write.snapshot.globalEnabled ? "enabled" : "disabled",
                write.snapshot.revision,
                write.snapshot.sitePreferences,
            );
            if (write.changed) {
                this.diagnostics.log(
                    { category: "settings", reason: "settings-updated", count: 1 },
                    this.lifecycle.state,
                );
            }
        });
        const state = await this.lifecycle.enqueue(() =>
            this.projection.deriveAndCachePopup(this.lifecycle.state),
        );
        if (error === undefined && acceptedRevision !== undefined) {
            return { ok: true, acceptedRevision, state };
        }
        return { ok: false, error: error ?? "settings-unavailable", state };
    }

    /**
     * Persists one hostname preference and reconciles affected adapters.
     *
     * @param hostname - Canonical hostname whose override is changing.
     * @param enabled - Requested site activation state.
     * @param surface - Response projection requested by the caller.
     * @returns - Persisted update and popup or sites state.
     */
    public async setSiteEnabled(
        hostname: string,
        enabled: boolean,
        surface: SiteSettingsSurface,
    ): Promise<SetSiteEnabledResponse> {
        await this.prepare();
        let acceptedRevision: number | undefined;
        let error:
            | "save-failed"
            | "invalid-hostname"
            | "settings-unavailable"
            | undefined;
        await this.lifecycle.enqueue(async () => {
            const snapshot = this.lifecycle.snapshot;
            if (this.lifecycle.phase !== "ready" || !snapshot) {
                error = "settings-unavailable";
                return;
            }
            if (!isCanonicalHostname(hostname)) {
                error = "invalid-hostname";
                return;
            }
            const write = await this.settings.setSiteEnabled(hostname, enabled);
            if (!write.ok) {
                error = write.error === "invalid-hostname"
                    ? "invalid-hostname"
                    : this.settings.lastLoadError
                        ? "settings-unavailable"
                        : "save-failed";
                if (this.settings.lastLoadError) {
                    await this.lifecycle.enterFailedClosed();
                }
                return;
            }
            this.lifecycle.adoptSnapshot(write.snapshot);
            acceptedRevision = write.snapshot.revision;
            const affected = this.adapters
                .filter((adapter) => adapter.hostname === hostname)
                .filter((adapter) => {
                    const before = isSiteEnabled(snapshot.sitePreferences, adapter.hostname);
                    const after = isSiteEnabled(
                        write.snapshot.sitePreferences,
                        adapter.hostname,
                    );
                    return before !== after
                        || (
                            write.snapshot.globalEnabled
                            && this.lifecycle.hasAdapterFailure(adapter.id)
                        );
                })
                .map((adapter) => adapter.hostname);
            if (write.snapshot.globalEnabled && affected.length > 0) {
                await this.lifecycle.reconcile(
                    "settings-change",
                    "enabled",
                    write.snapshot.revision,
                    write.snapshot.sitePreferences,
                    affected,
                );
            } else {
                this.lifecycle.advanceReconcileRevision(write.snapshot.revision);
            }
            this.projection.refreshCachedPopup(this.lifecycle.state);
            if (write.changed) {
                this.diagnostics.log(
                    { category: "settings", reason: "settings-updated", count: 1 },
                    this.lifecycle.state,
                );
            }
        });
        if (error === "invalid-hostname") {
            const state = surface === SITE_SETTINGS_SURFACE.POPUP
                ? (this.projection.cachedPopup
                    ?? this.projection.unavailablePopup(this.lifecycle.state))
                : this.projection.deriveSites(this.lifecycle.state);
            return surface === SITE_SETTINGS_SURFACE.POPUP
                ? { ok: false, error, surface, state: state as PopupState }
                : { ok: false, error, surface, state: state as SitesState };
        }
        const state = await this.lifecycle.enqueue(async () =>
            surface === SITE_SETTINGS_SURFACE.POPUP
                ? this.projection.deriveAndCachePopup(this.lifecycle.state)
                : this.projection.deriveSites(this.lifecycle.state),
        );
        if (error === undefined && acceptedRevision !== undefined) {
            return surface === SITE_SETTINGS_SURFACE.POPUP
                ? { ok: true, acceptedRevision, surface, state: state as PopupState }
                : { ok: true, acceptedRevision, surface, state: state as SitesState };
        }
        const responseError = error ?? "settings-unavailable";
        return surface === SITE_SETTINGS_SURFACE.POPUP
            ? { ok: false, error: responseError, surface, state: state as PopupState }
            : { ok: false, error: responseError, surface, state: state as SitesState };
    }

    /**
     * Initializes the application and drains pending lifecycle work before a command.
     */
    private async prepare(): Promise<void> {
        await this.lifecycle.ensureReady("cold-worker");
        await this.lifecycle.drainLifecycle();
    }
}
