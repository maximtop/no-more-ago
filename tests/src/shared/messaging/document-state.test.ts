/**
 * @file Verifies the document-state message contract.
 */

import * as v from "valibot";
import { describe, expect, it } from "vitest";

import {
    documentStateSchema,
    isDocumentState,
} from "../../../../src/shared/messaging/document-state";

const readyState = {
    availability: "ready",
    revision: 4,
    enabled: true,
    display: { formatMode: "system", timeZone: { mode: "system" } },
    debugEnabled: false,
} as const;

const unavailableState = {
    availability: "unavailable",
    revision: null,
    enabled: false,
    display: null,
    debugEnabled: false,
    failure: "settings-load",
} as const;

describe("document-state schema", () => {
    it.each([
        ["ready", readyState],
        ["unavailable", unavailableState],
    ])("accepts %s state", (_name, state) => {
        expect(v.is(documentStateSchema, state)).toBe(true);
        expect(isDocumentState(state)).toBe(true);
    });

    it.each([
        { ...readyState, extra: true },
        { ...readyState, revision: Number.MAX_SAFE_INTEGER + 1 },
        { ...readyState, display: { formatMode: "unknown" } },
        { ...unavailableState, enabled: true },
    ])("rejects unsafe state %j", (state) => {
        expect(v.is(documentStateSchema, state)).toBe(false);
        expect(isDocumentState(state)).toBe(false);
    });
});
