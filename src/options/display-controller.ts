/**
 * @file Owns editable display settings and their persistence lifecycle.
 */

import { useEffect, useReducer } from "react";
import { STATE_AVAILABILITY } from "../shared/messaging/view-state-values";
import {
    createUnavailableDisplayState,
    type DisplayState,
} from "../shared/messaging/view-state-schemas";
import { CLIENT_RESULT_KIND } from "../shared/client-result";
import {
    FORMAT_MODE,
    TIME_ZONE_MODE,
    sameDisplaySettings,
    type Appearance,
} from "../shared/settings/snapshot";
import {
    DISPLAY_SETTINGS_ERROR,
    type DisplaySettingsError,
} from "../shared/messaging/view-state-values";
import type { SitesClient } from "./client";
import {
    DISPLAY_NOTICE,
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
    readonly reload: () => Promise<void>;
}

/**
 * Everything the display form renders, changed only by the transitions below.
 */
interface DisplayModel {
    /**
     * Committed display projection, once loaded.
     */
    readonly state: DisplayState | undefined;

    /**
     * Editable fields, present once a ready projection was loaded.
     */
    readonly draft: DisplayDraft | undefined;

    /**
     * Whether an initial or post-reset read is pending.
     */
    readonly loading: boolean;

    /**
     * Whether a display-settings save is in flight.
     */
    readonly saving: boolean;

    /**
     * Whether an appearance save is in flight.
     */
    readonly appearanceSaving: boolean;

    /**
     * Whether the latest appearance save was rejected.
     */
    readonly appearanceFailed: boolean;

    /**
     * Latest outcome that needs user guidance.
     */
    readonly notice: DisplayNotice;
}

/**
 * Named transitions of the display model.
 */
const DISPLAY_EVENT = {
    LOADED: "loaded",
    EDITED: "edited",
    REJECTED: "rejected",
    SAVE_STARTED: "save-started",
    SAVE_SETTLED: "save-settled",
    APPEARANCE_STARTED: "appearance-started",
    APPEARANCE_SETTLED: "appearance-settled",
    RESET_STARTED: "reset-started",
    RELOADED: "reloaded",
} as const;

/**
 * Transition of the display model.
 */
type DisplayEvent =
    | {
        /**
         * An initial or post-reset read settled.
         */
        readonly type: typeof DISPLAY_EVENT.LOADED;

        /**
         * Projection returned by the read, or the unavailable projection.
         */
        readonly state: DisplayState;

        /**
         * Guidance to show beside the loaded projection, when the read failed.
         */
        readonly notice?: DisplayNotice;
    }
    | {
        /**
         * The user changed the draft.
         */
        readonly type: typeof DISPLAY_EVENT.EDITED;

        /**
         * Fields that changed.
         */
        readonly patch: Partial<DisplayDraft>;
    }
    | {
        /**
         * The draft was rejected before a save was attempted.
         */
        readonly type: typeof DISPLAY_EVENT.REJECTED;

        /**
         * Reason the draft was rejected.
         */
        readonly notice: DisplayNotice;
    }
    | {
        /**
         * A display-settings save was dispatched.
         */
        readonly type: typeof DISPLAY_EVENT.SAVE_STARTED;
    }
    | {
        /**
         * A display-settings save settled.
         */
        readonly type: typeof DISPLAY_EVENT.SAVE_SETTLED;

        /**
         * Projection carried by the response, or undefined when settings became unavailable.
         */
        readonly state: DisplayState | undefined;

        /**
         * Whether the draft keeps the user's edits instead of the committed display.
         */
        readonly keepDraft: boolean;

        /**
         * Outcome to show beside the form.
         */
        readonly notice: DisplayNotice;
    }
    | {
        /**
         * An appearance save was dispatched.
         */
        readonly type: typeof DISPLAY_EVENT.APPEARANCE_STARTED;
    }
    | {
        /**
         * An appearance save settled.
         */
        readonly type: typeof DISPLAY_EVENT.APPEARANCE_SETTLED;

        /**
         * Projection carried by the response, or undefined when it was lost.
         */
        readonly state: DisplayState | undefined;

        /**
         * Whether the save was rejected.
         */
        readonly failed: boolean;
    }
    | {
        /**
         * A full settings reset began elsewhere on the page.
         */
        readonly type: typeof DISPLAY_EVENT.RESET_STARTED;
    }
    | {
        /**
         * A live reread settled after another surface committed a change.
         */
        readonly type: typeof DISPLAY_EVENT.RELOADED;

        /**
         * Projection returned by the reread.
         */
        readonly state: DisplayState;
    };

const DEFAULT_DISPLAY_DRAFT = draftFromDisplay({
    formatMode: FORMAT_MODE.SYSTEM,
    timeZone: { mode: TIME_ZONE_MODE.SYSTEM },
});

/**
 * Maps a rejected display command to the notice shown beside the form.
 *
 * @param error - Error returned by the display-settings command.
 * @returns - Notice describing the rejection.
 */
function displayNoticeForError(error: DisplaySettingsError): DisplayNotice {
    if (
        error === DISPLAY_SETTINGS_ERROR.INVALID_TIME_ZONE
        || error === DISPLAY_SETTINGS_ERROR.INVALID_DISPLAY_SETTINGS
    ) {
        return DISPLAY_NOTICE.INVALID_TIME_ZONE;
    }
    if (error === DISPLAY_SETTINGS_ERROR.INVALID_FORMAT) {
        return DISPLAY_NOTICE.INVALID_FORMAT;
    }
    if (error === DISPLAY_SETTINGS_ERROR.SAVE_FAILED) {
        return DISPLAY_NOTICE.SAVE_FAILED;
    }
    return DISPLAY_NOTICE.UNKNOWN;
}

/**
 * Reports whether the draft differs from the committed display settings.
 *
 * @param model - Current display model.
 * @returns - Whether the user has unsaved edits.
 */
function isDirty(model: DisplayModel): boolean {
    return model.draft !== undefined
        && model.state?.availability === STATE_AVAILABILITY.READY
        && !sameDisplaySettings(displayFromDraft(model.draft), model.state.display);
}

/**
 * Reports whether a projection returned by a command may replace the rendered one.
 *
 * @param current - Rendered projection.
 * @param next - Projection returned by the command or reread.
 * @returns - Whether the projection is at least as new as the rendered one.
 */
function accepts(current: DisplayState | undefined, next: DisplayState): boolean {
    return next.availability !== STATE_AVAILABILITY.READY
        || current?.availability !== STATE_AVAILABILITY.READY
        || next.revision >= current.revision;
}

/**
 * Builds the draft for a projection, or keeps the current draft while it is unavailable.
 *
 * @param state - Projection to edit.
 * @param current - Draft rendered so far.
 * @returns - Draft matching the projection's committed display, or the current draft.
 */
function draftFor(
    state: DisplayState,
    current: DisplayDraft | undefined,
): DisplayDraft | undefined {
    return state.availability === STATE_AVAILABILITY.READY
        ? draftFromDisplay(state.display)
        : current;
}

/**
 * Applies one transition to the display model. Every legal combination of
 * committed state, draft, activity, and notice is produced here, so the
 * commands below only decide which transition their outcome is.
 *
 * @param model - Current display model.
 * @param event - Transition to apply.
 * @returns - Next display model.
 */
function reduceDisplay(model: DisplayModel, event: DisplayEvent): DisplayModel {
    switch (event.type) {
        case DISPLAY_EVENT.LOADED:
            return {
                ...model,
                state: event.state,
                draft: draftFor(event.state, model.draft),
                loading: false,
                notice: event.notice,
            };
        case DISPLAY_EVENT.EDITED:
            return model.draft
                ? { ...model, draft: { ...model.draft, ...event.patch }, notice: undefined }
                : model;
        case DISPLAY_EVENT.REJECTED:
            return { ...model, notice: event.notice };
        case DISPLAY_EVENT.SAVE_STARTED:
            return { ...model, saving: true, notice: undefined };
        case DISPLAY_EVENT.SAVE_SETTLED: {
            const settled = { ...model, saving: false, notice: event.notice };
            if (event.state === undefined) {
                return { ...settled, state: createUnavailableDisplayState() };
            }
            if (!accepts(model.state, event.state)) {
                return settled;
            }
            return {
                ...settled,
                state: event.state,
                draft: event.keepDraft ? model.draft : draftFor(event.state, model.draft),
            };
        }
        case DISPLAY_EVENT.APPEARANCE_STARTED:
            return { ...model, appearanceSaving: true, appearanceFailed: false };
        case DISPLAY_EVENT.APPEARANCE_SETTLED:
            return {
                ...model,
                appearanceSaving: false,
                appearanceFailed: event.failed,
                state: event.state !== undefined && accepts(model.state, event.state)
                    ? event.state
                    : model.state,
            };
        case DISPLAY_EVENT.RESET_STARTED:
            return { ...model, draft: DEFAULT_DISPLAY_DRAFT, loading: true, notice: undefined };
        case DISPLAY_EVENT.RELOADED: {
            // A failed reread never reaches here, and an older projection is
            // dropped: one lost message does not mean processing stopped, and
            // the next announcement retries.
            if (!accepts(model.state, event.state)) {
                return model;
            }
            if (event.state.availability !== STATE_AVAILABILITY.READY) {
                return { ...model, state: event.state };
            }
            // A reread that only moved the revision, because another section
            // of this page or another surface changed something else, keeps
            // the draft and says nothing about it.
            if (
                model.state?.availability === STATE_AVAILABILITY.READY
                && sameDisplaySettings(model.state.display, event.state.display)
            ) {
                return { ...model, state: event.state };
            }
            return isDirty(model)
                ? { ...model, state: event.state, notice: DISPLAY_NOTICE.EXTERNAL_CHANGE }
                : { ...model, state: event.state, draft: draftFromDisplay(event.state.display) };
        }
        default:
            return model;
    }
}

/**
 * Builds the model rendered before any command runs.
 *
 * @param initialState - Preloaded projection, when any.
 * @returns - Initial display model.
 */
function initialModel(initialState: DisplayState | undefined): DisplayModel {
    return {
        state: initialState,
        draft: initialState === undefined ? undefined : draftFor(initialState, undefined),
        loading: initialState === undefined,
        saving: false,
        appearanceSaving: false,
        appearanceFailed: false,
        notice: undefined,
    };
}

/**
 * Creates the display-settings controller for the options page.
 *
 * @param options - Controller dependencies and preload behavior.
 * @returns - Current display form state together with edit, save, and reset commands.
 */
export function useDisplayController(options: DisplayControllerOptions): DisplayController {
    const { client, initialState, loadWhenMissing } = options;
    const [model, dispatch] = useReducer(reduceDisplay, initialState, initialModel);
    const { state, draft, saving, appearanceSaving } = model;

    useEffect(() => {
        if (initialState || !loadWhenMissing) {
            return;
        }
        let mounted = true;
        void client.getDisplayState().then(
            (next) => {
                if (mounted) {
                    dispatch({ type: DISPLAY_EVENT.LOADED, state: next });
                }
            },
            () => {
                if (mounted) {
                    dispatch({
                        type: DISPLAY_EVENT.LOADED,
                        state: createUnavailableDisplayState(),
                    });
                }
            },
        );
        return () => {
            mounted = false;
        };
    }, [client, initialState, loadWhenMissing]);

    /**
     * Validates the draft locally, then persists it and applies the outcome.
     *
     * @returns - A promise that settles after the save outcome has been applied.
     */
    const save = async (): Promise<void> => {
        if (!state || state.availability !== STATE_AVAILABILITY.READY || !draft || saving) {
            return;
        }
        if (draft.formatMode === FORMAT_MODE.CUSTOM && customPatternError(draft.pattern)) {
            dispatch({ type: DISPLAY_EVENT.REJECTED, notice: DISPLAY_NOTICE.INVALID_FORMAT });
            return;
        }
        if (draft.timeZoneMode === TIME_ZONE_MODE.IANA && validateIdentifier(draft.identifier)) {
            dispatch({ type: DISPLAY_EVENT.REJECTED, notice: DISPLAY_NOTICE.INVALID_TIME_ZONE });
            return;
        }
        dispatch({ type: DISPLAY_EVENT.SAVE_STARTED });
        const result = await client.setDisplaySettings(displayFromDraft(draft));
        if (result.kind === CLIENT_RESULT_KIND.RESPONSE) {
            const { response } = result;
            // A rejected pattern stays in the form for correction; every other
            // outcome shows the committed display.
            const keepDraft = !response.ok
                && response.error === DISPLAY_SETTINGS_ERROR.INVALID_FORMAT;
            let notice: DisplayNotice = DISPLAY_NOTICE.SAVED;
            if (!response.ok) {
                notice = displayNoticeForError(response.error);
            } else if (response.refreshFailures.length > 0) {
                notice = DISPLAY_NOTICE.PARTIAL_REFRESH;
            }
            dispatch({
                type: DISPLAY_EVENT.SAVE_SETTLED,
                state: response.state,
                keepDraft,
                notice,
            });
            return;
        }
        dispatch({
            type: DISPLAY_EVENT.SAVE_SETTLED,
            state: result.state,
            keepDraft: false,
            notice: result.state ? DISPLAY_NOTICE.INTERRUPTED : DISPLAY_NOTICE.UNKNOWN,
        });
    };

    /**
     * Rereads display settings after a full reset replaced every setting.
     *
     * @returns - A promise that settles after the fresh projection has been applied.
     */
    const reloadAfterReset = async (): Promise<void> => {
        try {
            dispatch({ type: DISPLAY_EVENT.LOADED, state: await client.getDisplayState() });
        } catch {
            dispatch({
                type: DISPLAY_EVENT.LOADED,
                state: createUnavailableDisplayState(),
                notice: DISPLAY_NOTICE.UNKNOWN,
            });
        }
    };

    /**
     * Rereads display settings after another surface committed a change. A
     * failed reread keeps the rendered projection.
     *
     * @returns - A promise that settles after the fresh projection has been applied.
     */
    const reload = async (): Promise<void> => {
        let next: DisplayState;
        try {
            next = await client.getDisplayState();
        } catch {
            return;
        }
        dispatch({ type: DISPLAY_EVENT.RELOADED, state: next });
    };

    /**
     * Saves a new appearance immediately, leaving any unsaved display draft untouched.
     *
     * @param appearance - New appearance choice.
     * @returns - A promise that settles after the outcome has been applied.
     */
    const changeAppearance = async (appearance: Appearance): Promise<void> => {
        if (!state || state.availability !== STATE_AVAILABILITY.READY || appearanceSaving) {
            return;
        }
        dispatch({ type: DISPLAY_EVENT.APPEARANCE_STARTED });
        const result = await client.setAppearance(appearance);
        if (result.kind === CLIENT_RESULT_KIND.RESPONSE) {
            dispatch({
                type: DISPLAY_EVENT.APPEARANCE_SETTLED,
                state: result.response.state,
                failed: !result.response.ok,
            });
            return;
        }
        dispatch({
            type: DISPLAY_EVENT.APPEARANCE_SETTLED,
            state: result.state,
            failed: result.state === undefined,
        });
    };

    /**
     * Applies one draft edit and clears the current notice.
     *
     * @param patch - Fields that changed.
     */
    const edit = (patch: Partial<DisplayDraft>): void => {
        dispatch({ type: DISPLAY_EVENT.EDITED, patch });
    };

    return {
        state,
        draft,
        loading: model.loading,
        saving,
        appearanceSaving,
        appearanceFailed: model.appearanceFailed,
        notice: model.notice,
        setFormatMode: (formatMode) => {
            edit({ formatMode });
        },
        setPattern: (pattern) => {
            edit({ pattern });
        },
        setTimeZoneMode: (timeZoneMode) => {
            edit({ timeZoneMode });
        },
        setIdentifier: (identifier) => {
            edit({ identifier });
        },
        changeAppearance,
        save,
        beginReset: () => {
            dispatch({ type: DISPLAY_EVENT.RESET_STARTED });
        },
        reloadAfterReset,
        reload,
    };
}
