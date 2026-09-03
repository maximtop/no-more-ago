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
} from "../../shared/diagnostics/events";
import {
    DIAGNOSTIC_BROWSER_FAMILY,
    DIAGNOSTIC_BROWSER_FAMILIES,
    DIAGNOSTIC_INTERNAL_HOSTNAME,
    DIAGNOSTIC_PAGE_CATEGORY,
} from "../../shared/diagnostics/contracts";
import { SAFE_EXTENSION_VERSION_PATTERN } from "../../shared/extension-version";
import type { DiagnosticJournal } from "../diagnostics/journal";
import { isSiteProcessingEnabled } from "../../shared/settings/site-scope";
import { parseHttpUrl } from "../../shared/url/http";
import type { BackgroundApplicationOptions } from "../application/contracts";
import type { ApplicationStateView } from "../application/state";
import { APPLICATION_PHASE } from "../application/contracts";
import {
    SETTINGS_STATE_FAILURE,
    STATE_AVAILABILITY,
} from "../../shared/messaging/view-state-values";
import type {
    ClearDiagnosticsResponse,
    DiagnosticsEnvironment,
    GetDiagnosticsSnapshotResponse,
} from "../../shared/messaging/contracts";
import type { DebugState } from "../../shared/messaging/view-state-schemas";

const BROWSER_FAMILY_SET = new Set<string>(DIAGNOSTIC_BROWSER_FAMILIES);

/**
 * Owns diagnostic opt-in state, trusted metadata, and journal operations.
 */
export class DiagnosticsService {
    /**
     * Optional persistent diagnostic journal.
     */
    private readonly journal: DiagnosticJournal | undefined;

    /**
     * Trusted browser and extension metadata.
     */
    private readonly environment: BackgroundApplicationOptions["diagnosticEnvironment"];

    /**
     * Creates a diagnostics service.
     *
     * @param journal - Optional persistent diagnostic journal.
     * @param environment - Trusted browser and extension metadata.
     */
    public constructor(
        journal: DiagnosticJournal | undefined,
        environment: BackgroundApplicationOptions["diagnosticEnvironment"],
    ) {
        this.journal = journal;
        this.environment = environment;
    }

    /**
     * Builds the diagnostic logging view state.
     *
     * @param state - Current lifecycle state.
     * @returns - Diagnostic logging state.
     */
    public debugState(state: ApplicationStateView): DebugState {
        if (state.phase !== APPLICATION_PHASE.READY || !state.snapshot) {
            return {
                availability: STATE_AVAILABILITY.UNAVAILABLE,
                revision: null,
                enabled: null,
                failure: state.failure === SETTINGS_STATE_FAILURE.FAIL_CLOSED_CLEANUP
                    ? SETTINGS_STATE_FAILURE.FAIL_CLOSED_CLEANUP
                    : SETTINGS_STATE_FAILURE.SETTINGS_LOAD,
            };
        }
        return {
            availability: STATE_AVAILABILITY.READY,
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
        if (
            state.phase !== APPLICATION_PHASE.READY
            || !state.snapshot
            || !this.journal
        ) {
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
        if (
            state.phase !== APPLICATION_PHASE.READY
            || !state.snapshot
            || !this.journal
        ) {
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
        const event = sanitizeDiagnosticEvent(input, {
            hostname: DIAGNOSTIC_INTERNAL_HOSTNAME,
            pageCategory: DIAGNOSTIC_PAGE_CATEGORY.OTHER,
            incognito: false,
        });
        if (event) {
            void this.journal.append(this.trust(event)).catch(() => undefined);
        }
    }

    /**
     * Validates and records a document-frame event for an enabled top-level site.
     *
     * @param input - Untrusted document diagnostic payload.
     * @param sender - WebExtension sender metadata.
     * @param state - Current lifecycle state.
     * @returns - Whether a valid event from an enabled top-level site was accepted.
     */
    public async record(
        input: unknown,
        sender: DiagnosticSender & { readonly frameId?: unknown },
        state: ApplicationStateView,
    ): Promise<boolean> {
        const snapshot = state.snapshot;
        if (
            state.phase !== APPLICATION_PHASE.READY
            || !snapshot?.debugEnabled
            || !snapshot.globalEnabled
            || !this.journal
        ) {
            return false;
        }
        const topLevelUrl = parseHttpUrl(sender.tab?.url);
        if (!topLevelUrl || !isSiteProcessingEnabled(snapshot.siteScope, topLevelUrl.hostname)) {
            return false;
        }
        const event = createDiagnosticEvent(input, sender);
        if (!event) {
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
        if (typeof version === "string" && SAFE_EXTENSION_VERSION_PATTERN.test(version)) {
            trusted.extensionVersion = version;
        }
        const family = this.environment?.browserFamily;
        if (typeof family === "string" && BROWSER_FAMILY_SET.has(family)) {
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
            typeof family === "string" && BROWSER_FAMILY_SET.has(family)
                ? family
                : DIAGNOSTIC_BROWSER_FAMILY.OTHER;
        const version = this.environment?.extensionVersion;
        return {
            browserFamily,
            ...(typeof version === "string" && SAFE_EXTENSION_VERSION_PATTERN.test(version)
                ? { extensionVersion: version }
                : {}),
        };
    }
}
