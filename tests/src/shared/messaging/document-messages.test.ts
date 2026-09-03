/**
 * @file Verifies how background reads replies from frames that may hold no runtime.
 */

import { describe, expect, it } from "vitest";

import {
    DEBUG_POLICY_UPDATED_MESSAGE,
    DOCUMENT_PHASE,
    DOCUMENT_POLICY_RECONCILED_MESSAGE,
    DOCUMENT_STATUS_MESSAGE,
    PRESENTATION_UPDATED_MESSAGE,
    isDebugPolicyAcknowledgement,
    isDocumentPolicyAcknowledgement,
    isPresentationAcknowledgement,
    readDocumentStatusPhase,
} from "../../../../src/shared/messaging/document-messages";

describe("document policy acknowledgement", () => {
    it("accepts only the exact retained revision", () => {
        const reply = { type: DOCUMENT_POLICY_RECONCILED_MESSAGE, revision: 7 };

        expect(isDocumentPolicyAcknowledgement(reply, 7)).toBe(true);
        expect(isDocumentPolicyAcknowledgement(reply, 6)).toBe(false);
        expect(isDocumentPolicyAcknowledgement(
            { type: DOCUMENT_POLICY_RECONCILED_MESSAGE, revision: null },
            null,
        )).toBe(true);
    });

    it("rejects a frame that returned no reply", () => {
        expect(isDocumentPolicyAcknowledgement(undefined, 7)).toBe(false);
        expect(isDocumentPolicyAcknowledgement(undefined, null)).toBe(false);
    });
});

describe("presentation and diagnostic acknowledgements", () => {
    it("accepts only the acknowledgement sent for the exact revision", () => {
        expect(isPresentationAcknowledgement(
            { type: PRESENTATION_UPDATED_MESSAGE, revision: 3 },
            3,
        )).toBe(true);
        expect(isPresentationAcknowledgement(
            { type: PRESENTATION_UPDATED_MESSAGE, revision: 2 },
            3,
        )).toBe(false);
        expect(isPresentationAcknowledgement(
            { type: DEBUG_POLICY_UPDATED_MESSAGE, revision: 3 },
            3,
        )).toBe(false);
        expect(isPresentationAcknowledgement(undefined, 3)).toBe(false);
    });

    it("keeps diagnostic acknowledgements distinct from presentation replies", () => {
        expect(isDebugPolicyAcknowledgement(
            { type: DEBUG_POLICY_UPDATED_MESSAGE, revision: 4 },
            4,
        )).toBe(true);
        expect(isDebugPolicyAcknowledgement(
            { type: PRESENTATION_UPDATED_MESSAGE, revision: 4 },
            4,
        )).toBe(false);
        expect(isDebugPolicyAcknowledgement(undefined, 4)).toBe(false);
    });
});

describe("document status reply", () => {
    it("reads the reported phase and reports an absent runtime", () => {
        expect(readDocumentStatusPhase({
            type: DOCUMENT_STATUS_MESSAGE,
            phase: DOCUMENT_PHASE.ACTIVE,
        })).toBe(DOCUMENT_PHASE.ACTIVE);
        expect(readDocumentStatusPhase(undefined)).toBeUndefined();
        expect(readDocumentStatusPhase({ type: PRESENTATION_UPDATED_MESSAGE, revision: 1 }))
            .toBeUndefined();
    });
});
