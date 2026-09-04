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
    DIAGNOSTIC_ARCHIVE_ERROR,
    DiagnosticArchiveError,
    createDiagnosticsZip,
    downloadDiagnosticsZip,
    type DiagnosticArchiveErrorCode,
    type DownloadRuntime,
} from "./archive";
import type { MessageKey } from "../i18n/translator";

/**
 * Key used after a diagnostics archive is handed to the browser.
 */
export const DIAGNOSTICS_DOWNLOADED_KEY: MessageKey = "diagnostics_downloaded";

/**
 * Key used after diagnostic entries are removed successfully.
 */
export const DIAGNOSTICS_CLEARED_KEY: MessageKey = "diagnostics_cleared";

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
 * Maps a diagnostics service failure to its message key.
 *
 * @param error - Stable service failure returned by the background page.
 * @returns - Message key describing the failure.
 */
export function diagnosticsErrorKey(
    error: DiagnosticsSnapshotError | DiagnosticsClearError,
): MessageKey {
    if (error === DIAGNOSTICS_ERROR.DISABLED) {
        return "diagnostics_error_disabled";
    }
    if (error === DIAGNOSTICS_ERROR.EMPTY) {
        return "diagnostics_error_empty";
    }
    if (error === DIAGNOSTICS_ERROR.INVALID_JOURNAL) {
        return "diagnostics_error_invalid";
    }
    if (error === DIAGNOSTICS_ERROR.STORAGE_FAILED) {
        return "diagnostics_error_unreadable";
    }
    return "diagnostics_error_unavailable";
}

/**
 * Reports whether a diagnostics notice key describes a completed action.
 *
 * @param notice - Latest diagnostics notice key.
 * @returns - Whether the notice is a success rather than a failure.
 */
export function isDiagnosticsSuccessNotice(notice: MessageKey): boolean {
    return notice === DIAGNOSTICS_DOWNLOADED_KEY || notice === DIAGNOSTICS_CLEARED_KEY;
}

/**
 * Message key describing each stable archive failure.
 */
const ARCHIVE_ERROR_KEY: Readonly<Record<DiagnosticArchiveErrorCode, MessageKey>> = Object.freeze({
    [DIAGNOSTIC_ARCHIVE_ERROR.EMPTY]: "diagnostics_error_archive_empty",
    [DIAGNOSTIC_ARCHIVE_ERROR.COMPRESSION_FAILED]: "diagnostics_error_archive_create",
    [DIAGNOSTIC_ARCHIVE_ERROR.DOWNLOAD_FAILED]: "diagnostics_error_archive_download",
});

/**
 * Compresses a read snapshot and hands it to the browser.
 *
 * @param result - Snapshot read from the background, or the reason it failed.
 * @param runtime - Browser download primitives, or undefined outside a document.
 * @returns - Message key describing the outcome.
 */
export function downloadDiagnosticsSnapshot(
    result: DiagnosticsSnapshotResult,
    runtime: DownloadRuntime | undefined,
): MessageKey {
    if (result.kind === CLIENT_RESULT_KIND.ERROR) {
        return diagnosticsErrorKey(result.error);
    }
    if (!runtime) {
        return "diagnostics_error_no_downloads";
    }
    try {
        downloadDiagnosticsZip(createDiagnosticsZip(result.snapshot), runtime);
        return DIAGNOSTICS_DOWNLOADED_KEY;
    } catch (error) {
        return error instanceof DiagnosticArchiveError
            ? ARCHIVE_ERROR_KEY[error.code]
            : "diagnostics_error_archive";
    }
}
