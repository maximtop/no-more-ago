/**
 * @file Owns debug logging, diagnostic archives, and site-report actions for options.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
    createUnavailableDebugState,
    type DebugState,
} from "../shared/messaging/view-state-schemas";
import { STATE_AVAILABILITY } from "../shared/messaging/view-state-values";
import { CLIENT_RESULT_KIND } from "../shared/client-result";
import type { DownloadRuntime } from "../shared/diagnostics/archive";
import {
    DIAGNOSTICS_CLEARED_NOTICE,
    diagnosticsErrorText,
    downloadDiagnosticsSnapshot,
} from "../shared/diagnostics/download";
import type { SiteReportReporter } from "../shared/reporting/site-report";
import type { SitesClient } from "./client";

/**
 * User-visible outcome of a Debug logs mutation.
 */
export type DebugNotice = "save-failed" | "interrupted" | "unknown" | undefined;

/**
 * Maps a Debug logs outcome to its user-visible error message.
 *
 * @param notice - Outcome reported after changing the Debug logs setting.
 * @returns - An error message, or undefined when there is no notice to show.
 */
export function debugNoticeText(notice: DebugNotice): string | undefined {
    if (notice === "save-failed") {
        return "Could not save the Debug logs setting. Try again.";
    }
    if (notice === "interrupted") {
        return "The Debug logs response was interrupted. Current state was reloaded.";
    }
    if (notice === "unknown") {
        return "Could not confirm the Debug logs setting. Reopen Settings to try again.";
    }
    return undefined;
}

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
     * Runtime used to hand a diagnostics archive to the browser.
     */
    readonly archiveRuntime: DownloadRuntime | undefined;
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
     * Latest Debug logs outcome that needs user guidance.
     */
    readonly notice: DebugNotice;

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
     * @param enabled - Whether diagnostic logging should be enabled.
     * @returns - A promise that settles after the command outcome has been applied.
     */
    changeDebug(enabled: boolean): Promise<void>;

    /**
     * Downloads a snapshot of stored diagnostic logs.
     *
     * @returns - A promise that settles after the download attempt completes.
     */
    downloadDiagnostics(): Promise<void>;

    /**
     * Removes stored diagnostic logs without changing the Debug logs setting.
     *
     * @returns - A promise that settles after the clear attempt completes.
     */
    clearDiagnostics(): Promise<void>;

    /**
     * Opens the generic GitHub site-report form.
     *
     * @returns - A promise that settles after the open attempt completes.
     */
    openGitHubIssue(): Promise<void>;

    /**
     * Clears notices and exposes loading state before reset rehydration.
     */
    beginReset(): void;

    /**
     * Rehydrates the Debug logs setting after all persisted settings were reset.
     *
     * @returns - A promise that settles after the fresh projection has been applied.
     */
    reloadAfterReset(): Promise<void>;

    /**
     * Rereads the Debug logs setting after another surface changed settings.
     *
     * @returns - A promise that settles after the fresh projection has been applied.
     */
    readonly reload: () => Promise<void>;
}

/**
 * Maps a site-report failure to guidance shown in settings.
 *
 * @param error - Failure returned by the site-report service.
 * @returns - The error message displayed to the user.
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
 * @param options - Controller dependencies and optional preloaded state.
 * @returns - Current diagnostics state together with logging, archive, and report commands.
 */
export function useDiagnosticsController(
    options: DiagnosticsControllerOptions,
): DiagnosticsController {
    const { client, reporter, initialState, archiveRuntime } = options;
    const [state, setState] = useState<DebugState | undefined>(initialState);
    const [loading, setLoading] = useState(initialState === undefined);
    const [saving, setSaving] = useState(false);
    const [notice, setNotice] = useState<DebugNotice>();
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
                setState(createUnavailableDebugState());
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
        setNotice(undefined);
        const result = await client.setDebugEnabled(enabled);
        if (result.kind === CLIENT_RESULT_KIND.RESPONSE) {
            if (
                result.response.state.availability !== STATE_AVAILABILITY.READY
                || result.response.state.revision >= state.revision
            ) {
                setState(result.response.state);
            }
            if (!result.response.ok) {
                setNotice("save-failed");
            }
        } else if (result.state) {
            if (
                result.state.availability !== STATE_AVAILABILITY.READY
                || result.state.revision >= state.revision
            ) {
                setState(result.state);
            }
            setNotice("interrupted");
        } else {
            setState(createUnavailableDebugState());
            setNotice("unknown");
        }
        debugInFlight.current = false;
        setSaving(false);
    };

    const downloadDiagnostics = async (): Promise<void> => {
        if (diagnosticsInFlight.current) {
            return;
        }
        diagnosticsInFlight.current = true;
        setDiagnosticsBusy(true);
        setDiagnosticsNotice(undefined);
        try {
            setDiagnosticsNotice(downloadDiagnosticsSnapshot(
                await client.getDiagnosticsSnapshot(),
                archiveRuntime,
            ));
        } finally {
            diagnosticsInFlight.current = false;
            setDiagnosticsBusy(false);
        }
    };

    const clearDiagnostics = async (): Promise<void> => {
        if (
            !state
            || state.availability !== STATE_AVAILABILITY.READY
            || !state.enabled
            || diagnosticsInFlight.current
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
            setState(createUnavailableDebugState());
            setNotice("unknown");
        } finally {
            setLoading(false);
        }
    };

    // A failed live reread keeps the last READY projection: one lost message
    // does not mean processing stopped, and the next announcement retries. A
    // reread older than the rendered projection is dropped for the same reason.
    const reload = useCallback(async (): Promise<void> => {
        try {
            const next = await client.getDebugState();
            setState((current) => (
                next.availability !== STATE_AVAILABILITY.READY
                || current?.availability !== STATE_AVAILABILITY.READY
                || next.revision >= current.revision
                    ? next
                    : current
            ));
        } catch {
            /* keep the current projection */
        }
    }, [client]);

    return {
        state,
        loading,
        saving,
        notice,
        diagnosticsBusy,
        diagnosticsNotice,
        reporting,
        reportNotice,
        changeDebug,
        downloadDiagnostics,
        clearDiagnostics,
        openGitHubIssue,
        beginReset: () => {
            setNotice(undefined);
            setDiagnosticsNotice(undefined);
            setReportNotice(undefined);
            setLoading(true);
        },
        reloadAfterReset,
        reload,
    };
}
