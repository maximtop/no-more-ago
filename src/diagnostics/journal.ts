/**
 * @file Persists bounded diagnostic entries with generation-safe asynchronous storage updates.
 */

import { isCanonicalHostname } from "../settings/snapshot";
import { SAFE_EXTENSION_VERSION_PATTERN } from "../core/extension-version";
import {
    DIAGNOSTIC_BROWSER_FAMILIES,
    DIAGNOSTIC_CATEGORIES,
    DIAGNOSTIC_EVENT_OPTIONAL_KEYS,
    DIAGNOSTIC_EVENT_REQUIRED_KEYS,
    DIAGNOSTIC_MAX_COUNT,
    DIAGNOSTIC_MAX_DURATION_MS,
    DIAGNOSTIC_MAX_STACK_FRAMES,
    DIAGNOSTIC_PAGE_CATEGORIES,
    DIAGNOSTIC_REASONS,
    DIAGNOSTIC_STACK_FRAME_PATTERN,
} from "./contracts";
import type { DiagnosticEvent } from "./events";

/**
 * Storage key containing the bounded, background-owned diagnostics envelope.
 */
export const DIAGNOSTICS_STORAGE_KEY = "diagnostics" as const;

/**
 * Maximum UTF-8 size permitted for the serialized journal envelope.
 */
export const DIAGNOSTICS_MAX_BYTES = 5_000_000 as const;

/**
 * Async storage operations used by the journal; failures are intentionally contained.
 */
export interface DiagnosticStorage {
    /**
     * Fetches the journal keys from the durable storage backend.
     */
    get(
        keys?: string | readonly string[] | Record<string, unknown>,
    ): Promise<Record<string, unknown>>;

    /**
     * Persists a complete record of key-value updates.
     */
    set(items: Record<string, unknown>): Promise<void>;

    /**
     * Deletes the supplied storage keys.
     */
    remove(keys: string | readonly string[]): Promise<void>;
}

/**
 * Exact on-disk JSON shape used to reject partial, stale, or oversized journal values.
 */
interface DiagnosticEnvelope {
    /**
     * Newest-first diagnostic events retained within the byte limit.
     */
    readonly entries: readonly DiagnosticEvent[];
}

/**
 * Read result that exposes a usable snapshot without propagating storage errors.
 */
export type DiagnosticJournalSnapshotResult =
    | { readonly ok: true; readonly entries: readonly DiagnosticEvent[] }
    | {
        readonly ok: false;
        readonly error: "disabled" | "empty" | "invalid-journal" | "storage-failed";
    };

/**
 * Clear result that distinguishes durable removal from a contained storage failure.
 */
export type DiagnosticJournalClearResult =
    | { readonly ok: true }
    | { readonly ok: false; readonly error: "disabled" | "storage-failed" };

/**
 * Accepts plain objects without inherited fields or accessors.
 *
 * @param value - Untrusted persisted value to inspect.
 * @returns - Whether the value is a non-array object record.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

const CATEGORY_SET = new Set<string>(DIAGNOSTIC_CATEGORIES);
const PAGE_CATEGORY_SET = new Set<string>(DIAGNOSTIC_PAGE_CATEGORIES);
const BROWSER_FAMILY_SET = new Set<string>(DIAGNOSTIC_BROWSER_FAMILIES);
const REASON_SET = new Set<string>(DIAGNOSTIC_REASONS);
const EVENT_KEY_SET = new Set<string>([
    ...DIAGNOSTIC_EVENT_REQUIRED_KEYS,
    ...DIAGNOSTIC_EVENT_OPTIONAL_KEYS,
]);

/**
 * Allows ordinary cross-realm records while rejecting inherited fields, serializers, and getters.
 *
 * @param value - Candidate diagnostic object.
 * @returns - Whether every enumerable field is an own data property.
 */
export function hasOnlyOwnDiagnosticProperties(value: object): boolean {
    try {
        if ("toJSON" in value) {
            return false;
        }
        for (const key in value) {
            if (!Object.hasOwn(value, key)) {
                return false;
            }
        }
        return Object.keys(value).every((key) => {
            const property = Object.getOwnPropertyDescriptor(value, key);
            return property !== undefined && Object.hasOwn(property, "value");
        });
    } catch {
        return false;
    }
}

/**
 * Accepts only bounded arrays whose items satisfy the durable diagnostic event shape.
 *
 * @param value - Untrusted persisted entries value.
 * @returns - Whether the value is a safely bounded diagnostic array.
 */
function isSafeDiagnosticArray(value: unknown): value is readonly unknown[] {
    if (!Array.isArray(value) || !hasOnlyOwnDiagnosticProperties(value)) {
        return false;
    }
    const keys = Object.keys(value);
    return keys.length === value.length && keys.every((key, index) => key === String(index));
}

/**
 * Verifies every persisted event has the finite categories and redacted fields expected by the
 * journal.
 *
 * @param value - Untrusted persisted event value.
 * @returns - Whether the value has the complete durable event shape.
 */
export function isDiagnosticJournalEvent(value: unknown): value is DiagnosticEvent {
    if (
        !isRecord(value) ||
        !hasOnlyOwnDiagnosticProperties(value) ||
        DIAGNOSTIC_EVENT_REQUIRED_KEYS.some((key) => !Object.hasOwn(value, key))
    ) {
        return false;
    }
    if (
        !CATEGORY_SET.has(String(value.category)) ||
        typeof value.timestamp !== "number" ||
        !Number.isSafeInteger(value.timestamp) ||
        value.timestamp < 0 ||
        typeof value.hostname !== "string" ||
        !isCanonicalHostname(value.hostname) ||
        !PAGE_CATEGORY_SET.has(String(value.pageCategory)) ||
        typeof value.incognito !== "boolean"
    ) {
        return false;
    }
    if (Object.keys(value).some((key) => !EVENT_KEY_SET.has(key))) {
        return false;
    }
    if (
        DIAGNOSTIC_EVENT_OPTIONAL_KEYS.some(
            (key) => key in value && !Object.hasOwn(value, key),
        )
    ) {
        return false;
    }
    if (
        Object.hasOwn(value, "count") &&
        (typeof value.count !== "number" ||
            !Number.isFinite(value.count) ||
            value.count < 0 ||
            value.count > DIAGNOSTIC_MAX_COUNT)
    ) {
        return false;
    }
    if (
        Object.hasOwn(value, "durationMs") &&
        (typeof value.durationMs !== "number" ||
            !Number.isFinite(value.durationMs) ||
            value.durationMs < 0 ||
            value.durationMs > DIAGNOSTIC_MAX_DURATION_MS)
    ) {
        return false;
    }
    if (
        Object.hasOwn(value, "adapterVersion") &&
        (typeof value.adapterVersion !== "string" ||
            !SAFE_EXTENSION_VERSION_PATTERN.test(value.adapterVersion))
    ) {
        return false;
    }
    if (
        Object.hasOwn(value, "extensionVersion") &&
        (typeof value.extensionVersion !== "string" ||
            !SAFE_EXTENSION_VERSION_PATTERN.test(value.extensionVersion))
    ) {
        return false;
    }
    if (
        Object.hasOwn(value, "browserFamily") &&
        (
            typeof value.browserFamily !== "string"
            || !BROWSER_FAMILY_SET.has(value.browserFamily)
        )
    ) {
        return false;
    }
    if (
        Object.hasOwn(value, "reason") &&
        (typeof value.reason !== "string" || !REASON_SET.has(value.reason))
    ) {
        return false;
    }
    if (
        Object.hasOwn(value, "stack") &&
        (!isSafeDiagnosticArray(value.stack) ||
            value.stack.length > DIAGNOSTIC_MAX_STACK_FRAMES ||
            value.stack.some(
                (frame) =>
                    typeof frame !== "string" || !DIAGNOSTIC_STACK_FRAME_PATTERN.test(frame),
            ))
    ) {
        return false;
    }
    return true;
}

/**
 * Validates the exact persisted journal envelope, including its complete UTF-8 byte limit.
 *
 * @param value - Untrusted persisted journal envelope.
 * @param maxBytes - Maximum serialized UTF-8 size.
 * @returns - Whether the envelope contains valid entries within the byte limit.
 */
export function isDiagnosticJournalEntries(
    value: unknown,
    maxBytes: number = DIAGNOSTICS_MAX_BYTES,
): value is readonly DiagnosticEvent[] {
    if (
        !Number.isSafeInteger(maxBytes) ||
        maxBytes <= 0 ||
        !isSafeDiagnosticArray(value) ||
        !value.every(isDiagnosticJournalEvent)
    ) {
        return false;
    }
    try {
        return bytes({ entries: value }) <= maxBytes;
    } catch {
        return false;
    }
}

/**
 * Returns journal entries only when the persisted envelope has the exact shape and fits its byte
 * budget.
 *
 * @param value - Untrusted persisted journal envelope.
 * @returns - Valid journal entries, or an empty array when rejected.
 */
function readEntries(value: unknown): DiagnosticEvent[] {
    if (
        !isRecord(value) ||
        Object.keys(value).length !== 1 ||
        !Object.hasOwn(value, "entries") ||
        !Array.isArray(value.entries)
    ) {
        return [];
    }
    return value.entries.filter(isDiagnosticJournalEvent);
}

/**
 * Measures the UTF-8 size used to enforce the journal storage limit.
 *
 * @param value - Diagnostic envelope to measure.
 * @returns - Serialized UTF-8 byte length.
 */
function bytes(value: DiagnosticEnvelope): number {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

/**
 * A background-owned journal. All storage work is serialized and failures are contained.
 */
export class DiagnosticJournal {
    /**
     * Gates all append, read, and clear-entry operations after the caller enables diagnostics.
     */
    private enabledState = false;

    /**
     * Invalidates queued storage writes whenever journaling is cleared, disabled, or reset.
     */
    private generation = 0;

    /**
     * Promise tail that serializes storage effects so a later operation cannot be overtaken.
     */
    private operationTail: Promise<void> = Promise.resolve();

    /**
     * Initializes durable storage access and rejects a non-positive journal byte limit.
     *
     * @param storage - Durable storage boundary for journal entries.
     * @param maxBytes - Maximum serialized journal size in bytes.
     */
    public constructor(
        private readonly storage: DiagnosticStorage,
        private readonly maxBytes: number = DIAGNOSTICS_MAX_BYTES,
    ) {
        if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
            throw new TypeError("Invalid diagnostics limit");
        }
    }

    /**
     * Indicates whether new diagnostic events are currently persisted.
     *
     * @returns - Whether future diagnostic events are persisted.
     */
    public get enabled(): boolean {
        return this.enabledState;
    }

    /**
     * Enables or disables future journal writes without discarding stored entries.
     *
     * @param enabled - Requested persistence state.
     * @returns - Promise settled after the policy transition is serialized.
     */
    public setEnabled(enabled: boolean): Promise<void> {
        if (typeof enabled !== "boolean") {
            return Promise.resolve();
        }
        this.generation += 1;
        this.enabledState = enabled;
        if (!enabled) {
            return this.enqueue(async () => {
                try {
                    await this.storage.remove(DIAGNOSTICS_STORAGE_KEY);
                } catch {
                    /* diagnostics must not affect processing */
                }
            });
        }
        return Promise.resolve();
    }

    /**
     * Records a bounded diagnostic event when journaling is enabled.
     *
     * @param event - Valid bounded diagnostic event to record.
     * @returns - Promise settled after the conditional write completes.
     */
    public record(event: DiagnosticEvent): Promise<void> {
        return this.append(event);
    }

    /**
     * Appends an event and trims oldest entries until the serialized envelope fits.
     *
     * @param event - Valid bounded diagnostic event to append.
     * @returns - Promise settled after storage is trimmed and updated.
     */
    public append(event: DiagnosticEvent): Promise<void> {
        if (!this.enabledState) {
            return Promise.resolve();
        }
        const generation = this.generation;
        return this.enqueue(async () => {
            if (!this.isCurrentGeneration(generation) || !isDiagnosticJournalEvent(event)) {
                return;
            }
            let current: DiagnosticEvent[];
            try {
                const values = await this.storage.get(DIAGNOSTICS_STORAGE_KEY);
                if (!this.isCurrentGeneration(generation)) {
                    return;
                }
                current = readEntries(values[DIAGNOSTICS_STORAGE_KEY]);
            } catch {
                return;
            }
            if (bytes({ entries: [event] }) > this.maxBytes) {
                return;
            }
            const entries = [...current, event];
            while (entries.length > 0 && bytes({ entries }) > this.maxBytes) {
                entries.shift();
            }
            if (entries.length === 0) {
                return;
            }
            if (!this.isCurrentGeneration(generation)) {
                return;
            }
            try {
                await this.storage.set({
                    [DIAGNOSTICS_STORAGE_KEY]: { entries } satisfies DiagnosticEnvelope,
                });
            } catch {
                /* isolated failure */
            }
        });
    }

    /**
     * Removes persisted journal entries and advances the write generation.
     *
     * @returns - Promise settled after durable entries are removed.
     */
    public clear(): Promise<void> {
        this.generation += 1;
        this.enabledState = false;
        return this.enqueue(async () => {
            try {
                await this.storage.remove(DIAGNOSTICS_STORAGE_KEY);
            } catch {
                /* isolated failure */
            }
        });
    }

    /**
     * Returns the current journal snapshot without exposing storage failures.
     *
     * @returns - Current snapshot or a contained storage failure.
     */
    public readSnapshot(): Promise<DiagnosticJournalSnapshotResult> {
        if (!this.enabledState) {
            return Promise.resolve({ ok: false, error: "disabled" });
        }
        const generation = this.generation;
        return this.serialize(async (): Promise<DiagnosticJournalSnapshotResult> => {
            if (!this.isCurrentGeneration(generation)) {
                return { ok: false, error: "disabled" };
            }
            let values: Record<string, unknown>;
            try {
                values = await this.storage.get(DIAGNOSTICS_STORAGE_KEY);
            } catch {
                return { ok: false, error: "storage-failed" };
            }
            if (!this.isCurrentGeneration(generation)) {
                return { ok: false, error: "disabled" };
            }
            if (!isRecord(values)) {
                return { ok: false, error: "invalid-journal" };
            }
            if (!Object.hasOwn(values, DIAGNOSTICS_STORAGE_KEY)) {
                return { ok: false, error: "empty" };
            }
            const value = values[DIAGNOSTICS_STORAGE_KEY];
            if (
                !isRecord(value) ||
                !hasOnlyOwnDiagnosticProperties(value) ||
                Object.keys(value).length !== 1 ||
                !Object.hasOwn(value, "entries") ||
                !isDiagnosticJournalEntries(value.entries, this.maxBytes)
            ) {
                return { ok: false, error: "invalid-journal" };
            }
            if (value.entries.length === 0) {
                return { ok: false, error: "empty" };
            }
            return { ok: true, entries: [...value.entries] };
        });
    }

    /**
     * Advances the journal generation and removes durable entries; a failed storage removal leaves
     * the journal enabled but reports a contained clear error.
     *
     * @returns - Clear result reporting success or a contained storage failure.
     */
    public clearEntries(): Promise<DiagnosticJournalClearResult> {
        if (!this.enabledState) {
            return Promise.resolve({ ok: false, error: "disabled" });
        }
        this.generation += 1;
        const generation = this.generation;
        return this.serialize(async (): Promise<DiagnosticJournalClearResult> => {
            if (!this.isCurrentGeneration(generation)) {
                return { ok: false, error: "disabled" };
            }
            try {
                await this.storage.remove(DIAGNOSTICS_STORAGE_KEY);
            } catch {
                return { ok: false, error: "storage-failed" };
            }
            return this.isCurrentGeneration(generation)
                ? { ok: true }
                : { ok: false, error: "disabled" };
        });
    }

    /**
     * Prevents an older queued write from committing after journaling is disabled or reset.
     *
     * @param generation - Generation captured by a queued operation.
     * @returns - Whether the operation still belongs to the active generation.
     */
    private isCurrentGeneration(generation: number): boolean {
        return this.enabledState && generation === this.generation;
    }

    /**
     * Serializes storage operations so stale writes cannot overwrite a newer generation.
     *
     * @param operation - Storage write to append to the journal queue.
     * @returns - Promise settled after the queued operation completes.
     */
    private enqueue(operation: () => Promise<void>): Promise<void> {
        return this.serialize(operation).then(
            () => undefined,
            () => undefined,
        );
    }

    /**
     * Chains a storage operation after earlier writes while preserving its own result.
     *
     * @param operation - Result-bearing storage operation to serialize.
     * @returns - Promise carrying the operation result after earlier writes complete.
     */
    private serialize<Result>(operation: () => Promise<Result>): Promise<Result> {
        const run = this.operationTail.then(operation, operation);
        this.operationTail = run.then(
            () => undefined,
            () => undefined,
        );
        return run;
    }
}
