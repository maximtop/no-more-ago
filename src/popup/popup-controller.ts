/**
 * @file Owns popup state, its mutations, and live background refreshes.
 */

import {
    useCallback, useEffect, useMemo, useRef, useState,
} from 'react';

import { downloadDiagnosticsSnapshot } from '../shared/diagnostics/download';
import {
    INERT_SETTINGS_CHANGED_SUBSCRIBER,
    type SubscribeSettingsChanged,
} from '../shared/messaging/settings-notifications';
import {
    createUnavailablePopupState,
    type PopupState,
} from '../shared/messaging/view-state';
import { STATE_AVAILABILITY } from '../shared/messaging/view-state-values';
import {
    MUTATION_NOTICE,
    settleMutation,
    type MutationNotice,
} from '../shared/ui/persistence-notice';
import { readWithDeadline } from '../shared/ui/read-with-deadline';
import { useSettingsChanged } from '../shared/ui/use-settings-changed';

import { createPopupClient, type PopupClient } from './client';

import type { DownloadRuntime } from '../shared/diagnostics/archive';
import type { MessageKey } from '../shared/i18n/translator';

/**
 * Named popup notices: every shared mutation outcome plus an external change.
 */
export const POPUP_NOTICE = {
    ...MUTATION_NOTICE,
    EXTERNAL_CHANGE: 'external-change',
} as const;

/**
 * User-visible outcome of a popup settings mutation or an external change.
 */
export type PopupNotice = MutationNotice | typeof POPUP_NOTICE.EXTERNAL_CHANGE;

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
     *
     * @returns - Promise settled after the outcome has been applied.
     */
    changeGlobal(enabled: boolean): Promise<void>;

    /**
     * Changes processing for the current hostname under the active mode.
     *
     * @param enabled - Whether processing should apply to the hostname.
     *
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
    readonly downloadNotice: MessageKey | undefined;

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
 *
 * @returns - Popup state together with its mutation commands.
 */
export function usePopupController(options: PopupControllerOptions = {}): PopupController {
    const client = useMemo(() => options.client ?? createPopupClient(), [options.client]);
    const subscribe = options.subscribe ?? INERT_SETTINGS_CHANGED_SUBSCRIBER;
    const [state, setState] = useState<PopupState | undefined>(options.initialState);
    const [loading, setLoading] = useState(options.initialState === undefined);
    const [saving, setSaving] = useState(false);
    const [notice, setNotice] = useState<PopupNotice>();
    const [downloadNotice, setDownloadNotice] = useState<MessageKey>();
    const [downloading, setDownloading] = useState(false);
    const inFlight = useRef(false);
    const downloadInFlight = useRef(false);

    useEffect(() => {
        if (options.initialState) {
            return undefined;
        }
        let mounted = true;
        void readWithDeadline(client.getState()).then(
            (next) => {
                if (mounted) {
                    setState(next);
                    setLoading(false);
                }
            },
            () => {
                if (mounted) {
                    setState(createUnavailablePopupState());
                    setLoading(false);
                }
            },
        );
        return () => {
            mounted = false;
        };
    }, [client, options.initialState]);

    const refresh = useCallback(() => {
        void client.getState().then(
            (next) => {
                setState(next);
                setNotice(POPUP_NOTICE.EXTERNAL_CHANGE);
            },
            () => undefined,
        );
    }, [client]);

    useSettingsChanged({
        subscribe,
        revision: state?.revision ?? null,
        inFlight: saving,
        onExternalChange: refresh,
    });

    /**
     * Applies a settled mutation's projection and notice.
     *
     * @param next - Projection carried by the response, or undefined when it was lost.
     * @param outcome - Notice describing the outcome.
     */
    const apply = (next: PopupState | undefined, outcome: PopupNotice): void => {
        if (next === undefined) {
            setState(createUnavailablePopupState(undefined, state?.hostname ?? null));
        } else if (
            next.availability !== STATE_AVAILABILITY.READY
            || state?.availability !== STATE_AVAILABILITY.READY
            || next.revision >= state.revision
        ) {
            setState(next);
        }
        setNotice(outcome);
    };

    /**
     * Saves global activation from the popup.
     *
     * @param enabled - Requested global activation state.
     *
     * @returns - A promise that settles after the outcome has been applied.
     */
    const changeGlobal = async (enabled: boolean): Promise<void> => {
        if (!state || state.availability !== STATE_AVAILABILITY.READY || inFlight.current) {
            return;
        }
        inFlight.current = true;
        setSaving(true);
        setNotice(undefined);
        const settled = settleMutation(await client.setGlobalEnabled(enabled));
        apply(settled.state, settled.notice);
        inFlight.current = false;
        setSaving(false);
    };

    /**
     * Saves processing for the current hostname under the rendered scope mode.
     *
     * @param enabled - Whether processing should apply to the hostname.
     *
     * @returns - A promise that settles after the outcome has been applied.
     */
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
        const settled = settleMutation(
            await client.setSiteEnabled(state.hostname, enabled, state.scopeMode),
        );
        apply(settled.state, settled.notice);
        inFlight.current = false;
        setSaving(false);
    };

    /**
     * Resets every setting from the recovery view and rereads the popup state.
     *
     * @returns - A promise that settles after the reset attempt completes.
     */
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
            setNotice(POPUP_NOTICE.UNKNOWN);
            setSaving(false);
            return;
        }
        try {
            setState(await client.getState());
        } catch {
            setNotice(POPUP_NOTICE.UNKNOWN);
        } finally {
            setSaving(false);
        }
    };

    /**
     * Downloads retained diagnostic logs from the recovery view.
     *
     * @returns - A promise that settles after the download attempt.
     */
    const downloadLogs = async (): Promise<void> => {
        if (downloadInFlight.current) {
            return;
        }
        downloadInFlight.current = true;
        setDownloading(true);
        setDownloadNotice(undefined);
        try {
            setDownloadNotice(downloadDiagnosticsSnapshot(
                await client.getDiagnosticsSnapshot(),
                options.archiveRuntime,
            ));
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
