/**
 * @file Shared mapping from mutation outcomes to the notices both surfaces show.
 */

import { CLIENT_RESULT_KIND, type MutationResult } from "../client-result";
import type { SiteSettingsError } from "../messaging/view-state-values";

/**
 * User-visible outcome of a settings mutation shared by the popup and Settings.
 */
export type MutationNotice =
    | "save-failed"
    | "invalid-hostname"
    | "list-full"
    | "interrupted"
    | "unknown"
    | undefined;

/**
 * Maps a persistence error to its notice. Only `settings-unavailable` changes
 * name, because the surface cannot tell whether the write landed.
 *
 * @param error - Error returned by a settings command.
 * @returns - Notice to show for the error.
 */
export function persistenceNotice(error: SiteSettingsError): MutationNotice {
    return error === "settings-unavailable" ? "unknown" : error;
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
        ? { state: result.state, notice: "interrupted" }
        : { state: undefined, notice: "unknown" };
}

/**
 * Maps a shared mutation notice to its sentence.
 *
 * @param notice - Outcome reported after a settings mutation.
 * @param retryHint - Sentence telling the user how to try again on this surface.
 * @returns - Message to display, or undefined when there is nothing to show.
 */
export function mutationNoticeText(
    notice: MutationNotice,
    retryHint: string,
): string | undefined {
    if (notice === "save-failed") {
        return "Could not save this change. Try again.";
    }
    if (notice === "invalid-hostname") {
        return "This hostname is invalid. Use an exact hostname without a scheme, port, path, "
            + "or wildcard.";
    }
    if (notice === "list-full") {
        return "This list is full. Remove a hostname before adding another.";
    }
    if (notice === "interrupted") {
        return "The response was interrupted. Current state was reloaded.";
    }
    if (notice === "unknown") {
        return `Could not confirm whether the change was saved. ${retryHint}`;
    }
    return undefined;
}
