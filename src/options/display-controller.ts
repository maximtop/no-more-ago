/**
 * @file Owns editable display settings and their persistence lifecycle.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
    SETTINGS_STATE_FAILURE,
    STATE_AVAILABILITY,
} from "../shared/messaging/view-state-values";
import type { DisplayState } from "../shared/messaging/view-state-schemas";
import { CLIENT_RESULT_KIND } from "../shared/client-result";
import { APPEARANCE, type Appearance } from "../shared/settings/snapshot";
import type { SitesClient } from "./client";
import {
    customPatternError,
    displayFromDraft,
    draftFromDisplay,
    validateIdentifier,
    type DisplayDraft,
    type DisplayNotice,
} from "./display-form";

/**
 * Dependencies and optional initial state for display settings.
 */
export interface DisplayControllerOptions {
    /**
     * Client used to load and mutate display settings.
     */
    readonly client: SitesClient;

    /**
     * Preloaded display settings that avoid the initial request.
     */
    readonly initialState: DisplayState | undefined;

    /**
     * Whether a missing preloaded state should be read from the background service.
     */
    readonly loadWhenMissing: boolean;
}

/**
 * Display-settings state and commands consumed by its view and the reset coordinator.
 */
export interface DisplayController {
    /**
     * Current validated display settings, once available.
     */
    readonly state: DisplayState | undefined;

    /**
     * Editable fields derived from the latest committed display settings.
     */
    readonly draft: DisplayDraft | undefined;

    /**
     * Whether display settings are being loaded.
     */
    readonly loading: boolean;

    /**
     * Whether a display-settings save is in flight.
     */
    readonly saving: boolean;

    /**
     * Latest display-settings outcome that needs user guidance.
     */
    readonly notice: DisplayNotice;

    /**
     * Selects browser formatting or a custom pattern.
     *
     * @param mode - New date-format mode.
     */
    setFormatMode(mode: DisplayDraft["formatMode"]): void;

    /**
     * Changes the retained custom date-format pattern.
     *
     * @param pattern - New date-format pattern.
     */
    setPattern(pattern: string): void;

    /**
     * Selects the system, UTC, or named time-zone mode.
     *
     * @param mode - New time-zone mode.
     */
    setTimeZoneMode(mode: DisplayDraft["timeZoneMode"]): void;

    /**
     * Changes the retained IANA time-zone identifier.
     *
     * @param identifier - New IANA time-zone identifier.
     */
    setIdentifier(identifier: string): void;

    /**
     * Whether an appearance change is being saved.
     */
    readonly appearanceSaving: boolean;

    /**
     * Whether the latest appearance change could not be saved.
     */
    readonly appearanceFailed: boolean;

    /**
     * Saves a new appearance immediately, leaving any unsaved display draft untouched.
     *
     * @param appearance - New appearance choice.
     * @returns - A promise that settles after the outcome has been applied.
     */
    changeAppearance(appearance: Appearance): Promise<void>;

    /**
     * Validates and persists the current display draft.
     *
     * @returns - A promise that settles after the save outcome has been applied.
     */
    save(): Promise<void>;

    /**
     * Clears notices and exposes a default draft while reset rehydration begins.
     */
    beginReset(): void;

    /**
     * Rehydrates display settings after all persisted settings were reset.
     *
     * @returns - A promise that settles after the fresh projection has been applied.
     */
    reloadAfterReset(): Promise<void>;

    /**
     * Rereads display settings after another surface changed them, keeping an edited draft.
     *
     * @returns - A promise that settles after the fresh projection has been applied.
     */
    reload(): Promise<void>;
}

const UNAVAILABLE_DISPLAY_STATE: DisplayState = {
    availability: STATE_AVAILABILITY.UNAVAILABLE,
    revision: null,
    display: null,
    appearance: APPEARANCE.SYSTEM,
    failure: SETTINGS_STATE_FAILURE.SETTINGS_LOAD,
};
const DEFAULT_DISPLAY_DRAFT = draftFromDisplay({
    formatMode: "system",
    timeZone: { mode: "system" },
});

/**
 * Creates the display-settings controller for the options page.
 *
 * @param options - Controller dependencies and preload behavior.
 * @returns - Current display form state together with edit, save, and reset commands.
 */
export function useDisplayController(options: DisplayControllerOptions): DisplayController {
    const { client, initialState, loadWhenMissing } = options;
    const [state, setState] = useState<DisplayState | undefined>(initialState);
    const [loading, setLoading] = useState(initialState === undefined);
    const [draft, setDraft] = useState<DisplayDraft | undefined>(
        initialState?.availability === STATE_AVAILABILITY.READY
            ? draftFromDisplay(initialState.display)
            : undefined,
    );
    const [notice, setNotice] = useState<DisplayNotice>();
    const [saving, setSaving] = useState(false);
    const [appearanceSaving, setAppearanceSaving] = useState(false);
    const [appearanceFailed, setAppearanceFailed] = useState(false);
    const dirty = useRef(false);

    useEffect(() => {
        if (initialState || !loadWhenMissing) {
            setLoading(false);
            return;
        }
        let mounted = true;
        void client
            .getDisplayState()
            .then((next) => {
                if (!mounted) {
                    return;
                }
                setState(next);
                if (next.availability === STATE_AVAILABILITY.READY) {
                    setDraft(draftFromDisplay(next.display));
                }
                setLoading(false);
            })
            .catch(() => {
                if (!mounted) {
                    return;
                }
                setState(UNAVAILABLE_DISPLAY_STATE);
                setLoading(false);
            });
        return () => {
            mounted = false;
        };
    }, [client, initialState, loadWhenMissing]);

    const updateDraft = (update: Partial<DisplayDraft>): void => {
        dirty.current = true;
        setDraft((current) => (current ? { ...current, ...update } : current));
        setNotice(undefined);
    };

    const adopt = (next: DisplayState): void => {
        setState(next);
        if (next.availability === STATE_AVAILABILITY.READY) {
            setDraft(draftFromDisplay(next.display));
            dirty.current = false;
        }
    };

    const save = async (): Promise<void> => {
        if (!state || state.availability !== STATE_AVAILABILITY.READY || !draft || saving) {
            return;
        }
        if (draft.formatMode === "custom" && customPatternError(draft.pattern)) {
            setNotice("invalid-format");
            return;
        }
        if (draft.timeZoneMode === "iana" && validateIdentifier(draft.identifier)) {
            setNotice("invalid-time-zone");
            return;
        }
        setSaving(true);
        setNotice(undefined);
        const result = await client.setDisplaySettings(displayFromDraft(draft), state.appearance);
        if (result.kind === CLIENT_RESULT_KIND.RESPONSE) {
            const responseState = result.response.state;
            if (
                responseState.availability !== STATE_AVAILABILITY.READY ||
                responseState.revision >= state.revision
            ) {
                if (
                    responseState.availability === STATE_AVAILABILITY.READY &&
                    (result.response.ok || result.response.error !== "invalid-format")
                ) {
                    adopt(responseState);
                } else {
                    setState(responseState);
                }
            }
            if (!result.response.ok) {
                setNotice(
                    result.response.error === "invalid-time-zone" ||
                        result.response.error === "invalid-display-settings"
                        ? "invalid-time-zone"
                        : result.response.error === "invalid-format"
                            ? "invalid-format"
                            : result.response.error === "save-failed"
                                ? "save-failed"
                                : "unknown",
                );
            } else if (result.response.refreshFailures.length > 0) {
                setNotice("partial-refresh");
            } else {
                setNotice("saved");
            }
        } else if (result.state) {
            if (
                result.state.availability !== STATE_AVAILABILITY.READY
                || result.state.revision >= state.revision
            ) {
                adopt(result.state);
            }
            setNotice("interrupted");
        } else {
            setState(UNAVAILABLE_DISPLAY_STATE);
            setNotice("unknown");
        }
        setSaving(false);
    };

    const reloadAfterReset = async (): Promise<void> => {
        try {
            adopt(await client.getDisplayState());
        } catch {
            setState(UNAVAILABLE_DISPLAY_STATE);
            setNotice("unknown");
        } finally {
            setLoading(false);
        }
    };

    const reload = useCallback(async (): Promise<void> => {
        try {
            const next = await client.getDisplayState();
            setState(next);
            if (next.availability !== STATE_AVAILABILITY.READY) {
                return;
            }
            if (dirty.current) {
                setNotice("external-change");
            } else {
                setDraft(draftFromDisplay(next.display));
            }
        } catch {
            setState(UNAVAILABLE_DISPLAY_STATE);
        }
    }, [client]);

    const changeAppearance = async (appearance: Appearance): Promise<void> => {
        if (!state || state.availability !== STATE_AVAILABILITY.READY || appearanceSaving) {
            return;
        }
        setAppearanceSaving(true);
        setAppearanceFailed(false);
        const result = await client.setDisplaySettings(state.display, appearance);
        if (result.kind === CLIENT_RESULT_KIND.RESPONSE) {
            const responseState = result.response.state;
            if (
                responseState.availability !== STATE_AVAILABILITY.READY
                || responseState.revision >= state.revision
            ) {
                setState(responseState);
            }
            setAppearanceFailed(!result.response.ok);
        } else if (result.state) {
            setState(result.state);
        } else {
            setAppearanceFailed(true);
        }
        setAppearanceSaving(false);
    };

    return {
        state,
        draft,
        loading,
        saving,
        appearanceSaving,
        appearanceFailed,
        notice,
        setFormatMode: (formatMode) => {
            updateDraft({ formatMode });
        },
        setPattern: (pattern) => {
            updateDraft({ pattern });
        },
        setTimeZoneMode: (timeZoneMode) => {
            updateDraft({ timeZoneMode });
        },
        setIdentifier: (identifier) => {
            updateDraft({ identifier });
        },
        changeAppearance,
        save,
        beginReset: () => {
            setNotice(undefined);
            setDraft(DEFAULT_DISPLAY_DRAFT);
            dirty.current = false;
            setLoading(true);
        },
        reloadAfterReset,
        reload,
    };
}
