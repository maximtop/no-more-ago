/**
 * @file Validates, compresses, and downloads bounded diagnostic snapshots.
 */

import { strToU8, zipSync } from "fflate";
import {
    DIAGNOSTICS_MAX_BYTES,
    hasOnlyOwnDiagnosticProperties,
    isDiagnosticJournalEntries,
} from "./journal";
import type { DiagnosticEvent } from "./events";

/**
 * Stable failure reasons surfaced by archive creation without exposing implementation exceptions.
 */
export type DiagnosticArchiveErrorCode =
    | "empty"
    | "invalid-snapshot"
    | "compression-failed"
    | "download-failed";

/**
 * Signals a user-facing archive failure with a stable code and the original error message.
 *
 */
export class DiagnosticArchiveError extends Error {
    /**
     * Constructs a typed archive error with a stable UI code, message, and optional native cause.
     *
     * @param code - Stable failure code presented by the options UI.
     * @param message - Human-readable archive failure description.
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
 * Bounded journal state that can be serialized without reading browser storage again.
 */
export interface DiagnosticArchiveSnapshot {
    /**
     * Newest-first diagnostic events retained within the byte limit.
     */
    readonly entries: readonly DiagnosticEvent[];

    /**
     * Extension and browser metadata included in exported diagnostics.
     */
    readonly environment: {
        /**
         * Coarse browser family reported without a user-agent string.
         */
        readonly browserFamily: "chromium" | "firefox" | "other";

        /**
         * Extension version captured when the event is created.
         */
        readonly extensionVersion?: string;
    };
}

/**
 * Compression boundary accepting UTF-8 file contents and returning a complete ZIP payload.
 */
export type ZipEncoder = (files: Record<string, Uint8Array>) => Uint8Array;

/**
 * Minimal browser APIs required to download an archive and release its temporary URL.
 */
export interface DownloadRuntime {
    /**
     * Blob constructor used to wrap the ZIP byte payload for download.
     */
    readonly Blob: typeof Blob;

    /**
     * Allocates a temporary URL pointing at the archive blob.
     */
    readonly createObjectURL: (blob: Blob) => string;

    /**
     * Releases the temporary object URL after download has been scheduled.
     */
    readonly revokeObjectURL: (url: string) => void;

    /**
     * Supplies an anchor whose configured click invokes the browser download flow.
     */
    readonly createAnchor: () => {
        /**
         * Destination URL assigned before the synthetic click.
         */
        href: string;

        /**
         * Starts a download and resolves to its browser-assigned identifier.
         */
        download: string;

        /**
         * Triggers the browser download after the anchor is configured.
         */
        click: () => void;

        /**
         * Deletes the supplied storage keys.
         */
        remove?: () => void;
    };

    /**
     * Defers URL cleanup until the browser has consumed the download request.
     */
    readonly scheduleRevoke: (callback: () => void) => void;
}

const ENVIRONMENT_KEYS = new Set(["browserFamily", "extensionVersion"]);

/**
 * Accepts a plain object for defensive archive payload parsing.
 *
 * @param value - Untrusted archive payload value.
 * @returns - Whether the value is a non-array object record.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Verifies the exact exported snapshot shape before compression to prevent unsafe archive contents.
 *
 * @param value - Untrusted diagnostics snapshot value.
 * @returns - Whether the value has the exact safe export shape.
 */
export function isDiagnosticArchiveSnapshot(value: unknown): value is DiagnosticArchiveSnapshot {
    if (
        !isRecord(value) ||
        !hasOnlyOwnDiagnosticProperties(value) ||
        Object.keys(value).length !== 2 ||
        !Object.hasOwn(value, "entries") ||
        !Object.hasOwn(value, "environment") ||
        !Array.isArray(value.entries) ||
        !isRecord(value.environment) ||
        !hasOnlyOwnDiagnosticProperties(value.environment) ||
        Object.keys(value.environment).some((key) => !ENVIRONMENT_KEYS.has(key)) ||
        !Object.hasOwn(value.environment, "browserFamily") ||
        ("extensionVersion" in value.environment &&
            !Object.hasOwn(value.environment, "extensionVersion")) ||
        !["chromium", "firefox", "other"].includes(String(value.environment.browserFamily))
    ) {
        return false;
    }
    if (
        Object.hasOwn(value.environment, "extensionVersion") &&
        (typeof value.environment.extensionVersion !== "string" ||
            !/^[0-9A-Za-z][0-9A-Za-z._+-]{0,31}$/u.test(value.environment.extensionVersion))
    ) {
        return false;
    }
    return isDiagnosticJournalEntries(value.entries, DIAGNOSTICS_MAX_BYTES);
}

/**
 * Serializes the validated snapshot as UTF-8 JSON and returns its compressed ZIP bytes.
 *
 * @param snapshot - Validated redacted diagnostics snapshot.
 * @param encoder - ZIP encoder used to create the archive.
 * @returns - Compressed ZIP archive bytes.
 */
export function createDiagnosticsZip(snapshot: unknown, encoder: ZipEncoder = zipSync): Uint8Array {
    if (!isDiagnosticArchiveSnapshot(snapshot)) {
        throw new DiagnosticArchiveError(
            "invalid-snapshot",
            "The diagnostic snapshot is invalid or unsafe.",
        );
    }
    if (snapshot.entries.length === 0) {
        throw new DiagnosticArchiveError("empty", "There are no diagnostic entries to download.");
    }
    try {
        const safeEntries = snapshot.entries.map((entry) => {
            const safeEntry: Record<string, unknown> = { ...entry };
            if (entry.stack !== undefined) {
                safeEntry.stack = [...entry.stack];
            }
            return safeEntry;
        });
        const journalBytes = strToU8(JSON.stringify({ entries: safeEntries }));
        if (journalBytes.byteLength > DIAGNOSTICS_MAX_BYTES) {
            throw new DiagnosticArchiveError(
                "invalid-snapshot",
                "The diagnostic snapshot is too large to download.",
            );
        }
        const exportSnapshot = {
            entries: safeEntries,
            environment: { ...snapshot.environment },
        };
        const json = JSON.stringify(exportSnapshot);
        const jsonBytes = strToU8(json);
        // Copy into this realm so browser extension bundlers and isolated test
        // contexts agree that the value is a byte array rather than a directory.
        return encoder({ "diagnostics.json": new Uint8Array(jsonBytes) });
    } catch (cause) {
        if (cause instanceof DiagnosticArchiveError) {
            throw cause;
        }
        throw new DiagnosticArchiveError(
            "compression-failed",
            "The diagnostic archive could not be created.",
            { cause },
        );
    }
}

/**
 * Adapts the browser downloads API used to publish the diagnostics archive.
 *
 * @returns - Browser download runtime backed by the Chrome downloads API.
 */
function defaultDownloadRuntime(): DownloadRuntime {
    if (
        typeof Blob === "undefined" ||
        typeof URL === "undefined" ||
        typeof document === "undefined"
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
 * Builds and downloads a ZIP archive containing the redacted diagnostic snapshot.
 *
 * @param bytes - ZIP archive bytes to publish.
 * @param runtime - Browser download and object-URL dependencies.
 */
export function downloadDiagnosticsZip(bytes: Uint8Array, runtime?: DownloadRuntime): void {
    const browser = runtime ?? defaultDownloadRuntime();
    let objectUrl: string | undefined;
    let revoked = false;
    let anchor: ReturnType<DownloadRuntime["createAnchor"]> | undefined;
    const revoke = (): void => {
        if (objectUrl === undefined || revoked) {
            return;
        }
        revoked = true;
        browser.revokeObjectURL(objectUrl);
    };
    try {
        const safeBuffer = new ArrayBuffer(bytes.byteLength);
        new Uint8Array(safeBuffer).set(bytes);
        objectUrl = browser.createObjectURL(
            new browser.Blob([safeBuffer], { type: "application/zip" }),
        );
        anchor = browser.createAnchor();
        anchor.href = objectUrl;
        anchor.download = "no-more-ago-diagnostics.zip";
        anchor.click();
        browser.scheduleRevoke(revoke);
        anchor.remove?.();
    } catch (cause) {
        revoke();
        anchor?.remove?.();
        throw new DiagnosticArchiveError(
            "download-failed",
            "The diagnostic archive could not be downloaded.",
            { cause },
        );
    }
}
