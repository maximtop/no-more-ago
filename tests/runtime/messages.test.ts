/**
 * @file Verifies content runtime command and acknowledgement validators.
 */

import { describe, expect, it } from "vitest";

import {
    DOCUMENT_STATUS_MESSAGE,
    DOCUMENT_PHASES,
    PRESENTATION_UPDATED_MESSAGE,
    TEARDOWN_DOCUMENT_MESSAGE,
    UPDATE_PRESENTATION_MESSAGE,
    isDocumentStatusMessage,
    isDocumentStatusResponse,
    isPresentationUpdateAcknowledgement,
    isPresentationUpdateMessage,
    isTeardownDocumentMessage,
} from "../../src/runtime/messages";

const display = { formatMode: "system" as const, timeZone: { mode: "utc" as const } };
const customDisplay = {
    formatMode: "custom" as const,
    pattern: "yyyy-MM-dd",
    timeZone: { mode: "utc" as const },
};

describe("teardown document message", () => {
    it("accepts only the exact teardown object", () => {
        expect(isTeardownDocumentMessage({ type: TEARDOWN_DOCUMENT_MESSAGE })).toBe(true);
        for (const value of [
            null,
            [],
            TEARDOWN_DOCUMENT_MESSAGE,
            {},
            { type: "other" },
            { type: TEARDOWN_DOCUMENT_MESSAGE, extra: true },
        ]) {
            expect(isTeardownDocumentMessage(value)).toBe(false);
        }
    });
});

describe("document status message", () => {
    it("accepts only the exact request and guarded response phases", () => {
        expect(isDocumentStatusMessage({ type: DOCUMENT_STATUS_MESSAGE })).toBe(true);
        for (const value of [
            null,
            [],
            {},
            { type: DOCUMENT_STATUS_MESSAGE, extra: true },
            { type: "other" },
        ]) {
            expect(isDocumentStatusMessage(value)).toBe(false);
        }
        for (const phase of DOCUMENT_PHASES) {
            expect(isDocumentStatusResponse({ type: DOCUMENT_STATUS_MESSAGE, phase })).toBe(true);
        }
        expect(isDocumentStatusResponse({ type: DOCUMENT_STATUS_MESSAGE, phase: "unknown" })).toBe(
            false,
        );
        expect(
            isDocumentStatusResponse({
                type: DOCUMENT_STATUS_MESSAGE,
                phase: "active",
                extra: true,
            }),
        ).toBe(false);
    });
});

describe("revisioned presentation messages", () => {
    it("accepts complete V3 updates and rejects unsafe or structurally incomplete requests", () => {
        expect(
            isPresentationUpdateMessage({
                type: UPDATE_PRESENTATION_MESSAGE,
                revision: 4,
                display,
            }),
        ).toBe(true);
        expect(
            isPresentationUpdateMessage({
                type: UPDATE_PRESENTATION_MESSAGE,
                revision: 0,
                display: {
                    formatMode: "system",
                    timeZone: { mode: "iana", identifier: "America/New_York" },
                },
            }),
        ).toBe(true);
        expect(
            isPresentationUpdateMessage({
                type: UPDATE_PRESENTATION_MESSAGE,
                revision: 0,
                display: customDisplay,
            }),
        ).toBe(true);
        for (const value of [
            undefined,
            null,
            { type: UPDATE_PRESENTATION_MESSAGE, revision: -1, display },
            { type: UPDATE_PRESENTATION_MESSAGE, revision: Number.NaN, display },
            { type: UPDATE_PRESENTATION_MESSAGE, revision: 1.5, display },
            { type: UPDATE_PRESENTATION_MESSAGE, revision: 1, display, extra: true },
            { type: UPDATE_PRESENTATION_MESSAGE, revision: 1 },
            {
                type: UPDATE_PRESENTATION_MESSAGE,
                revision: 1,
                display: { formatMode: "custom", timeZone: { mode: "utc" } },
            },
            {
                type: UPDATE_PRESENTATION_MESSAGE,
                revision: 1,
                display: { formatMode: "custom", pattern: "YYYY-MM-dd", timeZone: { mode: "utc" } },
            },
            {
                type: UPDATE_PRESENTATION_MESSAGE,
                revision: 1,
                display: { formatMode: "system", pattern: "yyyy-MM-dd", timeZone: { mode: "utc" } },
            },
            {
                type: UPDATE_PRESENTATION_MESSAGE,
                revision: 1,
                display: { formatMode: "system", timeZone: { mode: "iana", identifier: "../UTC" } },
            },
            {
                type: UPDATE_PRESENTATION_MESSAGE,
                revision: 1,
                display: {
                    formatMode: "system",
                    timeZone: { mode: "iana", identifier: "America//New_York" },
                },
            },
            Object.assign(Object.create({ revision: 1 }), {
                type: UPDATE_PRESENTATION_MESSAGE,
                display,
            }),
        ]) {
            expect(isPresentationUpdateMessage(value)).toBe(false);
        }

        const inheritedDisplay = Object.assign(
            Object.create({ pattern: "yyyy-MM-dd" }) as Record<string, unknown>,
            { formatMode: "custom", timeZone: { mode: "utc" }, unexpected: true },
        );
        expect(
            isPresentationUpdateMessage({
                type: UPDATE_PRESENTATION_MESSAGE,
                revision: 1,
                display: inheritedDisplay,
            }),
        ).toBe(false);
    });

    it("requires an exact two-field acknowledgement and optional exact revision", () => {
        expect(
            isPresentationUpdateAcknowledgement({
                type: PRESENTATION_UPDATED_MESSAGE,
                revision: 4,
            }),
        ).toBe(true);
        expect(
            isPresentationUpdateAcknowledgement(
                { type: PRESENTATION_UPDATED_MESSAGE, revision: 4 },
                4,
            ),
        ).toBe(true);
        expect(
            isPresentationUpdateAcknowledgement(
                { type: PRESENTATION_UPDATED_MESSAGE, revision: 3 },
                4,
            ),
        ).toBe(false);
        for (const value of [
            undefined,
            null,
            { type: PRESENTATION_UPDATED_MESSAGE, revision: 4, extra: true },
            { type: PRESENTATION_UPDATED_MESSAGE },
            { type: "other", revision: 4 },
            { type: PRESENTATION_UPDATED_MESSAGE, revision: -1 },
            { type: PRESENTATION_UPDATED_MESSAGE, revision: Number.POSITIVE_INFINITY },
            Object.assign(Object.create({ revision: 4 }), { type: PRESENTATION_UPDATED_MESSAGE }),
        ]) {
            expect(isPresentationUpdateAcknowledgement(value)).toBe(false);
        }
    });
});
