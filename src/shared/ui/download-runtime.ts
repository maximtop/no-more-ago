/**
 * @file Browser-backed download runtime for diagnostic archives.
 */

import type { DownloadRuntime } from "../diagnostics/archive";

/**
 * Creates a download runtime over the page's Blob, URL, and document APIs.
 *
 * @returns - Download runtime, or undefined outside a browser document.
 */
export function createBrowserDownloadRuntime(): DownloadRuntime | undefined {
    if (
        typeof Blob === "undefined"
        || typeof URL === "undefined"
        || typeof document === "undefined"
    ) {
        return undefined;
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
