/**
 * @file Verifies diagnostic context derivation, redaction, and event sanitization.
 */

import { describe, expect, it } from "vitest";
import { createDiagnosticEvent, deriveDiagnosticContext, sanitizeDiagnosticEvent } from "../../src/diagnostics/events";
import { DIAGNOSTIC_EVENT_MESSAGE, DEBUG_POLICY_UPDATED_MESSAGE, UPDATE_DEBUG_POLICY_MESSAGE, isDebugPolicyUpdateAcknowledgement, isDebugPolicyUpdateMessage, isDiagnosticEventMessage } from "../../src/runtime/messages";

const sender = (url = "https://github.com/acme/project/issues/3", incognito = false) => ({ url, tab: { incognito } });

describe("diagnostic event privacy", () => {
    it("derives only coarse trusted sender context", () => {
        expect(deriveDiagnosticContext(sender())).toEqual({ hostname: "github.com", pageCategory: "issue", incognito: false });
        expect(deriveDiagnosticContext(sender("https://github.com/acme/project?token=secret#dom", true))).toMatchObject({ hostname: "github.com", pageCategory: "repository", incognito: true });
        expect(deriveDiagnosticContext(sender("http://github.com/acme/project"))).toMatchObject({ hostname: "github.com", pageCategory: "repository" });
        expect(deriveDiagnosticContext(sender("ftp://github.com/acme/project"))).toBeNull();
    });

    it("allows technical scalars and strips arbitrary stack data", () => {
        const event = createDiagnosticEvent({ category: "error", count: 2, durationMs: 10, reason: "processing-failed", adapterVersion: "1.2.3", extensionVersion: "0.1.0", browserFamily: "chromium", stack: "Error: secret https://github.com/?token=x\n at fn (/Users/max/app.ts:12:7)" }, sender(), 123);
        expect(event).toEqual({ category: "error", timestamp: 123, hostname: "github.com", pageCategory: "issue", incognito: false, count: 2, durationMs: 10, reason: "processing-failed", adapterVersion: "1.2.3", extensionVersion: "0.1.0", browserFamily: "chromium", stack: ["frame", "frame:12:7"] });
        expect(JSON.stringify(event)).not.toMatch(/github\.com\/|token|Users|max|secret|datetime|<body>/u);
    });

    it.each(["chromium", "firefox", "other"] as const)("retains only an allowed browser family %s", (browserFamily) => {
        const event = createDiagnosticEvent({ category: "lifecycle", browserFamily }, sender(), 4);
        expect(event?.browserFamily).toBe(browserFamily);
    });

    it("drops a spoofed browser family and rejects content-owned private context", () => {
        const event = createDiagnosticEvent({ category: "lifecycle", browserFamily: "safari", incognito: true }, sender("https://github.com/acme/project", false), 4);
        expect(event).toBeNull();
        expect(createDiagnosticEvent({ category: "lifecycle", browserFamily: "safari" }, sender("https://github.com/acme/project", false), 4)).not.toMatchObject({ browserFamily: "safari" });
    });

    it("rejects substituted context, forbidden fields, and inherited input", () => {
        expect(sanitizeDiagnosticEvent({ category: "mutation", datetime: "2026-08-25", text: "page" }, { hostname: "github.com", pageCategory: "repository", incognito: false }, 1)).toBeNull();
        expect(sanitizeDiagnosticEvent({ category: "mutation" }, { hostname: "https://evil.example", pageCategory: "repository", incognito: false }, 1)).toBeNull();
        const inherited = Object.assign(Object.create({ reason: "processing-failed" }) as Record<string, unknown>, { category: "error" });
        expect(sanitizeDiagnosticEvent(inherited, { hostname: "github.com", pageCategory: "other", incognito: false }, 1)).toBeNull();
    });
});

describe("diagnostic runtime envelopes", () => {
    it("guards exact policy update and acknowledgement messages", () => {
        expect(isDebugPolicyUpdateMessage({ type: UPDATE_DEBUG_POLICY_MESSAGE, revision: 2, enabled: true })).toBe(true);
        expect(isDebugPolicyUpdateMessage({ type: UPDATE_DEBUG_POLICY_MESSAGE, revision: 2, enabled: true, extra: false })).toBe(false);
        expect(isDebugPolicyUpdateAcknowledgement({ type: DEBUG_POLICY_UPDATED_MESSAGE, revision: 2 }, 2)).toBe(true);
        expect(isDebugPolicyUpdateAcknowledgement({ type: DEBUG_POLICY_UPDATED_MESSAGE, revision: 1 }, 2)).toBe(false);
    });

    it("accepts only an exact diagnostic event envelope", () => {
        expect(isDiagnosticEventMessage({ type: DIAGNOSTIC_EVENT_MESSAGE, event: { category: "mutation", count: 1 } })).toBe(true);
        expect(isDiagnosticEventMessage({ type: DIAGNOSTIC_EVENT_MESSAGE, event: { category: "mutation", count: 1, datetime: "secret" } })).toBe(false);
        expect(isDiagnosticEventMessage(Object.assign(Object.create({ type: DIAGNOSTIC_EVENT_MESSAGE }) as Record<string, unknown>, { event: { category: "mutation" } }))).toBe(false);
        expect(isDiagnosticEventMessage({
            type: DIAGNOSTIC_EVENT_MESSAGE,
            event: Object.assign(Object.create({ count: 1 }) as Record<string, unknown>, { category: "mutation" })
        })).toBe(false);
    });
});
