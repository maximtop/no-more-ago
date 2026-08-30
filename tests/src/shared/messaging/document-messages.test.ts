/**
 * @file Verifies content runtime command and acknowledgement validators.
 */

import { describe, expect, it } from "vitest";

import {
    DIAGNOSTIC_CATEGORY,
    DIAGNOSTIC_REASON,
} from "../../../../src/shared/diagnostics/contracts";
import {
    DEBUG_POLICY_UPDATED_MESSAGE,
    DOCUMENT_PHASE,
    DOCUMENT_STATUS_MESSAGE,
    DOCUMENT_PHASES,
    DIAGNOSTIC_EVENT_MESSAGE,
    RECONCILE_DOCUMENT_ROUTE_MESSAGE,
    REFRESH_DOCUMENT_POLICY_MESSAGE,
    PRESENTATION_UPDATED_MESSAGE,
    SUSPEND_AND_REFRESH_DOCUMENT_POLICY_MESSAGE,
    TEARDOWN_DOCUMENT_MESSAGE,
    UPDATE_DEBUG_POLICY_MESSAGE,
    UPDATE_PRESENTATION_MESSAGE,
    isDebugPolicyUpdateAcknowledgement,
    isDebugPolicyUpdateMessage,
    isDocumentStatusMessage,
    isDocumentStatusResponse,
    isDiagnosticEventMessage,
    isPresentationUpdateAcknowledgement,
    isPresentationUpdateMessage,
    isRefreshDocumentPolicyMessage,
    isReconcileDocumentRouteMessage,
    isSuspendAndRefreshDocumentPolicyMessage,
    isTeardownDocumentMessage,
} from "../../../../src/shared/messaging/document-messages";

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
                phase: DOCUMENT_PHASE.ACTIVE,
                extra: true,
            }),
        ).toBe(false);
    });
});

describe("document policy messages", () => {
    it("accepts exact refresh commands", () => {
        expect(
            isRefreshDocumentPolicyMessage({ type: REFRESH_DOCUMENT_POLICY_MESSAGE }),
        ).toBe(true);
        expect(
            isSuspendAndRefreshDocumentPolicyMessage({
                type: SUSPEND_AND_REFRESH_DOCUMENT_POLICY_MESSAGE,
            }),
        ).toBe(true);
        expect(
            isRefreshDocumentPolicyMessage({ type: REFRESH_DOCUMENT_POLICY_MESSAGE, extra: true }),
        ).toBe(false);
        expect(
            isSuspendAndRefreshDocumentPolicyMessage({
                type: SUSPEND_AND_REFRESH_DOCUMENT_POLICY_MESSAGE,
                extra: true,
            }),
        ).toBe(false);
    });
});

describe("document route messages", () => {
    it("accepts only payload-free route commands", () => {
        expect(
            isReconcileDocumentRouteMessage({ type: RECONCILE_DOCUMENT_ROUTE_MESSAGE }),
        ).toBe(true);

        for (const property of ["url", "query", "videoId", "generation", "pageData"]) {
            expect(
                isReconcileDocumentRouteMessage({
                    type: RECONCILE_DOCUMENT_ROUTE_MESSAGE,
                    [property]: "forbidden",
                }),
            ).toBe(false);
        }

        for (const value of [null, [], {}, { type: "other" }]) {
            expect(isReconcileDocumentRouteMessage(value)).toBe(false);
        }
    });
});

describe("revisioned presentation messages", () => {
    it("accepts complete updates and rejects unsafe revisions", () => {
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
            { type: UPDATE_PRESENTATION_MESSAGE, revision: -1, display },
            { type: UPDATE_PRESENTATION_MESSAGE, revision: Number.NaN, display },
            { type: UPDATE_PRESENTATION_MESSAGE, revision: 1.5, display },
        ]) {
            expect(isPresentationUpdateMessage(value)).toBe(false);
        }
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
        ]) {
            expect(isPresentationUpdateAcknowledgement(value)).toBe(false);
        }
    });
});

describe("diagnostic policy and event messages", () => {
    it("validates policy revisions and reuses the diagnostic input schema", () => {
        expect(
            isDebugPolicyUpdateMessage({
                type: UPDATE_DEBUG_POLICY_MESSAGE,
                revision: 2,
                enabled: true,
            }),
        ).toBe(true);
        expect(
            isDebugPolicyUpdateAcknowledgement(
                { type: DEBUG_POLICY_UPDATED_MESSAGE, revision: 2 },
                2,
            ),
        ).toBe(true);
        expect(
            isDebugPolicyUpdateAcknowledgement(
                { type: DEBUG_POLICY_UPDATED_MESSAGE, revision: 1 },
                2,
            ),
        ).toBe(false);
        expect(
            isDiagnosticEventMessage({
                type: DIAGNOSTIC_EVENT_MESSAGE,
                event: { category: DIAGNOSTIC_CATEGORY.MUTATION, count: 1 },
            }),
        ).toBe(true);
        expect(
            isDiagnosticEventMessage({
                type: DIAGNOSTIC_EVENT_MESSAGE,
                event: {
                    category: DIAGNOSTIC_CATEGORY.SKIP,
                    reason: DIAGNOSTIC_REASON.INVALID_TIMESTAMP,
                    count: 1,
                    sourceTimestamp: "123456789",
                },
            }),
        ).toBe(true);
        expect(
            isDiagnosticEventMessage({
                type: DIAGNOSTIC_EVENT_MESSAGE,
                event: { category: "unsupported" },
            }),
        ).toBe(false);
        expect(
            isDiagnosticEventMessage({
                type: DIAGNOSTIC_EVENT_MESSAGE,
                event: { category: DIAGNOSTIC_CATEGORY.MUTATION, extra: true },
            }),
        ).toBe(false);
    });
});
