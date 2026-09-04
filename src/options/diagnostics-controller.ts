/**
 * @file Owns debug logging, diagnostic archives, and site-report actions for options.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
    createUnavailableDebugState,
    type DebugState,
} from "../shared/messaging/view-state";
import {
    SETTINGS_PERSISTENCE_ERROR,
    STATE_AVAILABILITY,
} from "../shared/messaging/view-state-values";
import { CLIENT_RESULT_KIND } from "../shared/client-result";
import type { DownloadRuntime } from "../shared/diagnostics/archive";
import {
    DIAGNOSTICS_CLEARED_KEY,
    diagnosticsErrorKey,
    downloadDiagnosticsSnapshot,
} from "../shared/diagnostics/download";
import type { MessageKey } from "../shared/i18n/translator";
import {
    SITE_REPORT_ERROR,
    type SiteReportError,
    type SiteReportReporter,
} from "../shared/reporting/site-report";
import type { SitesClient } from "./client";

/**
 * Named outcomes of a Debug logs mutation.
 */
export const DEBUG_NOTICE = {
    SAVE_FAILED: SETTINGS_PERSISTENCE_ERROR.SAVE_FAILED,
    INTERRUPTED: "interrupted",
    UNKNOWN: "unknown",
} as const;

/**
 * User-visible outcome of a Debug logs mutation, or undefined when there is none.
 */
export type DebugNotice = (typeof DEBUG_NOTICE)[keyof typeof DEBUG_NOTICE] | undefined;

/**
 * Maps a Debug logs outcome to the message key describing it.
 *
 * @param notice - Outcome reported after changing the Debug logs setting.
 * @returns - Message key, or undefined when there is no notice to show.
 */
export function debugNoticeKey(notice: DebugNotice): MessageKey | undefined {
    if (notice === DEBUG_NOTICE.SAVE_FAILED) {
        return "debug_error_save_failed";
    }
    if (notice === DEBUG_NOTICE.INTERRUPTED) {
        return "debug_error_interrupted";
    }
    if (notice === DEBUG_NOTICE.UNKNOWN) {
        return "debug_error_unknown";
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
    readonly diagnosticsNotice: MessageKey | undefined;

    /**
     * Whether a GitHub report is being opened.
     */
    readonly reporting: boolean;

    /**
     * Latest failure encountered while opening a GitHub report.
     */
    readonly reportNotice: MessageKey | undefined;

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
 * Maps a site-report failure to the guidance key shown in settings.
 *
 * @param error - Failure returned by the site-report service.
 * @returns - Message key displayed to the user.
 */
function siteReportErrorKey(error: SiteReportError): MessageKey {
    if (error === SITE_REPORT_ERROR.BUSY) {
        return "report_error_busy_options";
    }
    if (error === SITE_REPORT_ERROR.OPEN_FAILED) {
        return "report_error_generic";
    }
    if (error === SITE_REPORT_ERROR.BROWSER_UNAVAILABLE) {
        return "report_error_browser";
    }
    return "report_error_context";
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
    const [diagnosticsNotice, setDiagnosticsNotice] = useState<MessageKey>();
    const [reporting, setReporting] = useState(false);
    const [reportNotice, setReportNotice] = useState<MessageKey>();
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

    /**
     * Persists the Debug logs toggle and applies the outcome.
     *
     * @param enabled - Requested logging state.
     * @returns - A promise that settles after the outcome has been applied.
     */
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
                setNotice(DEBUG_NOTICE.SAVE_FAILED);
            }
        } else if (result.state) {
            if (
                result.state.availability !== STATE_AVAILABILITY.READY
                || result.state.revision >= state.revision
            ) {
                setState(result.state);
            }
            setNotice(DEBUG_NOTICE.INTERRUPTED);
        } else {
            setState(createUnavailableDebugState());
            setNotice(DEBUG_NOTICE.UNKNOWN);
        }
        debugInFlight.current = false;
        setSaving(false);
    };

    /**
     * Downloads the retained diagnostics archive.
     *
     * @returns - A promise that settles after the download attempt.
     */
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

    /**
     * Clears retained diagnostics while logging is enabled.
     *
     * @returns - A promise that settles after the outcome has been applied.
     */
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
                    ? diagnosticsErrorKey(result.error)
                    : DIAGNOSTICS_CLEARED_KEY,
            );
        } finally {
            diagnosticsInFlight.current = false;
            setDiagnosticsBusy(false);
        }
    };

    /**
     * Opens a prefilled GitHub report from the Settings page.
     *
     * @returns - A promise that settles after the report attempt.
     */
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
                setReportNotice(siteReportErrorKey(result.error));
            }
        } catch {
            setReportNotice("report_error_generic");
        } finally {
            reportInFlight.current = false;
            setReporting(false);
        }
    };

    /**
     * Rereads diagnostic logging state after a full reset.
     *
     * @returns - A promise that settles after the fresh projection has been applied.
     */
    const reloadAfterReset = async (): Promise<void> => {
        try {
            setState(await client.getDebugState());
        } catch {
            setState(createUnavailableDebugState());
            setNotice(DEBUG_NOTICE.UNKNOWN);
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
