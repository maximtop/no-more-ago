/**
 * @file Structural guards for diagnostic archive responses.
 */

import {
    hasOnlyOwnDiagnosticProperties,
    isDiagnosticJournalEntries,
} from "../diagnostics/journal";
import type {
    ClearDiagnosticsResponse,
    DiagnosticsSnapshot,
    GetDiagnosticsSnapshotResponse,
} from "./message-contracts";
import { isMessageRecord } from "./message-guard-utils";

/**
 * Recognizes a non-empty diagnostics snapshot with trusted environment metadata.
 *
 * @param value - Untrusted diagnostics snapshot.
 * @returns - Whether the value is a non-empty snapshot with trusted metadata.
 */
export function isDiagnosticsSnapshot(value: unknown): value is DiagnosticsSnapshot {
    if (
        !isMessageRecord(value)
        || !hasOnlyOwnDiagnosticProperties(value)
        || Object.keys(value).length !== 2
        || !Object.hasOwn(value, "entries")
        || !Object.hasOwn(value, "environment")
        || !isDiagnosticJournalEntries(value.entries)
        || value.entries.length === 0
    ) {
        return false;
    }
    const environment = value.environment;
    if (
        !isMessageRecord(environment)
        || !hasOnlyOwnDiagnosticProperties(environment)
        || !Object.hasOwn(environment, "browserFamily")
        || !["chromium", "firefox", "other"].includes(String(environment.browserFamily))
    ) {
        return false;
    }
    if ("extensionVersion" in environment && !Object.hasOwn(environment, "extensionVersion")) {
        return false;
    }
    const count = Object.hasOwn(environment, "extensionVersion") ? 2 : 1;
    if (Object.keys(environment).length !== count) {
        return false;
    }
    return count === 1
        || (
            typeof environment.extensionVersion === "string"
            && /^[0-9A-Za-z][0-9A-Za-z._+-]{0,31}$/u.test(environment.extensionVersion)
        );
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
    if (
        !isMessageRecord(value)
        || !hasOnlyOwnDiagnosticProperties(value)
        || !Object.hasOwn(value, "ok")
        || Object.keys(value).length !== 2
    ) {
        return false;
    }
    if (value.ok === true) {
        return Object.hasOwn(value, "snapshot") && isDiagnosticsSnapshot(value.snapshot);
    }
    return (
        value.ok === false
        && Object.hasOwn(value, "error")
        && ["disabled", "unavailable", "empty", "invalid-journal", "storage-failed"].includes(
            String(value.error),
        )
    );
}

/**
 * Recognizes a successful diagnostics clear result or its documented error response.
 *
 * @param value - Untrusted clear-diagnostics response.
 * @returns - Whether the value is a documented success or error response.
 */
export function isClearDiagnosticsResponse(value: unknown): value is ClearDiagnosticsResponse {
    if (
        !isMessageRecord(value)
        || !hasOnlyOwnDiagnosticProperties(value)
        || !Object.hasOwn(value, "ok")
    ) {
        return false;
    }
    if (value.ok === true) {
        return Object.keys(value).length === 1;
    }
    return (
        value.ok === false
        && Object.keys(value).length === 2
        && Object.hasOwn(value, "error")
        && ["disabled", "unavailable", "storage-failed"].includes(String(value.error))
    );
}
