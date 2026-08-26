/**
 * @file Creates and downloads ZIP archives from validated diagnostic snapshots.
 */

import * as fflate from "fflate";
import type { DiagnosticsSnapshot } from "../background/message-contracts";

/**
 * JSON member stored inside a diagnostic archive.
 */
export const DIAGNOSTICS_ARCHIVE_MEMBER = "diagnostics.json" as const;

/**
 * Filename assigned to a downloaded diagnostic archive.
 */
export const DIAGNOSTICS_ARCHIVE_FILE = "no-more-ago-diagnostics.zip" as const;

/**
 * Stable archive failures shown by the options page.
 */
export type DiagnosticArchiveErrorCode =
    | "empty"
    | "compression-failed"
    | "download-failed";

/**
 * Validated snapshot accepted by archive creation.
 */
export type DiagnosticArchiveSnapshot = DiagnosticsSnapshot;

/**
 * ZIP encoder boundary used by archive creation.
 */
export type ZipEncoder = (files: Record<string, Uint8Array>) => Uint8Array;

/**
 * Browser primitives required to download an archive.
 */
export interface DownloadRuntime {
    /**
     * Blob constructor used for archive bytes.
     */
    readonly Blob: typeof Blob;

    /**
     * Creates a temporary archive URL.
     */
    readonly createObjectURL: (blob: Blob) => string;

    /**
     * Releases a temporary archive URL.
     */
    readonly revokeObjectURL: (url: string) => void;

    /**
     * Creates the temporary download anchor.
     */
    readonly createAnchor: () => {
        /**
         * Temporary object URL assigned before the click.
         */
        href: string;

        /**
         * Filename proposed to the browser.
         */
        download: string;

        /**
         * Starts the browser download.
         */
        click: () => void;

        /**
         * Removes the temporary anchor when supported.
         */
        remove?: () => void;
    };

    /**
     * Schedules temporary URL cleanup.
     */
    readonly scheduleRevoke: (callback: () => void) => void;
}

/**
 * Archive operation failure with a stable UI code.
 */
export class DiagnosticArchiveError extends Error {
    /**
     * Creates an archive failure.
     *
     * @param code - Stable UI error code.
     * @param message - Human-readable failure message.
     * @param options - Optional native error cause.
     */
    public constructor(
        public readonly code: DiagnosticArchiveErrorCode,
        message: string,
        options?: ErrorOptions,
    ) {
        super(message, options);
        this.name = "DiagnosticArchiveError";
    }
}

/**
 * Compresses one already validated diagnostic snapshot.
 *
 * @param snapshot - Snapshot returned by the validated options client.
 * @param encoder - ZIP encoder.
 * @returns - ZIP archive bytes.
 */
export function createDiagnosticsZip(
    snapshot: DiagnosticArchiveSnapshot,
    encoder: ZipEncoder = fflate.zipSync,
): Uint8Array {
    if (snapshot.entries.length === 0) {
        throw new DiagnosticArchiveError("empty", "There are no diagnostic entries to download.");
    }
    try {
        const json = fflate.strToU8(JSON.stringify(snapshot));
        return encoder({ [DIAGNOSTICS_ARCHIVE_MEMBER]: new Uint8Array(json) });
    } catch (cause) {
        throw new DiagnosticArchiveError(
            "compression-failed",
            "The diagnostic archive could not be created.",
            { cause },
        );
    }
}

/**
 * Creates a browser-backed download runtime.
 *
 * @returns - Download runtime for the options page.
 */
function defaultDownloadRuntime(): DownloadRuntime {
    if (
        typeof Blob === "undefined"
        || typeof URL === "undefined"
        || typeof document === "undefined"
    ) {
        throw new DiagnosticArchiveError(
            "download-failed",
            "Local downloads are unavailable in this context.",
        );
    }
    return {
        Blob,
        createObjectURL: (blob) => URL.createObjectURL(blob),
        revokeObjectURL: (url) => {
            URL.revokeObjectURL(url);
        },
        createAnchor: () => {
            const anchor = document.createElement("a");
            document.body.append(anchor);
            return anchor;
        },
        scheduleRevoke: (callback) => {
            setTimeout(callback, 0);
        },
    };
}

/**
 * Downloads prepared diagnostic ZIP bytes.
 *
 * @param bytes - ZIP archive bytes.
 * @param runtime - Optional browser download primitives.
 */
export function downloadDiagnosticsZip(bytes: Uint8Array, runtime?: DownloadRuntime): void {
    const browser = runtime ?? defaultDownloadRuntime();
    let objectUrl: string | undefined;
    let anchor: ReturnType<DownloadRuntime["createAnchor"]> | undefined;
    try {
        const archive = new Uint8Array(bytes);
        objectUrl = browser.createObjectURL(
            new browser.Blob([archive.buffer], { type: "application/zip" }),
        );
        anchor = browser.createAnchor();
        anchor.href = objectUrl;
        anchor.download = DIAGNOSTICS_ARCHIVE_FILE;
        anchor.click();
        const url = objectUrl;
        browser.scheduleRevoke(() => {
            browser.revokeObjectURL(url);
        });
        anchor.remove?.();
    } catch (cause) {
        if (objectUrl !== undefined) {
            browser.revokeObjectURL(objectUrl);
        }
        anchor?.remove?.();
        throw new DiagnosticArchiveError(
            "download-failed",
            "The diagnostic archive could not be downloaded.",
            { cause },
        );
    }
}
