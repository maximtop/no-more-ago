/**
 * @file Owns debug logging, diagnostic archives, and site-report actions for options.
 */

import { useEffect, useRef, useState } from "react";
import type {
    DebugState,
} from "../shared/messaging/view-state";
import type {
    DiagnosticsClearError,
    DiagnosticsSnapshotError,
} from "../shared/messaging/contracts";
import {
    SETTINGS_STATE_FAILURE,
    STATE_AVAILABILITY,
} from "../shared/messaging/view-state-values";
import { CLIENT_RESULT_KIND } from "../shared/client-result";
import {
    DiagnosticArchiveError,
    createDiagnosticsZip,
    downloadDiagnosticsZip,
    type DownloadRuntime,
} from "./diagnostics/archive";
import type { SiteReportReporter } from "../shared/reporting/site-report";
import type { SitesClient } from "./client";
import type { OptionsNotice } from "./options-notice";

/**
 * Message used after diagnostic entries are removed successfully.
 */
export const DIAGNOSTICS_CLEARED_NOTICE = "Diagnostic logs cleared.";

/**
 * Dependencies and optional initial state for diagnostics controls.
 */
export interface DiagnosticsControllerOptions {
    /**
     * Client used to load debug state and exchange diagnostic messages.
     */
    readonly client: SitesClient;

    /**
     * Service used to open a GitHub site report.
     */
    readonly reporter: SiteReportReporter;

    /**
     * Preloaded diagnostic-logging state that avoids the initial request.
     */
    readonly initialState: DebugState | undefined;

    /**
     * Runtime used to create and download a diagnostics archive.
     */
    readonly archiveRuntime: DownloadRuntime | undefined;

    /**
     * Replaces the shared site or Debug logs mutation notice.
     */
    readonly onNoticeChange: (notice: OptionsNotice) => void;
}

/**
 * Diagnostic state and commands consumed by its view and the reset coordinator.
 */
export interface DiagnosticsController {
    /**
     * Current validated Debug logs setting, once available.
     */
    readonly state: DebugState | undefined;

    /**
     * Whether the Debug logs setting is being loaded.
     */
    readonly loading: boolean;

    /**
     * Whether a Debug logs mutation is in flight.
     */
    readonly saving: boolean;

    /**
     * Whether a diagnostic snapshot or clear request is in flight.
     */
    readonly diagnosticsBusy: boolean;

    /**
     * Latest diagnostic archive or clear result shown to the user.
     */
    readonly diagnosticsNotice: string | undefined;

    /**
     * Whether a GitHub report is being opened.
     */
    readonly reporting: boolean;

    /**
     * Latest failure encountered while opening a GitHub report.
     */
    readonly reportNotice: string | undefined;

    /**
     * Changes whether bounded diagnostic logging is enabled.
     *
     * @param enabled Whether diagnostic logging should be enabled.
     * @returns A promise that settles after the command outcome has been applied.
     */
    changeDebug(enabled: boolean): Promise<void>;

    /**
     * Downloads a snapshot of stored diagnostic logs.
     *
     * @returns A promise that settles after the download attempt completes.
     */
    downloadDiagnostics(): Promise<void>;

    /**
     * Removes stored diagnostic logs without changing the Debug logs setting.
     *
     * @returns A promise that settles after the clear attempt completes.
     */
    clearDiagnostics(): Promise<void>;

    /**
     * Opens the generic GitHub site-report form.
     *
     * @returns A promise that settles after the open attempt completes.
     */
    openGitHubIssue(): Promise<void>;

    /**
     * Clears notices and exposes loading state before reset rehydration.
     */
    beginReset(): void;

    /**
     * Rehydrates the Debug logs setting after all persisted settings were reset.
     *
     * @returns A promise that settles after the fresh projection has been applied.
     */
    reloadAfterReset(): Promise<void>;
}

const UNAVAILABLE_DEBUG_STATE: DebugState = {
    availability: STATE_AVAILABILITY.UNAVAILABLE,
    revision: null,
    enabled: null,
    failure: SETTINGS_STATE_FAILURE.SETTINGS_LOAD,
};

/**
 * Maps a diagnostics service failure to user guidance.
 *
 * @param error Stable service failure returned by the background page.
 * @returns The diagnostic error message displayed to the user.
 */
function diagnosticsErrorText(
    error: DiagnosticsSnapshotError | DiagnosticsClearError,
): string {
    if (error === "disabled") {
        return "Debug logs are off. Turn them on to use saved diagnostics.";
    }
    if (error === "empty") {
        return "There are no diagnostic logs to download yet.";
    }
    if (error === "storage-failed") {
        return "Saved diagnostic logs could not be read. Try again later.";
    }
    return "Diagnostic logs are unavailable. Try again later.";
}

/**
 * Maps a site-report failure to guidance shown in settings.
 *
 * @param error Failure returned by the site-report service.
 * @returns The error message displayed to the user.
 */
function siteReportErrorText(error: string): string {
    if (error === "busy") {
        return "A GitHub report is already being opened.";
    }
    if (error === "open-failed") {
        return "Could not open the GitHub report. Try again.";
    }
    if (error === "browser-unavailable") {
        return "Could not open the GitHub report in this browser.";
    }
    return "Could not open the GitHub report. Check the browser context and try again.";
}

/**
 * Creates the diagnostics controller for the options page.
 *
 * @param options Controller dependencies and optional preloaded state.
 * @returns Current diagnostics state together with logging, archive, and report commands.
 */
export function useDiagnosticsController(
    options: DiagnosticsControllerOptions,
): DiagnosticsController {
    const { client, reporter, initialState, archiveRuntime, onNoticeChange } = options;
    const [state, setState] = useState<DebugState | undefined>(initialState);
    const [loading, setLoading] = useState(initialState === undefined);
    const [saving, setSaving] = useState(false);
    const [diagnosticsBusy, setDiagnosticsBusy] = useState(false);
    const [diagnosticsNotice, setDiagnosticsNotice] = useState<string>();
    const [reporting, setReporting] = useState(false);
    const [reportNotice, setReportNotice] = useState<string>();
    const debugInFlight = useRef(false);
    const diagnosticsInFlight = useRef(false);
    const reportInFlight = useRef(false);

    useEffect(() => {
        if (initialState) {
            return;
        }
        let mounted = true;
        void client
            .getDebugState()
            .then((next) => {
                if (!mounted) {
                    return;
                }
                setState(next);
                setLoading(false);
            })
            .catch(() => {
                if (!mounted) {
                    return;
                }
                setState(UNAVAILABLE_DEBUG_STATE);
                setLoading(false);
            });
        return () => {
            mounted = false;
        };
    }, [client, initialState]);

    const changeDebug = async (enabled: boolean): Promise<void> => {
        if (
            !state
            || state.availability !== STATE_AVAILABILITY.READY
            || saving
            || debugInFlight.current
        ) {
            return;
        }
        debugInFlight.current = true;
        setSaving(true);
        onNoticeChange(undefined);
        const result = await client.setDebugEnabled(enabled);
        if (result.kind === CLIENT_RESULT_KIND.RESPONSE) {
            if (
                result.response.state.availability !== STATE_AVAILABILITY.READY ||
                result.response.state.revision >= state.revision
            ) {
                setState(result.response.state);
            }
            if (!result.response.ok) {
                onNoticeChange("debug-save-failed");
            }
        } else if (result.state) {
            if (
                result.state.availability !== STATE_AVAILABILITY.READY
                || result.state.revision >= state.revision
            ) {
                setState(result.state);
            }
            onNoticeChange("debug-interrupted");
        } else {
            setState(UNAVAILABLE_DEBUG_STATE);
            onNoticeChange("debug-unknown");
        }
        debugInFlight.current = false;
        setSaving(false);
    };

    const downloadDiagnostics = async (): Promise<void> => {
        if (
            !state ||
            state.availability !== STATE_AVAILABILITY.READY ||
            !state.enabled ||
            diagnosticsInFlight.current
        ) {
            return;
        }
        diagnosticsInFlight.current = true;
        setDiagnosticsBusy(true);
        setDiagnosticsNotice(undefined);
        try {
            const result = await client.getDiagnosticsSnapshot();
            if (result.kind === CLIENT_RESULT_KIND.ERROR) {
                setDiagnosticsNotice(diagnosticsErrorText(result.error));
                return;
            }
            try {
                const bytes = createDiagnosticsZip(result.snapshot);
                downloadDiagnosticsZip(bytes, archiveRuntime);
            } catch (error) {
                setDiagnosticsNotice(
                    error instanceof DiagnosticArchiveError
                        ? error.message
                        : "The diagnostic archive could not be downloaded. Try again later.",
                );
            }
        } finally {
            diagnosticsInFlight.current = false;
            setDiagnosticsBusy(false);
        }
    };

    const clearDiagnostics = async (): Promise<void> => {
        if (
            !state ||
            state.availability !== STATE_AVAILABILITY.READY ||
            !state.enabled ||
            diagnosticsInFlight.current
        ) {
            return;
        }
        diagnosticsInFlight.current = true;
        setDiagnosticsBusy(true);
        setDiagnosticsNotice(undefined);
        try {
            const result = await client.clearDiagnostics();
            setDiagnosticsNotice(
                result.kind === CLIENT_RESULT_KIND.ERROR
                    ? diagnosticsErrorText(result.error)
                    : DIAGNOSTICS_CLEARED_NOTICE,
            );
        } finally {
            diagnosticsInFlight.current = false;
            setDiagnosticsBusy(false);
        }
    };

    const openGitHubIssue = async (): Promise<void> => {
        if (reporting || reportInFlight.current) {
            return;
        }
        reportInFlight.current = true;
        setReporting(true);
        setReportNotice(undefined);
        try {
            const result = await reporter.openOptionsReport();
            if (!result.ok) {
                setReportNotice(siteReportErrorText(result.error));
            }
        } catch {
            setReportNotice("Could not open the GitHub report. Try again.");
        } finally {
            reportInFlight.current = false;
            setReporting(false);
        }
    };

    const reloadAfterReset = async (): Promise<void> => {
        try {
            setState(await client.getDebugState());
        } catch {
            setState(UNAVAILABLE_DEBUG_STATE);
            onNoticeChange("debug-unknown");
        } finally {
            setLoading(false);
        }
    };

    return {
        state,
        loading,
        saving,
        diagnosticsBusy,
        diagnosticsNotice,
        reporting,
        reportNotice,
        changeDebug,
        downloadDiagnostics,
        clearDiagnostics,
        openGitHubIssue,
        beginReset: () => {
            setDiagnosticsNotice(undefined);
            setReportNotice(undefined);
            setLoading(true);
        },
        reloadAfterReset,
    };
}
