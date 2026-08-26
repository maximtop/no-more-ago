/**
 * @file Diagnostic policy, sanitization, persistence, and exported state.
 */

import {
    createDiagnosticEvent,
    sanitizeDiagnosticEvent,
    type DiagnosticBrowserFamily,
    type DiagnosticEvent,
    type DiagnosticEventInput,
    type DiagnosticSender,
} from "../diagnostics/events";
import type { DiagnosticJournal } from "../diagnostics/journal";
import type { RuntimeAdapterDefinition } from "../runtime/adapter-activation";
import { isSiteEnabled } from "../settings/snapshot";
import type { BackgroundApplicationOptions } from "./application-contracts";
import type { ApplicationStateView } from "./application-state";
import type {
    ClearDiagnosticsResponse,
    DiagnosticsEnvironment,
    GetDiagnosticsSnapshotResponse,
} from "./message-contracts";
import type { DebugState } from "./view-state";

/**
 * Recognizes extension versions safe to include in exported diagnostics.
 */
const SAFE_EXTENSION_VERSION = /^[0-9A-Za-z][0-9A-Za-z._+-]{0,31}$/u;

/**
 * Owns diagnostic opt-in state, trusted metadata, and journal operations.
 */
export class DiagnosticsService {
    /**
     * Optional persistent diagnostic journal.
     */
    private readonly journal: DiagnosticJournal | undefined;

    /**
     * Runtime adapters accepted as document-event sources.
     */
    private readonly adapters: readonly RuntimeAdapterDefinition[];

    /**
     * Trusted browser and extension metadata.
     */
    private readonly environment: BackgroundApplicationOptions["diagnosticEnvironment"];

    /**
     * Creates a diagnostics service.
     *
     * @param journal - Optional persistent diagnostic journal.
     * @param adapters - Runtime adapter catalog.
     * @param environment - Trusted browser and extension metadata.
     */
    public constructor(
        journal: DiagnosticJournal | undefined,
        adapters: readonly RuntimeAdapterDefinition[],
        environment: BackgroundApplicationOptions["diagnosticEnvironment"],
    ) {
        this.journal = journal;
        this.adapters = adapters;
        this.environment = environment;
    }

    /**
     * Builds the diagnostic logging view state.
     *
     * @param state - Current lifecycle state.
     * @returns - Diagnostic logging state.
     */
    public debugState(state: ApplicationStateView): DebugState {
        if (state.phase !== "ready" || !state.snapshot) {
            return {
                availability: "unavailable",
                revision: null,
                enabled: null,
                failure: state.failure === "fail-closed-cleanup"
                    ? "fail-closed-cleanup"
                    : "settings-load",
            };
        }
        return {
            availability: "ready",
            revision: state.snapshot.revision,
            enabled: state.snapshot.debugEnabled,
        };
    }

    /**
     * Reads persisted diagnostics when logging and the journal are available.
     *
     * @param state - Current lifecycle state.
     * @returns - Persisted diagnostics or a contained availability error.
     */
    public async readSnapshot(
        state: ApplicationStateView,
    ): Promise<GetDiagnosticsSnapshotResponse> {
        if (state.phase !== "ready" || !state.snapshot || !this.journal) {
            return { ok: false, error: "unavailable" };
        }
        if (!state.snapshot.debugEnabled) {
            return { ok: false, error: "disabled" };
        }
        const result = await this.journal.readSnapshot();
        if (!result.ok) {
            return result;
        }
        return {
            ok: true,
            snapshot: { entries: result.entries, environment: this.exportEnvironment() },
        };
    }

    /**
     * Clears retained entries while diagnostic collection remains enabled.
     *
     * @param state - Current lifecycle state.
     * @returns - Clear result or a contained availability error.
     */
    public async clearEntries(state: ApplicationStateView): Promise<ClearDiagnosticsResponse> {
        if (state.phase !== "ready" || !state.snapshot || !this.journal) {
            return { ok: false, error: "unavailable" };
        }
        if (!state.snapshot.debugEnabled) {
            return { ok: false, error: "disabled" };
        }
        return this.journal.clearEntries();
    }

    /**
     * Enables or disables persistent collection without surfacing journal failures.
     *
     * @param enabled - Requested collection state.
     * @returns - Promise settled after the journal attempt.
     */
    public async setEnabled(enabled: boolean): Promise<void> {
        try {
            await this.journal?.setEnabled(enabled);
        } catch {
            /* diagnostics never block processing */
        }
    }

    /**
     * Clears and disables all retained diagnostics without surfacing journal failures.
     *
     * @returns - Promise settled after the journal attempt.
     */
    public async reset(): Promise<void> {
        try {
            await this.journal?.clear();
        } catch {
            /* recovery never depends on diagnostics */
        }
    }

    /**
     * Appends a sanitized background event without blocking application work.
     *
     * @param input - Background diagnostic event to sanitize and append.
     * @param state - Current lifecycle state.
     */
    public log(input: DiagnosticEventInput, state: ApplicationStateView): void {
        if (!state.snapshot?.debugEnabled || !this.journal) {
            return;
        }
        const hostname = this.adapters[0]?.hostname;
        if (!hostname) {
            return;
        }
        const event = sanitizeDiagnosticEvent(input, {
            hostname,
            pageCategory: "other",
            incognito: false,
        });
        if (event) {
            void this.journal.append(this.trust(event)).catch(() => undefined);
        }
    }

    /**
     * Validates and records a top-frame event for an enabled adapter.
     *
     * @param input - Untrusted document diagnostic payload.
     * @param sender - WebExtension sender metadata.
     * @param state - Current lifecycle state.
     * @returns - Whether a valid enabled top-frame event was accepted.
     */
    public async record(
        input: unknown,
        sender: DiagnosticSender & { readonly frameId?: unknown },
        state: ApplicationStateView,
    ): Promise<boolean> {
        const snapshot = state.snapshot;
        if (
            state.phase !== "ready"
            || !snapshot?.debugEnabled
            || !snapshot.globalEnabled
            || !this.journal
        ) {
            return false;
        }
        if (sender.frameId !== undefined && sender.frameId !== 0) {
            return false;
        }
        const event = createDiagnosticEvent(input, sender);
        if (!event || !isSiteEnabled(snapshot.sitePreferences, event.hostname)) {
            return false;
        }
        if (!this.adapters.some((adapter) => adapter.hostname === event.hostname)) {
            return false;
        }
        try {
            await this.journal.append(this.trust(event));
        } catch {
            /* diagnostics never block timestamp processing */
        }
        return true;
    }

    /**
     * Replaces document-supplied environment metadata with trusted values.
     *
     * @param event - Sanitized document diagnostic event.
     * @returns - Event with trusted extension metadata.
     */
    private trust(event: DiagnosticEvent): DiagnosticEvent {
        const trusted = { ...event };
        delete trusted.adapterVersion;
        delete trusted.extensionVersion;
        delete trusted.browserFamily;
        const version = this.environment?.extensionVersion;
        if (typeof version === "string" && SAFE_EXTENSION_VERSION.test(version)) {
            trusted.extensionVersion = version;
        }
        const family = this.environment?.browserFamily;
        if (family === "chromium" || family === "firefox" || family === "other") {
            trusted.browserFamily = family;
        }
        return Object.freeze(trusted);
    }

    /**
     * Builds sanitized trusted metadata for a diagnostic archive.
     *
     * @returns - Browser and optional extension version metadata.
     */
    private exportEnvironment(): DiagnosticsEnvironment {
        const family = this.environment?.browserFamily;
        const browserFamily: DiagnosticBrowserFamily =
            family === "chromium" || family === "firefox" || family === "other"
                ? family
                : "other";
        const version = this.environment?.extensionVersion;
        return {
            browserFamily,
            ...(typeof version === "string" && SAFE_EXTENSION_VERSION.test(version)
                ? { extensionVersion: version }
                : {}),
        };
    }
}
