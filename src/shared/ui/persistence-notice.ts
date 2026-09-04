/**
 * @file Shared mapping from mutation outcomes to the notices both surfaces show.
 */

import { CLIENT_RESULT_KIND, type MutationResult } from "../client-result";
import type { MessageKey } from "../i18n/translator";
import {
    SETTINGS_PERSISTENCE_ERROR,
    SITE_SETTINGS_ERROR,
    type SiteSettingsError,
} from "../messaging/view-state-values";

/**
 * Named outcomes of a settings mutation shared by the popup and Settings.
 */
export const MUTATION_NOTICE = {
    SAVE_FAILED: SITE_SETTINGS_ERROR.SAVE_FAILED,
    INVALID_HOSTNAME: SITE_SETTINGS_ERROR.INVALID_HOSTNAME,
    LIST_FULL: SITE_SETTINGS_ERROR.LIST_FULL,
    SCOPE_CHANGED: SITE_SETTINGS_ERROR.SCOPE_CHANGED,
    INTERRUPTED: "interrupted",
    UNKNOWN: "unknown",
} as const;

/**
 * User-visible outcome of a settings mutation, or undefined when there is none.
 */
export type MutationNotice =
    | (typeof MUTATION_NOTICE)[keyof typeof MUTATION_NOTICE]
    | undefined;

/**
 * Maps a persistence error to its notice. Only `settings-unavailable` changes
 * name, because the surface cannot tell whether the write landed.
 *
 * @param error - Error returned by a settings command.
 * @returns - Notice to show for the error.
 */
export function persistenceNotice(error: SiteSettingsError): MutationNotice {
    return error === SETTINGS_PERSISTENCE_ERROR.SETTINGS_UNAVAILABLE
        ? MUTATION_NOTICE.UNKNOWN
        : error;
}

/**
 * State and notice to apply after a mutation settles.
 */
export interface SettledMutation<TState> {
    /**
     * State to render, or undefined when neither the response nor a reread produced one.
     */
    readonly state: TState | undefined;

    /**
     * Notice to show alongside the state.
     */
    readonly notice: MutationNotice;
}

/**
 * Turns a mutation result into the state and notice a controller applies.
 *
 * @param result - Validated response or ambiguous reread.
 * @returns - State to render and the notice to show.
 */
export function settleMutation<TState>(
    result: MutationResult<
        | { readonly ok: true; readonly state: TState }
        | { readonly ok: false; readonly error: SiteSettingsError; readonly state: TState },
        TState
    >,
): SettledMutation<TState> {
    if (result.kind === CLIENT_RESULT_KIND.RESPONSE) {
        return {
            state: result.response.state,
            notice: result.response.ok ? undefined : persistenceNotice(result.response.error),
        };
    }
    return result.state
        ? { state: result.state, notice: MUTATION_NOTICE.INTERRUPTED }
        : { state: undefined, notice: MUTATION_NOTICE.UNKNOWN };
}

/**
 * Surface whose wording an ambiguous-outcome notice should use.
 */
export const NOTICE_SURFACE = {
    POPUP: "popup",
    OPTIONS: "options",
} as const;

/**
 * Surface selecting the wording of the ambiguous-outcome notice.
 */
export type NoticeSurface = (typeof NOTICE_SURFACE)[keyof typeof NOTICE_SURFACE];

/**
 * Message mapping for every supported outcome.
 */
const MUTATION_NOTICE_KEYS = {
    [MUTATION_NOTICE.SAVE_FAILED]: {
        [NOTICE_SURFACE.POPUP]: "notice_save_failed",
        [NOTICE_SURFACE.OPTIONS]: "notice_save_failed",
    },
    [MUTATION_NOTICE.INVALID_HOSTNAME]: {
        [NOTICE_SURFACE.POPUP]: "notice_invalid_hostname",
        [NOTICE_SURFACE.OPTIONS]: "notice_invalid_hostname",
    },
    [MUTATION_NOTICE.LIST_FULL]: {
        [NOTICE_SURFACE.POPUP]: "notice_list_full",
        [NOTICE_SURFACE.OPTIONS]: "notice_list_full",
    },
    [MUTATION_NOTICE.SCOPE_CHANGED]: {
        [NOTICE_SURFACE.POPUP]: "notice_scope_changed",
        [NOTICE_SURFACE.OPTIONS]: "notice_scope_changed",
    },
    [MUTATION_NOTICE.INTERRUPTED]: {
        [NOTICE_SURFACE.POPUP]: "notice_interrupted",
        [NOTICE_SURFACE.OPTIONS]: "notice_interrupted",
    },
    [MUTATION_NOTICE.UNKNOWN]: {
        [NOTICE_SURFACE.POPUP]: "notice_unknown_popup",
        [NOTICE_SURFACE.OPTIONS]: "notice_unknown_options",
    },
} as const satisfies Record<Exclude<MutationNotice, undefined>, Record<NoticeSurface, MessageKey>>;

/**
 * Maps a shared mutation notice to the message key describing it.
 *
 * @param notice - Outcome reported after a settings mutation.
 * @param surface - Surface whose retry wording applies.
 * @returns - Message key to render, or undefined when there is nothing to show.
 */
export function mutationNoticeKey(
    notice: MutationNotice,
    surface: NoticeSurface,
): MessageKey | undefined {
    return notice === undefined ? undefined : MUTATION_NOTICE_KEYS[notice][surface];
}
