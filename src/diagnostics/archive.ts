import { strToU8, zipSync } from "fflate";
import { DIAGNOSTICS_MAX_BYTES, hasOnlyOwnDiagnosticProperties, isDiagnosticJournalEntries } from "./journal";
import type { DiagnosticEvent } from "./events";

export type DiagnosticArchiveErrorCode = "empty" | "invalid-snapshot" | "compression-failed" | "download-failed";

export class DiagnosticArchiveError extends Error {
    public constructor(public readonly code: DiagnosticArchiveErrorCode, message: string, options?: ErrorOptions) {
        super(message, options);
        this.name = "DiagnosticArchiveError";
    }
}

export interface DiagnosticArchiveSnapshot {
    readonly entries: readonly DiagnosticEvent[];
    readonly environment: {
        readonly browserFamily: "chromium" | "firefox" | "other";
        readonly extensionVersion?: string;
    };
}

export type ZipEncoder = (files: Record<string, Uint8Array>) => Uint8Array;

export interface DownloadRuntime {
    readonly Blob: typeof Blob;
    readonly createObjectURL: (blob: Blob) => string;
    readonly revokeObjectURL: (url: string) => void;
    readonly createAnchor: () => { href: string; download: string; click: () => void; remove?: () => void };
    readonly scheduleRevoke: (callback: () => void) => void;
}

const ENVIRONMENT_KEYS = new Set(["browserFamily", "extensionVersion"]);
function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isDiagnosticArchiveSnapshot(value: unknown): value is DiagnosticArchiveSnapshot {
    if (!isRecord(value) || !hasOnlyOwnDiagnosticProperties(value) || Object.keys(value).length !== 2 || !Object.hasOwn(value, "entries") || !Object.hasOwn(value, "environment") || !Array.isArray(value.entries) || !isRecord(value.environment) || !hasOnlyOwnDiagnosticProperties(value.environment)
    || Object.keys(value.environment).some((key) => !ENVIRONMENT_KEYS.has(key))
    || !Object.hasOwn(value.environment, "browserFamily")
    || ("extensionVersion" in value.environment && !Object.hasOwn(value.environment, "extensionVersion"))
    || !["chromium", "firefox", "other"].includes(String(value.environment.browserFamily))) return false;
    if (Object.hasOwn(value.environment, "extensionVersion") && (typeof value.environment.extensionVersion !== "string" || !/^[0-9A-Za-z][0-9A-Za-z._+-]{0,31}$/u.test(value.environment.extensionVersion))) return false;
    return isDiagnosticJournalEntries(value.entries, DIAGNOSTICS_MAX_BYTES);
}

export function createDiagnosticsZip(snapshot: unknown, encoder: ZipEncoder = zipSync): Uint8Array {
    if (!isDiagnosticArchiveSnapshot(snapshot)) throw new DiagnosticArchiveError("invalid-snapshot", "The diagnostic snapshot is invalid or unsafe.");
    if (snapshot.entries.length === 0) throw new DiagnosticArchiveError("empty", "There are no diagnostic entries to download.");
    try {
        const safeEntries = snapshot.entries.map((entry) => {
            const safeEntry: Record<string, unknown> = { ...entry };
            if (entry.stack !== undefined) safeEntry.stack = [...entry.stack];
            return safeEntry;
        });
        const journalBytes = strToU8(JSON.stringify({ entries: safeEntries }));
        if (journalBytes.byteLength > DIAGNOSTICS_MAX_BYTES) throw new DiagnosticArchiveError("invalid-snapshot", "The diagnostic snapshot is too large to download.");
        const exportSnapshot = {
            entries: safeEntries,
            environment: { ...snapshot.environment }
        };
        const json = JSON.stringify(exportSnapshot);
        const jsonBytes = strToU8(json);
        // Copy into this realm so browser extension bundlers and isolated test
        // contexts agree that the value is a byte array rather than a directory.
        return encoder({ "diagnostics.json": new Uint8Array(jsonBytes) });
    } catch (cause) {
        if (cause instanceof DiagnosticArchiveError) throw cause;
        throw new DiagnosticArchiveError("compression-failed", "The diagnostic archive could not be created.", { cause });
    }
}

function defaultDownloadRuntime(): DownloadRuntime {
    if (typeof Blob === "undefined" || typeof URL === "undefined" || typeof document === "undefined") throw new DiagnosticArchiveError("download-failed", "Local downloads are unavailable in this context.");
    return {
        Blob,
        createObjectURL: (blob) => URL.createObjectURL(blob),
        revokeObjectURL: (url) => { URL.revokeObjectURL(url); },
        createAnchor: () => {
            const anchor = document.createElement("a");
            document.body.append(anchor);
            return anchor;
        },
        scheduleRevoke: (callback) => { setTimeout(callback, 0); }
    };
}

export function downloadDiagnosticsZip(bytes: Uint8Array, runtime?: DownloadRuntime): void {
    const browser = runtime ?? defaultDownloadRuntime();
    let objectUrl: string | undefined;
    let revoked = false;
    let anchor: ReturnType<DownloadRuntime["createAnchor"]> | undefined;
    const revoke = (): void => {
        if (objectUrl === undefined || revoked) return;
        revoked = true;
        browser.revokeObjectURL(objectUrl);
    };
    try {
        const safeBuffer = new ArrayBuffer(bytes.byteLength);
        new Uint8Array(safeBuffer).set(bytes);
        objectUrl = browser.createObjectURL(new browser.Blob([safeBuffer], { type: "application/zip" }));
        anchor = browser.createAnchor();
        anchor.href = objectUrl;
        anchor.download = "no-more-ago-diagnostics.zip";
        anchor.click();
        browser.scheduleRevoke(revoke);
        anchor.remove?.();
    } catch (cause) {
        revoke();
        anchor?.remove?.();
        throw new DiagnosticArchiveError("download-failed", "The diagnostic archive could not be downloaded.", { cause });
    }
}
