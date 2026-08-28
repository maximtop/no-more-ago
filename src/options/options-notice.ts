/**
 * @file Defines the shared mutation notice displayed by the options page.
 */

/**
 * User-visible outcome of a site or Debug logs mutation.
 */
export type OptionsNotice =
    | "save-failed"
    | "invalid-hostname"
    | "interrupted"
    | "unknown"
    | "debug-save-failed"
    | "debug-interrupted"
    | "debug-unknown"
    | undefined;

/**
 * Maps a site or Debug logs outcome to its user-visible error message.
 *
 * @param notice Outcome reported after a settings mutation.
 * @returns An error message, or undefined when there is no notice to show.
 */
export function optionsNoticeText(notice: OptionsNotice): string | undefined {
    if (notice === "save-failed") {
        return "Could not save this change. Try again.";
    }
    if (notice === "invalid-hostname") {
        return "This hostname is invalid. Use an exact hostname without a scheme, port, path, "
            + "or wildcard.";
    }
    if (notice === "interrupted") {
        return "The response was interrupted. Current state was reloaded.";
    }
    if (notice === "unknown") {
        return "Could not confirm whether the change was saved. Reopen Settings to try again. "
            + "Current state is unavailable.";
    }
    if (notice === "debug-save-failed") {
        return "Could not save the Debug logs setting. Try again.";
    }
    if (notice === "debug-interrupted") {
        return "The Debug logs response was interrupted. Current state was reloaded.";
    }
    if (notice === "debug-unknown") {
        return "Could not confirm the Debug logs setting. Reopen Settings to try again.";
    }
    return undefined;
}
