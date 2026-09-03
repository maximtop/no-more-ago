/**
 * @file One diagnostics download flow and its notices, shared by both surfaces.
 */

import { CLIENT_RESULT_KIND } from "../client-result";
import {
    DIAGNOSTICS_ERROR,
    type DiagnosticsClearError,
    type DiagnosticsSnapshot,
    type DiagnosticsSnapshotError,
} from "../messaging/contracts";
import {
    DiagnosticArchiveError,
    createDiagnosticsZip,
    downloadDiagnosticsZip,
    type DownloadRuntime,
} from "./archive";

/**
 * Message used after a diagnostics archive is handed to the browser.
 */
export const DIAGNOSTICS_DOWNLOADED_NOTICE = "Diagnostic logs downloaded.";

/**
 * Message used after diagnostic entries are removed successfully.
 */
export const DIAGNOSTICS_CLEARED_NOTICE = "Diagnostic logs cleared.";

/**
 * Diagnostics snapshot or the reason it could not be read.
 */
export type DiagnosticsSnapshotResult =
    | {
        /**
         * Indicates that a validated diagnostic snapshot was returned.
         */
        readonly kind: typeof CLIENT_RESULT_KIND.RESPONSE;

        /**
         * Validated diagnostic snapshot ready for export.
         */
        readonly snapshot: DiagnosticsSnapshot;
    }
    | {
        /**
         * Indicates that no diagnostic snapshot could be returned.
         */
        readonly kind: typeof CLIENT_RESULT_KIND.ERROR;

        /**
         * Stable reason the snapshot request failed.
         */
        readonly error: DiagnosticsSnapshotError;
    };

/**
 * Maps a diagnostics service failure to user guidance.
 *
 * @param error - Stable service failure returned by the background page.
 * @returns - The message displayed to the user.
 */
export function diagnosticsErrorText(
    error: DiagnosticsSnapshotError | DiagnosticsClearError,
): string {
    if (error === DIAGNOSTICS_ERROR.DISABLED) {
        return "Debug logs are off. Turn them on to use saved diagnostics.";
    }
    if (error === DIAGNOSTICS_ERROR.EMPTY) {
        return "There are no diagnostic logs to download yet.";
    }
    if (error === DIAGNOSTICS_ERROR.INVALID_JOURNAL) {
        return "Saved diagnostic logs are invalid. Clear logs and try again.";
    }
    if (error === DIAGNOSTICS_ERROR.STORAGE_FAILED) {
        return "Saved diagnostic logs could not be read. Try again later.";
    }
    return "Diagnostic logs are unavailable. Try again later.";
}

/**
 * Reports whether a diagnostics notice describes a completed action.
 *
 * @param notice - Latest diagnostics notice.
 * @returns - Whether the notice is a success rather than a failure.
 */
export function isDiagnosticsSuccessNotice(notice: string): boolean {
    return notice === DIAGNOSTICS_DOWNLOADED_NOTICE || notice === DIAGNOSTICS_CLEARED_NOTICE;
}

/**
 * Compresses a read snapshot and hands it to the browser.
 *
 * @param result - Snapshot read from the background, or the reason it failed.
 * @param runtime - Browser download primitives, or undefined outside a document.
 * @returns - Notice describing the outcome.
 */
export function downloadDiagnosticsSnapshot(
    result: DiagnosticsSnapshotResult,
    runtime: DownloadRuntime | undefined,
): string {
    if (result.kind === CLIENT_RESULT_KIND.ERROR) {
        return diagnosticsErrorText(result.error);
    }
    if (!runtime) {
        return "Local downloads are unavailable in this context.";
    }
    try {
        downloadDiagnosticsZip(createDiagnosticsZip(result.snapshot), runtime);
        return DIAGNOSTICS_DOWNLOADED_NOTICE;
    } catch (error) {
        return error instanceof DiagnosticArchiveError
            ? error.message
            : "The diagnostic archive could not be downloaded. Try again later.";
    }
}
