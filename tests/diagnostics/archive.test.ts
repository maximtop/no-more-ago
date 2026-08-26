/**
 * @file Verifies diagnostic ZIP creation and browser download behavior.
 */

import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import {
    DIAGNOSTICS_ARCHIVE_FILE,
    DIAGNOSTICS_ARCHIVE_MEMBER,
    DiagnosticArchiveError,
    createDiagnosticsZip,
    downloadDiagnosticsZip,
    type DiagnosticArchiveSnapshot,
    type DownloadRuntime,
} from "../../src/diagnostics/archive";

const snapshot: DiagnosticArchiveSnapshot = {
    entries: [{
        category: "lifecycle",
        timestamp: 1_700_000_000_000,
        hostname: "github.com",
        pageCategory: "repository",
        incognito: false,
        reason: "adapter-matched",
    }],
    environment: { browserFamily: "chromium", extensionVersion: "1.2.3" },
};

describe("diagnostic archive", () => {
    it("stores the complete validated snapshot as JSON", () => {
        const files = unzipSync(createDiagnosticsZip(snapshot));
        expect(Object.keys(files)).toEqual([DIAGNOSTICS_ARCHIVE_MEMBER]);
        const json = files[DIAGNOSTICS_ARCHIVE_MEMBER];
        expect(json && JSON.parse(strFromU8(json))).toEqual(snapshot);
    });

    it("reports empty snapshots and compression failures", () => {
        expect(() => createDiagnosticsZip({ ...snapshot, entries: [] })).toThrow(
            expect.objectContaining<Partial<DiagnosticArchiveError>>({ code: "empty" }),
        );
        expect(() => createDiagnosticsZip(snapshot, () => {
            throw new Error("encoder failed");
        })).toThrow(
            expect.objectContaining<Partial<DiagnosticArchiveError>>({
                code: "compression-failed",
            }),
        );
    });

    it("downloads once and releases its temporary object URL", () => {
        const scheduled: Array<() => void> = [];
        const revoked: string[] = [];
        let clicked = false;
        const runtime: DownloadRuntime = {
            Blob,
            createObjectURL: () => "blob:diagnostics",
            revokeObjectURL: (url) => {
                revoked.push(url);
            },
            createAnchor: () => ({
                href: "",
                download: "",
                click() {
                    clicked = true;
                    expect(this.href).toBe("blob:diagnostics");
                    expect(this.download).toBe(DIAGNOSTICS_ARCHIVE_FILE);
                },
            }),
            scheduleRevoke: (callback) => {
                scheduled.push(callback);
            },
        };
        downloadDiagnosticsZip(new Uint8Array([1, 2, 3]), runtime);
        expect(clicked).toBe(true);
        expect(revoked).toEqual([]);
        scheduled[0]?.();
        expect(revoked).toEqual(["blob:diagnostics"]);
    });

    it("releases the object URL when the download click fails", () => {
        const revoked: string[] = [];
        const runtime: DownloadRuntime = {
            Blob,
            createObjectURL: () => "blob:failed",
            revokeObjectURL: (url) => {
                revoked.push(url);
            },
            createAnchor: () => ({
                href: "",
                download: "",
                click: () => {
                    throw new Error("blocked");
                },
            }),
            scheduleRevoke: () => undefined,
        };
        expect(() => {
            downloadDiagnosticsZip(new Uint8Array([1]), runtime);
        }).toThrow(
            expect.objectContaining<Partial<DiagnosticArchiveError>>({
                code: "download-failed",
            }),
        );
        expect(revoked).toEqual(["blob:failed"]);
    });
});
