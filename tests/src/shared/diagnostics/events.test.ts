/**
 * @file Verifies diagnostic context derivation and privacy-preserving normalization.
 */

import { describe, expect, it } from "vitest";
import {
    createDiagnosticEvent,
    deriveDiagnosticContext,
} from "../../../../src/shared/diagnostics/events";

describe("diagnostic events", () => {
    it("derives only coarse context from the browser sender", () => {
        expect(deriveDiagnosticContext({
            url: "https://github.com/acme/project/issues/3?token=secret#comment",
            tab: { incognito: true },
        })).toEqual({
            hostname: "github.com",
            pageCategory: "issue",
            incognito: true,
        });
        expect(deriveDiagnosticContext({ url: "chrome://extensions" })).toBeNull();
    });

    it("keeps bounded technical fields and redacts stack contents", () => {
        const event = createDiagnosticEvent(
            {
                category: "error",
                count: 2,
                durationMs: 10,
                reason: "processing-failed",
                extensionVersion: "0.1.0",
                browserFamily: "chromium",
                stack: "Error: secret token\n at run (/Users/max/app.ts:12:7)",
            },
            { url: "https://github.com/acme/project/issues/3" },
            123,
        );
        expect(event).toEqual({
            category: "error",
            timestamp: 123,
            hostname: "github.com",
            pageCategory: "issue",
            incognito: false,
            count: 2,
            durationMs: 10,
            reason: "processing-failed",
            extensionVersion: "0.1.0",
            browserFamily: "chromium",
            stack: ["frame", "frame:12:7"],
        });
        expect(JSON.stringify(event)).not.toMatch(/secret|token|Users|max|app\.ts/u);
    });

    it("rejects unknown fields and unsupported sender URLs", () => {
        expect(createDiagnosticEvent(
            { category: "mutation", currentUrl: "https://github.com/private" },
            { url: "https://github.com/acme/project" },
            1,
        )).toBeNull();
        expect(createDiagnosticEvent(
            { category: "mutation" },
            { url: "ftp://github.com/acme/project" },
            1,
        )).toBeNull();
    });
});
