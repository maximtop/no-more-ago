/**
 * @file Valibot schemas and type guards for diagnostic archive responses.
 */

import * as v from "valibot";
import { SAFE_EXTENSION_VERSION_PATTERN } from "../core/extension-version";
import {
    DIAGNOSTIC_BROWSER_FAMILIES,
} from "../diagnostics/contracts";
import type { DiagnosticEvent } from "../diagnostics/events";
import { isDiagnosticJournalEntries } from "../diagnostics/journal";
import type {
    ClearDiagnosticsResponse,
    DiagnosticsSnapshot,
    GetDiagnosticsSnapshotResponse,
} from "./message-contracts";
import {
    DIAGNOSTICS_CLEAR_ERRORS,
    DIAGNOSTICS_SNAPSHOT_ERRORS,
} from "./message-contracts";
import { strictMessageObject } from "./message-schema-utils";

const versionSchema = v.pipe(
    v.string(),
    v.regex(SAFE_EXTENSION_VERSION_PATTERN),
);
const entriesSchema = v.custom<readonly DiagnosticEvent[]>(
    (value) => isDiagnosticJournalEntries(value) && value.length > 0,
);
const environmentSchema = strictMessageObject({
    browserFamily: v.picklist(DIAGNOSTIC_BROWSER_FAMILIES),
    extensionVersion: v.exactOptional(versionSchema),
});
const diagnosticsSnapshotSchema = strictMessageObject({
    entries: entriesSchema,
    environment: environmentSchema,
});
const getDiagnosticsSnapshotResponseSchema = v.union([
    strictMessageObject({
        ok: v.literal(true),
        snapshot: diagnosticsSnapshotSchema,
    }),
    strictMessageObject({
        ok: v.literal(false),
        error: v.picklist(DIAGNOSTICS_SNAPSHOT_ERRORS),
    }),
]);
const clearDiagnosticsResponseSchema = v.union([
    strictMessageObject({ ok: v.literal(true) }),
    strictMessageObject({
        ok: v.literal(false),
        error: v.picklist(DIAGNOSTICS_CLEAR_ERRORS),
    }),
]);

/**
 * Recognizes a non-empty diagnostics snapshot with trusted environment metadata.
 *
 * @param value - Untrusted diagnostics snapshot.
 * @returns - Whether the value is a non-empty snapshot with trusted metadata.
 */
export function isDiagnosticsSnapshot(value: unknown): value is DiagnosticsSnapshot {
    return v.is(diagnosticsSnapshotSchema, value);
}

/**
 * Recognizes a successful diagnostics snapshot or its documented error response.
 *
 * @param value - Untrusted diagnostics-snapshot response.
 * @returns - Whether the value is a documented success or error response.
 */
export function isGetDiagnosticsSnapshotResponse(
    value: unknown,
): value is GetDiagnosticsSnapshotResponse {
    return v.is(getDiagnosticsSnapshotResponseSchema, value);
}

/**
 * Recognizes a successful diagnostics clear result or its documented error response.
 *
 * @param value - Untrusted clear-diagnostics response.
 * @returns - Whether the value is a documented success or error response.
 */
export function isClearDiagnosticsResponse(value: unknown): value is ClearDiagnosticsResponse {
    return v.is(clearDiagnosticsResponseSchema, value);
}
