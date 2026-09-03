/**
 * @file Public background application facade.
 */

import type { DiagnosticSender } from "../../shared/diagnostics/events";
import type { ActivationReconcileResult } from "../runtime/document-activation";
import type {
    Appearance,
    DisplaySettings,
    SettingsSnapshot,
} from "../../shared/settings/snapshot";
import type { SiteScopeMode } from "../../shared/settings/site-scope";
import { ActivationManager } from "./activation-manager";
import { ApplicationLifecycle } from "./lifecycle";
import {
    LIFECYCLE_REASON,
    type ApplicationPhase,
    type BackgroundApplicationOptions,
    type LifecycleReason,
} from "./contracts";
import { DiagnosticsService } from "../diagnostics/service";
import { deriveDisplayState } from "../projection/display-state";
import { DocumentRefresh } from "../settings/document-refresh";
import type {
    ClearDiagnosticsResponse,
    GetDiagnosticsSnapshotResponse,
} from "../../shared/messaging/contracts";
import type {
    DebugState,
    DisplayState,
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
import type { SiteSettingsSurface } from "../../shared/messaging/view-state-values";
import { SettingsCommands } from "../settings/commands";
import { StateProjection } from "../projection/state-projection";
import { deriveDocumentState } from "../projection/document-state";
import type { DocumentState } from "../../shared/messaging/document-state";

export type {
    ActivationCoordinator,
    ApplicationFailure,
    ApplicationPhase,
    BackgroundApplicationOptions,
    LifecycleReason,
    SettingsBroadcast,
} from "./contracts";

/**
 * Stable public facade coordinating focused background services.
 */
export class BackgroundApplication {
    /**
     * Authoritative initialization and lifecycle coordinator.
     */
    private readonly lifecycle: ApplicationLifecycle;

    /**
     * Popup and sites-state projection service.
     */
    private readonly projection: StateProjection;

    /**
     * Diagnostic policy and journal service.
     */
    private readonly diagnostics: DiagnosticsService;

    /**
     * Serialized settings command handler.
     */
    private readonly commands: SettingsCommands;

    /**
     * Creates an application facade from browser and persistence dependencies.
     *
     * @param options - Settings, activation, tab, and diagnostics dependencies.
     */
    public constructor(options: BackgroundApplicationOptions) {
        const activation = new ActivationManager(options.coordinator);
        this.projection = new StateProjection(options.tabs, activation);
        this.diagnostics = new DiagnosticsService(
            options.journal,
            options.diagnosticEnvironment,
        );
        this.lifecycle = new ApplicationLifecycle(
            options.settings,
            activation,
            this.projection,
            this.diagnostics,
        );
        const documentRefresh = new DocumentRefresh(options.tabs);
        this.commands = new SettingsCommands(
            options.settings,
            this.lifecycle,
            this.projection,
            this.diagnostics,
            documentRefresh,
            options.broadcast,
        );
    }

    /**
     * Current lifecycle phase.
     *
     * @returns - Current background application phase.
     */
    public get phase(): ApplicationPhase {
        return this.lifecycle.phase;
    }

    /**
     * Most recently loaded settings snapshot.
     *
     * @returns - Current snapshot, when settings are available.
     */
    public get currentSnapshot(): SettingsSnapshot | undefined {
        return this.lifecycle.snapshot;
    }

    /**
     * Most recent document-runtime reconciliation result.
     *
     * @returns - Latest activation result, when available.
     */
    public get reconcileResult(): ActivationReconcileResult | undefined {
        return this.lifecycle.reconcileResult;
    }

    /**
     * Ensures settings and runtime activation are ready.
     *
     * @param reason - Lifecycle event requiring initialized state.
     * @returns - Promise settled after initialization and reconciliation.
     */
    public ensureReady(reason: LifecycleReason = LIFECYCLE_REASON.COLD_WORKER): Promise<void> {
        return this.lifecycle.ensureReady(reason);
    }

    /**
     * Queues a browser lifecycle event and reconciles it.
     *
     * @param reason - Browser lifecycle event to reconcile.
     * @returns - Promise settled after the event is processed.
     */
    public requestLifecycle(
        reason: Exclude<LifecycleReason, typeof LIFECYCLE_REASON.COLD_WORKER>,
    ): Promise<void> {
        return this.lifecycle.requestLifecycle(reason);
    }

    /**
     * Returns active-tab popup state after lifecycle reconciliation.
     *
     * @returns - Current popup state.
     */
    public async getPopupState(): Promise<PopupState> {
        await this.prepareQuery();
        return this.lifecycle.enqueue(() =>
            this.projection.deriveAndCachePopup(this.lifecycle.state),
        );
    }

    /**
     * Returns the scope mode and both hostname lists after lifecycle reconciliation.
     *
     * @returns - Current sites state.
     */
    public async getSitesState(): Promise<SitesState> {
        await this.prepareQuery();
        return this.lifecycle.enqueue(() =>
            Promise.resolve(this.projection.deriveSites(this.lifecycle.state)),
        );
    }

    /**
     * Returns diagnostic logging state after lifecycle reconciliation.
     *
     * @returns - Current debug logging state.
     */
    public async getDebugState(): Promise<DebugState> {
        await this.prepareQuery();
        return this.lifecycle.enqueue(() =>
            Promise.resolve(this.diagnostics.debugState(this.lifecycle.state)),
        );
    }

    /**
     * Reads persisted diagnostics when collection is enabled.
     *
     * @returns - Persisted diagnostics or a contained availability error.
     */
    public async getDiagnosticsSnapshot(): Promise<GetDiagnosticsSnapshotResponse> {
        await this.prepareQuery();
        return this.lifecycle.enqueue(() => this.diagnostics.readSnapshot(this.lifecycle.state));
    }

    /**
     * Clears persisted diagnostics while collection remains enabled.
     *
     * @returns - Clear result or a contained availability error.
     */
    public async clearDiagnostics(): Promise<ClearDiagnosticsResponse> {
        await this.prepareQuery();
        return this.lifecycle.enqueue(() => this.diagnostics.clearEntries(this.lifecycle.state));
    }

    /**
     * Validates and records one document-frame diagnostic event.
     *
     * @param input - Untrusted document diagnostic payload.
     * @param sender - WebExtension sender metadata.
     * @returns - Whether a valid enabled event was accepted.
     */
    public recordDocumentEvent(
        input: unknown,
        sender: DiagnosticSender & { readonly frameId?: unknown },
    ): Promise<boolean> {
        return this.diagnostics.record(input, sender, this.lifecycle.state);
    }

    /**
     * Returns top-level policy and presentation state for one document frame.
     *
     * @param sender - Browser sender metadata, including the top-level tab URL.
     * @returns Fail-closed or ready document state.
     */
    public async getDocumentState(sender: DiagnosticSender): Promise<DocumentState> {
        await this.prepareQuery();
        return this.lifecycle.enqueue(() =>
            Promise.resolve(deriveDocumentState(this.lifecycle.state, sender)),
        );
    }

    /**
     * Returns display settings after lifecycle reconciliation.
     *
     * @returns - Current display state.
     */
    public async getDisplayState(): Promise<DisplayState> {
        await this.prepareQuery();
        return this.lifecycle.enqueue(() =>
            Promise.resolve(deriveDisplayState(this.lifecycle.state)),
        );
    }

    /**
     * Persists diagnostic logging and refreshes enabled documents.
     *
     * @param enabled - Requested diagnostic logging state.
     * @returns - Persisted state and refresh failures.
     */
    public setDebugEnabled(enabled: boolean): Promise<SetDebugEnabledResponse> {
        return this.commands.setDebugEnabled(enabled);
    }

    /**
     * Validates and persists display settings.
     *
     * @param display - Typed display settings payload.
     * @returns - Persisted display state and refresh failures.
     */
    public setDisplaySettings(display: DisplaySettings): Promise<SetDisplaySettingsResponse> {
        return this.commands.setDisplaySettings(display);
    }

    /**
     * Persists the appearance applied to both extension surfaces.
     *
     * @param appearance - Requested appearance.
     * @returns - Persisted display state carrying the appearance.
     */
    public setAppearance(appearance: Appearance): Promise<SetAppearanceResponse> {
        return this.commands.setAppearance(appearance);
    }

    /**
     * Persists the active site scope mode and reconciles matching documents.
     *
     * @param mode - Requested scope mode.
     * @returns - Persisted sites state.
     */
    public setSiteScopeMode(mode: SiteScopeMode): Promise<SetSiteScopeModeResponse> {
        return this.commands.setSiteScopeMode(mode);
    }

    /**
     * Restores every setting and runtime surface to defaults.
     *
     * @returns - Reset result and default sites state.
     */
    public resetAllSettings(): Promise<ResetAllSettingsResponse> {
        return this.commands.resetAllSettings();
    }

    /**
     * Persists global activation and reconciles the document runtime.
     *
     * @param enabled - Requested global activation state.
     * @param surface - Response projection requested by the caller.
     * @returns - Persisted global state and the popup or sites projection.
     */
    public setGlobalEnabled(
        enabled: boolean,
        surface: SiteSettingsSurface,
    ): Promise<SetGlobalEnabledResponse> {
        return this.commands.setGlobalEnabled(enabled, surface);
    }

    /**
     * Applies one hostname decision to the list the active scope mode owns and
     * reconciles affected documents.
     *
     * @param hostname - Canonical hostname whose processing state changes.
     * @param enabled - Whether processing should apply to the hostname.
     * @param mode - Scope mode the caller rendered when it made the decision.
     * @param surface - Response projection requested by the caller.
     * @returns - Persisted update and popup or sites projection.
     */
    public setSiteEnabled(
        hostname: string,
        enabled: boolean,
        mode: SiteScopeMode,
        surface: SiteSettingsSurface,
    ): Promise<SetSiteEnabledResponse> {
        return this.commands.setSiteEnabled(hostname, enabled, mode, surface);
    }

    /**
     * Initializes the application and drains queued lifecycle work before a query.
     */
    private async prepareQuery(): Promise<void> {
        await this.lifecycle.ensureReady(LIFECYCLE_REASON.COLD_WORKER);
        await this.lifecycle.drainLifecycle();
    }
}
