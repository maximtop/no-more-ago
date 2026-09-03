/**
 * @file Owns editable display settings and their persistence lifecycle as a state machine.
 */

import { useMachine } from "@xstate/react";
import { assertEvent, assign, fromPromise, setup, waitFor, type SnapshotFrom } from "xstate";
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
import type { AppearanceSetResult, DisplaySetResult, SitesClient } from "./client";
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
 * Events the display machine reacts to.
 */
const DISPLAY_EVENT = {
    EDIT: "EDIT",
    SAVE: "SAVE",
    CHANGE_APPEARANCE: "CHANGE_APPEARANCE",
    RELOAD: "RELOAD",
    BEGIN_RESET: "BEGIN_RESET",
    RELOAD_AFTER_RESET: "RELOAD_AFTER_RESET",
} as const;

/**
 * Event sent to the display machine by one of the controller commands.
 */
type DisplayEvent =
    | {
        /**
         * The user changed the draft.
         */
        readonly type: typeof DISPLAY_EVENT.EDIT;

        /**
         * Fields that changed.
         */
        readonly patch: Partial<DisplayDraft>;
    }
    | {
        /**
         * The user asked to persist the draft.
         */
        readonly type: typeof DISPLAY_EVENT.SAVE;
    }
    | {
        /**
         * The user picked a new appearance.
         */
        readonly type: typeof DISPLAY_EVENT.CHANGE_APPEARANCE;

        /**
         * Appearance to persist.
         */
        readonly appearance: Appearance;
    }
    | {
        /**
         * Another surface committed a change; reread the projection.
         */
        readonly type: typeof DISPLAY_EVENT.RELOAD;
    }
    | {
        /**
         * A full settings reset began elsewhere on the page.
         */
        readonly type: typeof DISPLAY_EVENT.BEGIN_RESET;
    }
    | {
        /**
         * The reset was committed; reread the default projection.
         */
        readonly type: typeof DISPLAY_EVENT.RELOAD_AFTER_RESET;
    };

/**
 * Everything the display form renders, owned by the machine.
 */
interface DisplayContext {
    /**
     * Client used by the load and save actors.
     */
    readonly client: SitesClient;

    /**
     * Whether a missing preloaded state is read on start.
     */
    readonly loadWhenMissing: boolean;

    /**
     * Committed display projection, once loaded.
     */
    readonly state: DisplayState | undefined;

    /**
     * Editable fields, present once a ready projection was loaded.
     */
    readonly draft: DisplayDraft | undefined;

    /**
     * Latest outcome that needs user guidance.
     */
    readonly notice: DisplayNotice;

    /**
     * Whether the latest appearance save was rejected.
     */
    readonly appearanceFailed: boolean;

    /**
     * Whether the pending load follows a full reset, whose failure is reported.
     */
    readonly afterReset: boolean;
}

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
 * @param context - Current machine context.
 * @returns - Whether the user has unsaved edits.
 */
function isDirty(context: DisplayContext): boolean {
    return context.draft !== undefined
        && context.state?.availability === STATE_AVAILABILITY.READY
        && !sameDisplaySettings(displayFromDraft(context.draft), context.state.display);
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
 * Returns the draft while the form is ready, where it always exists.
 *
 * @param context - Current machine context.
 * @returns - Current draft.
 */
function requireDraft(context: DisplayContext): DisplayDraft {
    if (context.draft === undefined) {
        throw new Error("The display form has no draft while it is ready");
    }
    return context.draft;
}

/**
 * Context changes produced by a settled display save.
 *
 * @param context - Current machine context.
 * @param result - Save result returned by the client.
 * @returns - Committed state, draft, and notice after the save.
 */
function settleSave(
    context: DisplayContext,
    result: DisplaySetResult,
): Pick<DisplayContext, "state" | "draft" | "notice"> {
    if (result.kind !== CLIENT_RESULT_KIND.RESPONSE) {
        if (result.state === undefined) {
            return {
                state: createUnavailableDisplayState(),
                draft: context.draft,
                notice: DISPLAY_NOTICE.UNKNOWN,
            };
        }
        return accepts(context.state, result.state)
            ? {
                state: result.state,
                draft: draftFor(result.state, context.draft),
                notice: DISPLAY_NOTICE.INTERRUPTED,
            }
            : { state: context.state, draft: context.draft, notice: DISPLAY_NOTICE.INTERRUPTED };
    }
    const { response } = result;
    let notice: DisplayNotice = DISPLAY_NOTICE.SAVED;
    if (!response.ok) {
        notice = displayNoticeForError(response.error);
    } else if (response.refreshFailures.length > 0) {
        notice = DISPLAY_NOTICE.PARTIAL_REFRESH;
    }
    if (!accepts(context.state, response.state)) {
        return { state: context.state, draft: context.draft, notice };
    }
    // A rejected pattern stays in the form for correction; every other
    // outcome shows the committed display.
    const keepDraft = !response.ok && response.error === DISPLAY_SETTINGS_ERROR.INVALID_FORMAT;
    return {
        state: response.state,
        draft: keepDraft ? context.draft : draftFor(response.state, context.draft),
        notice,
    };
}

/**
 * Context changes produced by a live reread after another surface committed.
 *
 * @param context - Current machine context.
 * @param next - Projection returned by the reread.
 * @returns - Committed state, draft, and notice after the reread.
 */
function settleReload(
    context: DisplayContext,
    next: DisplayState,
): Pick<DisplayContext, "state" | "draft" | "notice"> {
    const kept = { state: context.state, draft: context.draft, notice: context.notice };
    // An older projection is dropped: one lost message does not mean
    // processing stopped, and the next announcement retries.
    if (!accepts(context.state, next)) {
        return kept;
    }
    if (next.availability !== STATE_AVAILABILITY.READY) {
        return { ...kept, state: next };
    }
    // A reread that only moved the revision, because another section of
    // this page or another surface changed something else, keeps the draft
    // and says nothing about it.
    if (
        context.state?.availability === STATE_AVAILABILITY.READY
        && sameDisplaySettings(context.state.display, next.display)
    ) {
        return { ...kept, state: next };
    }
    return isDirty(context)
        ? { ...kept, state: next, notice: DISPLAY_NOTICE.EXTERNAL_CHANGE }
        : { ...kept, state: next, draft: draftFromDisplay(next.display) };
}

/**
 * Context changes produced by a settled appearance save.
 *
 * @param context - Current machine context.
 * @param result - Save result returned by the client.
 * @returns - Committed state and failure flag after the save.
 */
function settleAppearance(
    context: DisplayContext,
    result: AppearanceSetResult,
): Pick<DisplayContext, "state" | "appearanceFailed"> {
    const next = result.kind === CLIENT_RESULT_KIND.RESPONSE ? result.response.state : result.state;
    const failed = result.kind === CLIENT_RESULT_KIND.RESPONSE
        ? !result.response.ok
        : result.state === undefined;
    return {
        state: next !== undefined && accepts(context.state, next) ? next : context.state,
        appearanceFailed: failed,
    };
}

/**
 * Reports whether a projection is the fail-closed one.
 *
 * @param state - Projection to inspect.
 * @returns - Whether the projection is unavailable.
 */
function isUnavailable(state: DisplayState | undefined): boolean {
    return state?.availability === STATE_AVAILABILITY.UNAVAILABLE;
}

const displayMachine = setup({
    types: {
        context: {} as DisplayContext,
        events: {} as DisplayEvent,
        input: {} as DisplayControllerOptions,
    },
    actors: {
        loadDisplay: fromPromise<DisplayState, { readonly client: SitesClient }>(
            ({ input }) => input.client.getDisplayState(),
        ),
        saveDisplay: fromPromise<
            DisplaySetResult,
            { readonly client: SitesClient; readonly draft: DisplayDraft }
        >(({ input }) => input.client.setDisplaySettings(displayFromDraft(input.draft))),
        saveAppearance: fromPromise<
            AppearanceSetResult,
            { readonly client: SitesClient; readonly appearance: Appearance }
        >(({ input }) => input.client.setAppearance(input.appearance)),
    },
    guards: {
        stateReady: ({ context }) => context.state?.availability === STATE_AVAILABILITY.READY,
        stateLoaded: ({ context }) => context.state !== undefined,
        loadsWhenMissing: ({ context }) => context.loadWhenMissing,
        invalidPattern: ({ context }) => {
            const draft = requireDraft(context);
            return draft.formatMode === FORMAT_MODE.CUSTOM
                && customPatternError(draft.pattern) !== undefined;
        },
        invalidIdentifier: ({ context }) => {
            const draft = requireDraft(context);
            return draft.timeZoneMode === TIME_ZONE_MODE.IANA
                && validateIdentifier(draft.identifier) !== undefined;
        },
    },
    actions: {
        edit: assign(({ context }, params: { readonly patch: Partial<DisplayDraft> }) => ({
            draft: context.draft ? { ...context.draft, ...params.patch } : context.draft,
            notice: undefined,
        })),
        reject: assign((_, params: { readonly notice: DisplayNotice }) => ({
            notice: params.notice,
        })),
        clearNotice: assign({ notice: undefined }),
        adoptLoaded: assign(({ context }, params: { readonly state: DisplayState }) => ({
            state: params.state,
            draft: draftFor(params.state, context.draft),
            notice: undefined,
            afterReset: false,
        })),
        failLoad: assign(({ context }) => ({
            state: createUnavailableDisplayState(),
            notice: context.afterReset ? DISPLAY_NOTICE.UNKNOWN : undefined,
            afterReset: false,
        })),
        settleSave: assign(({ context }, params: { readonly result: DisplaySetResult }) =>
            settleSave(context, params.result)),
        failSave: assign({
            state: createUnavailableDisplayState(),
            notice: DISPLAY_NOTICE.UNKNOWN,
        }),
        settleReload: assign(({ context }, params: { readonly next: DisplayState }) =>
            settleReload(context, params.next)),
        startAppearance: assign({ appearanceFailed: false }),
        settleAppearance: assign(({ context }, params: { readonly result: AppearanceSetResult }) =>
            settleAppearance(context, params.result)),
        failAppearance: assign({ appearanceFailed: true }),
        beginReset: assign({
            draft: DEFAULT_DISPLAY_DRAFT,
            notice: undefined,
            afterReset: true,
        }),
    },
}).createMachine({
    id: "display",
    context: ({ input }) => ({
        client: input.client,
        loadWhenMissing: input.loadWhenMissing,
        state: input.initialState,
        draft: input.initialState === undefined
            ? undefined
            : draftFor(input.initialState, undefined),
        notice: undefined,
        appearanceFailed: false,
        afterReset: false,
    }),
    initial: "deciding",
    states: {
        // Picks the first state from the preloaded projection, if any.
        deciding: {
            always: [
                { guard: "stateReady", target: "ready" },
                { guard: "stateLoaded", target: "unavailable" },
                { guard: "loadsWhenMissing", target: "loading" },
                { target: "blank" },
            ],
        },
        // Nothing preloaded and nothing requested: waits for a reread or a reset.
        blank: {
            on: {
                [DISPLAY_EVENT.RELOAD]: { target: "loading" },
                [DISPLAY_EVENT.BEGIN_RESET]: { target: "resetting", actions: "beginReset" },
            },
        },
        // Initial read, post-reset read, or a reread while nothing is ready.
        loading: {
            invoke: {
                src: "loadDisplay",
                input: ({ context }) => ({ client: context.client }),
                onDone: [
                    {
                        guard: ({ event }) => isUnavailable(event.output),
                        actions: {
                            type: "adoptLoaded",
                            params: ({ event }) => ({ state: event.output }),
                        },
                        target: "unavailable",
                    },
                    {
                        actions: {
                            type: "adoptLoaded",
                            params: ({ event }) => ({ state: event.output }),
                        },
                        target: "ready",
                    },
                ],
                onError: { actions: "failLoad", target: "unavailable" },
            },
        },
        // The page reset every setting; the default projection is reread on request.
        resetting: {
            on: {
                [DISPLAY_EVENT.RELOAD_AFTER_RESET]: { target: "loading" },
            },
        },
        unavailable: {
            on: {
                [DISPLAY_EVENT.RELOAD]: { target: "loading" },
                [DISPLAY_EVENT.BEGIN_RESET]: { target: "resetting", actions: "beginReset" },
            },
        },
        // A ready projection: the form, the appearance picker, and live rereads
        // run independently, and any of them can find settings gone.
        ready: {
            type: "parallel",
            on: {
                [DISPLAY_EVENT.EDIT]: {
                    actions: { type: "edit", params: ({ event }) => ({ patch: event.patch }) },
                },
                [DISPLAY_EVENT.BEGIN_RESET]: { target: "resetting", actions: "beginReset" },
            },
            states: {
                form: {
                    initial: "idle",
                    states: {
                        idle: {
                            on: {
                                [DISPLAY_EVENT.SAVE]: [
                                    {
                                        guard: "invalidPattern",
                                        actions: {
                                            type: "reject",
                                            params: { notice: DISPLAY_NOTICE.INVALID_FORMAT },
                                        },
                                    },
                                    {
                                        guard: "invalidIdentifier",
                                        actions: {
                                            type: "reject",
                                            params: { notice: DISPLAY_NOTICE.INVALID_TIME_ZONE },
                                        },
                                    },
                                    { target: "saving", actions: "clearNotice" },
                                ],
                            },
                        },
                        saving: {
                            invoke: {
                                src: "saveDisplay",
                                input: ({ context }) => ({
                                    client: context.client,
                                    draft: requireDraft(context),
                                }),
                                onDone: [
                                    {
                                        guard: ({ context, event }) =>
                                            isUnavailable(settleSave(context, event.output).state),
                                        actions: {
                                            type: "settleSave",
                                            params: ({ event }) => ({ result: event.output }),
                                        },
                                        target: "#display.unavailable",
                                    },
                                    {
                                        actions: {
                                            type: "settleSave",
                                            params: ({ event }) => ({ result: event.output }),
                                        },
                                        target: "idle",
                                    },
                                ],
                                onError: { actions: "failSave", target: "#display.unavailable" },
                            },
                        },
                    },
                },
                appearance: {
                    initial: "idle",
                    states: {
                        idle: {
                            on: {
                                [DISPLAY_EVENT.CHANGE_APPEARANCE]: {
                                    target: "saving",
                                    actions: "startAppearance",
                                },
                            },
                        },
                        saving: {
                            invoke: {
                                src: "saveAppearance",
                                input: ({ context, event }) => {
                                    assertEvent(event, DISPLAY_EVENT.CHANGE_APPEARANCE);
                                    return { client: context.client, appearance: event.appearance };
                                },
                                onDone: [
                                    {
                                        guard: ({ context, event }) => isUnavailable(
                                            settleAppearance(context, event.output).state,
                                        ),
                                        actions: {
                                            type: "settleAppearance",
                                            params: ({ event }) => ({ result: event.output }),
                                        },
                                        target: "#display.unavailable",
                                    },
                                    {
                                        actions: {
                                            type: "settleAppearance",
                                            params: ({ event }) => ({ result: event.output }),
                                        },
                                        target: "idle",
                                    },
                                ],
                                onError: { actions: "failAppearance", target: "idle" },
                            },
                        },
                    },
                },
                sync: {
                    initial: "idle",
                    states: {
                        idle: {
                            on: {
                                [DISPLAY_EVENT.RELOAD]: { target: "reloading" },
                            },
                        },
                        // A failed reread keeps the rendered projection.
                        reloading: {
                            invoke: {
                                src: "loadDisplay",
                                input: ({ context }) => ({ client: context.client }),
                                onDone: [
                                    {
                                        guard: ({ context, event }) => isUnavailable(
                                            settleReload(context, event.output).state,
                                        ),
                                        actions: {
                                            type: "settleReload",
                                            params: ({ event }) => ({ next: event.output }),
                                        },
                                        target: "#display.unavailable",
                                    },
                                    {
                                        actions: {
                                            type: "settleReload",
                                            params: ({ event }) => ({ next: event.output }),
                                        },
                                        target: "idle",
                                    },
                                ],
                                onError: { target: "idle" },
                            },
                        },
                    },
                },
            },
        },
    },
});

/**
 * Snapshot of the display machine.
 */
type DisplaySnapshot = SnapshotFrom<typeof displayMachine>;

/**
 * Reports whether a display save is in flight.
 *
 * @param snapshot - Machine snapshot.
 * @returns - Whether the form is saving.
 */
function isSaving(snapshot: DisplaySnapshot): boolean {
    return snapshot.matches({ ready: { form: "saving" } });
}

/**
 * Reports whether an appearance save is in flight.
 *
 * @param snapshot - Machine snapshot.
 * @returns - Whether the appearance picker is saving.
 */
function isAppearanceSaving(snapshot: DisplaySnapshot): boolean {
    return snapshot.matches({ ready: { appearance: "saving" } });
}

/**
 * Reports whether a read of the projection is in flight.
 *
 * @param snapshot - Machine snapshot.
 * @returns - Whether the machine is loading or rereading.
 */
function isReading(snapshot: DisplaySnapshot): boolean {
    return snapshot.matches("loading")
        || snapshot.matches({ ready: { sync: "reloading" } });
}

/**
 * Creates the display-settings controller for the options page.
 *
 * @param options - Controller dependencies and preload behavior.
 * @returns - Current display form state together with edit, save, and reset commands.
 */
export function useDisplayController(options: DisplayControllerOptions): DisplayController {
    const [snapshot, send, actor] = useMachine(displayMachine, { input: options });
    const { context } = snapshot;

    /**
     * Resolves once the machine leaves the activity the predicate describes.
     * A stopped machine has nothing left to apply, so that also resolves.
     *
     * @param active - Whether the awaited activity is still in flight.
     * @returns - A promise that settles after the activity ended.
     */
    const settled = (active: (current: DisplaySnapshot) => boolean): Promise<void> =>
        waitFor(actor, (current) => !active(current), { timeout: Infinity })
            .then(() => undefined, () => undefined);

    /**
     * Applies one draft edit and clears the current notice.
     *
     * @param patch - Fields that changed.
     */
    const edit = (patch: Partial<DisplayDraft>): void => {
        send({ type: DISPLAY_EVENT.EDIT, patch });
    };

    return {
        state: context.state,
        draft: context.draft,
        loading: snapshot.matches("loading") || snapshot.matches("resetting"),
        saving: isSaving(snapshot),
        appearanceSaving: isAppearanceSaving(snapshot),
        appearanceFailed: context.appearanceFailed,
        notice: context.notice,
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
        changeAppearance: (appearance) => {
            send({ type: DISPLAY_EVENT.CHANGE_APPEARANCE, appearance });
            return settled(isAppearanceSaving);
        },
        save: () => {
            send({ type: DISPLAY_EVENT.SAVE });
            return settled(isSaving);
        },
        beginReset: () => {
            send({ type: DISPLAY_EVENT.BEGIN_RESET });
        },
        reloadAfterReset: () => {
            send({ type: DISPLAY_EVENT.RELOAD_AFTER_RESET });
            return settled((current) => current.matches("loading"));
        },
        reload: () => {
            send({ type: DISPLAY_EVENT.RELOAD });
            return settled(isReading);
        },
    };
}
