/**
 * @file Verifies canonical dynamic content-script registration behavior.
 */

import { describe, expect, it } from "vitest";

import {
    DOCUMENT_RUNTIME_REGISTRATION,
    FACEBOOK_PAYLOAD_BRIDGE_REGISTRATION,
    registrationMatches,
} from "../../../../src/background/runtime/register-documents";

describe("document runtime registrations", () => {
    it("registers the universal runtime isolated and the Facebook bridge main-world", () => {
        expect(DOCUMENT_RUNTIME_REGISTRATION).toMatchObject({
            allFrames: true,
            world: "ISOLATED",
        });
        expect(FACEBOOK_PAYLOAD_BRIDGE_REGISTRATION).toMatchObject({
            allFrames: true,
            world: "MAIN",
        });
    });

    it("accepts optional fields omitted by the browser query", () => {
        expect(registrationMatches(
            { id: DOCUMENT_RUNTIME_REGISTRATION.id },
            DOCUMENT_RUNTIME_REGISTRATION,
        )).toBe(true);
        expect(registrationMatches(
            { id: FACEBOOK_PAYLOAD_BRIDGE_REGISTRATION.id },
            FACEBOOK_PAYLOAD_BRIDGE_REGISTRATION,
        )).toBe(true);
    });

    it.each([
        { matches: ["https://example.test/*"] },
        { js: ["other.js"] },
        { runAt: "document_idle" },
        { allFrames: false },
        { persistAcrossSessions: false },
        { world: "ISOLATED" },
    ])("rejects an explicitly different Facebook field", (difference) => {
        expect(registrationMatches(
            { ...FACEBOOK_PAYLOAD_BRIDGE_REGISTRATION, ...difference },
            FACEBOOK_PAYLOAD_BRIDGE_REGISTRATION,
        )).toBe(false);
    });
});
