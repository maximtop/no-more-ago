/**
 * @file Owns popup state, its mutations, and live background refreshes.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CLIENT_RESULT_KIND } from "../shared/client-result";
import {
    SETTINGS_STATE_FAILURE,
    STATE_AVAILABILITY,
} from "../shared/messaging/view-state-values";
import {
    createUnavailablePopupState,
    type PopupState,
} from "../shared/messaging/view-state-schemas";
import {
    createDefaultSettingsChangedSubscriber,
    type SubscribeSettingsChanged,
} from "../shared/messaging/settings-notifications";
import { useSettingsChanged } from "../shared/ui/use-settings-changed";
import {
    DiagnosticArchiveError,
    createDiagnosticsZip,
    downloadDiagnosticsZip,
    type DownloadRuntime,
} from "../shared/diagnostics/archive";
import type { DiagnosticsSnapshotError } from "../shared/messaging/contracts";
import { createPopupClient, type PopupClient } from "./client";

/**
 * Time after which an unanswered state request renders the unavailable view.
 */
export const POPUP_STATE_LOAD_TIMEOUT_MS = 5_000;

/**
 * User-visible outcome of a popup settings mutation.
 */
export type PopupNotice =
    | "save-failed"
    | "invalid-hostname"
    | "interrupted"
    | "unknown"
    | "external-change"
    | undefined;

/**
 * Dependencies and preloaded state for the popup controller.
 */
export interface PopupControllerOptions {
    /**
     * Client used to load and change popup settings.
     */
    readonly client?: PopupClient;

    /**
     * State to render without an initial background request.
     */
    readonly initialState?: PopupState;

    /**
     * Subscriber used to observe committed settings changes.
     */
    readonly subscribe?: SubscribeSettingsChanged;

    /**
     * Runtime used to hand a diagnostics archive to the browser.
     */
    readonly archiveRuntime?: DownloadRuntime;
}

/**
 * Maps a diagnostics service failure to user guidance.
 *
 * @param error - Stable service failure returned by the background page.
 * @returns - The message displayed to the user.
 */
function diagnosticsErrorText(error: DiagnosticsSnapshotError): string {
    if (error === "disabled") {
        return "Debug logs are off, so there are no logs to download.";
    }
    if (error === "empty") {
        return "There are no diagnostic logs to download yet.";
    }
    if (error === "invalid-journal") {
        return "Saved diagnostic logs are invalid and cannot be downloaded.";
    }
    if (error === "storage-failed") {
        return "Saved diagnostic logs could not be read. Try again later.";
    }
    return "Diagnostic logs are unavailable. Try again later.";
}

/**
 * Message used after a diagnostics archive is handed to the browser.
 */
export const POPUP_DIAGNOSTICS_DOWNLOADED_NOTICE = "Diagnostic logs downloaded.";

/**
 * Popup state and the commands its view issues.
 */
export interface PopupController {
    /**
     * Current validated popup projection, once loading has completed.
     */
    readonly state: PopupState | undefined;

    /**
     * Whether the first state read is still pending.
     */
    readonly loading: boolean;

    /**
     * Whether a settings mutation is in flight.
     */
    readonly saving: boolean;

    /**
     * Latest mutation outcome needing user guidance.
     */
    readonly notice: PopupNotice;

    /**
     * Changes global activation.
     *
     * @param enabled - Requested global activation state.
     * @returns - Promise settled after the outcome has been applied.
     */
    changeGlobal(enabled: boolean): Promise<void>;

    /**
     * Changes processing for the current hostname under the active mode.
     *
     * @param enabled - Whether processing should apply to the hostname.
     * @returns - Promise settled after the outcome has been applied.
     */
    changeSite(enabled: boolean): Promise<void>;

    /**
     * Restores every setting to its default from the failure view.
     *
     * @returns - Promise settled after the reset attempt completes.
     */
    resetAll(): Promise<void>;

    /**
     * Latest outcome of a log download from the failure view.
     */
    readonly downloadNotice: string | undefined;

    /**
     * Whether a log download is in flight.
     */
    readonly downloading: boolean;

    /**
     * Downloads retained diagnostic logs from the failure view.
     *
     * @returns - Promise settled after the download attempt completes.
     */
    downloadLogs(): Promise<void>;
}

/**
 * Creates the popup controller.
 *
 * @param options - Client, preloaded state, and notification subscriber.
 * @returns - Popup state together with its mutation commands.
 */
export function usePopupController(options: PopupControllerOptions = {}): PopupController {
    const client = useMemo(() => options.client ?? createPopupClient(), [options.client]);
    const subscribe = useMemo(
        () => options.subscribe ?? createDefaultSettingsChangedSubscriber(),
        [options.subscribe],
    );
    const [state, setState] = useState<PopupState | undefined>(options.initialState);
    const [loading, setLoading] = useState(options.initialState === undefined);
    const [saving, setSaving] = useState(false);
    const [notice, setNotice] = useState<PopupNotice>();
    const [downloadNotice, setDownloadNotice] = useState<string>();
    const [downloading, setDownloading] = useState(false);
    const inFlight = useRef(false);
    const downloadInFlight = useRef(false);

    useEffect(() => {
        if (options.initialState) {
            return;
        }
        let mounted = true;
        const loadTimeout = globalThis.setTimeout(() => {
            if (mounted) {
                setState(createUnavailablePopupState());
                setLoading(false);
            }
        }, POPUP_STATE_LOAD_TIMEOUT_MS);
        void client.getState().then(
            (next) => {
                if (!mounted) {
                    return;
                }
                globalThis.clearTimeout(loadTimeout);
                setState(next);
                setLoading(false);
            },
            () => {
                if (!mounted) {
                    return;
                }
                globalThis.clearTimeout(loadTimeout);
                setState(createUnavailablePopupState());
                setLoading(false);
            },
        );
        return () => {
            mounted = false;
            globalThis.clearTimeout(loadTimeout);
        };
    }, [client, options.initialState]);

    const refresh = useCallback(() => {
        if (inFlight.current) {
            return;
        }
        void client.getState().then(
            (next) => {
                setState(next);
                setNotice("external-change");
            },
            () => undefined,
        );
    }, [client]);

    useSettingsChanged(subscribe, state?.revision ?? null, refresh);

    const apply = (next: PopupState | undefined, outcome: PopupNotice): void => {
        if (next && (next.availability !== STATE_AVAILABILITY.READY
            || state?.availability !== STATE_AVAILABILITY.READY
            || next.revision >= state.revision)) {
            setState(next);
        }
        setNotice(outcome);
    };

    const unavailable = (hostname: string | null): PopupState => {
        const base = createUnavailablePopupState(SETTINGS_STATE_FAILURE.SETTINGS_LOAD);
        return base.availability === STATE_AVAILABILITY.UNAVAILABLE
            ? { ...base, hostname }
            : base;
    };

    const changeGlobal = async (enabled: boolean): Promise<void> => {
        if (!state || state.availability !== STATE_AVAILABILITY.READY || inFlight.current) {
            return;
        }
        inFlight.current = true;
        setSaving(true);
        setNotice(undefined);
        const result = await client.setGlobalEnabled(enabled);
        if (result.kind === CLIENT_RESULT_KIND.RESPONSE) {
            apply(
                result.response.state,
                result.response.ok
                    ? undefined
                    : result.response.error === "save-failed" ? "save-failed" : "unknown",
            );
        } else if (result.state) {
            apply(result.state, "interrupted");
        } else {
            setState(unavailable(state.hostname));
            setNotice("unknown");
        }
        inFlight.current = false;
        setSaving(false);
    };

    const changeSite = async (enabled: boolean): Promise<void> => {
        if (
            !state
            || state.availability !== STATE_AVAILABILITY.READY
            || state.hostname === null
            || inFlight.current
        ) {
            return;
        }
        inFlight.current = true;
        setSaving(true);
        setNotice(undefined);
        const result = await client.setSiteEnabled(state.hostname, enabled);
        if (result.kind === CLIENT_RESULT_KIND.RESPONSE) {
            apply(
                result.response.state,
                result.response.ok
                    ? undefined
                    : result.response.error === "save-failed"
                        ? "save-failed"
                        : result.response.error === "invalid-hostname"
                            ? "invalid-hostname"
                            : "unknown",
            );
        } else if (result.state) {
            apply(result.state, "interrupted");
        } else {
            setState(unavailable(state.hostname));
            setNotice("unknown");
        }
        inFlight.current = false;
        setSaving(false);
    };

    const resetAll = async (): Promise<void> => {
        if (inFlight.current) {
            return;
        }
        inFlight.current = true;
        setSaving(true);
        setNotice(undefined);
        const reset = await client.resetAllSettings();
        inFlight.current = false;
        if (!reset) {
            setNotice("unknown");
            setSaving(false);
            return;
        }
        try {
            setState(await client.getState());
        } catch {
            setNotice("unknown");
        } finally {
            setSaving(false);
        }
    };

    const downloadLogs = async (): Promise<void> => {
        if (downloadInFlight.current) {
            return;
        }
        downloadInFlight.current = true;
        setDownloading(true);
        setDownloadNotice(undefined);
        try {
            const result = await client.getDiagnosticsSnapshot();
            if (result.kind === CLIENT_RESULT_KIND.ERROR) {
                setDownloadNotice(diagnosticsErrorText(result.error));
                return;
            }
            try {
                const bytes = createDiagnosticsZip(result.snapshot);
                downloadDiagnosticsZip(bytes, options.archiveRuntime);
                setDownloadNotice(POPUP_DIAGNOSTICS_DOWNLOADED_NOTICE);
            } catch (error) {
                setDownloadNotice(
                    error instanceof DiagnosticArchiveError
                        ? error.message
                        : "The diagnostic archive could not be downloaded. Try again later.",
                );
            }
        } finally {
            downloadInFlight.current = false;
            setDownloading(false);
        }
    };

    return {
        state,
        loading,
        saving,
        notice,
        changeGlobal,
        changeSite,
        resetAll,
        downloadNotice,
        downloading,
        downloadLogs,
    };
}
