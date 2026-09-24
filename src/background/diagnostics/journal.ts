/**
 * @file Persists a bounded serialized journal of canonical diagnostic events.
 */

import {
    DIAGNOSTICS_ERROR,
    type DiagnosticsClearError,
    type DiagnosticsSnapshotError,
} from '../../shared/messaging/contracts';

import type { DiagnosticEvent } from '../../shared/diagnostics/events';

/**
 * Storage key containing diagnostic events.
 */
export const DIAGNOSTICS_STORAGE_KEY = 'diagnostics' as const;

/**
 * Maximum serialized diagnostic journal size.
 */
export const DIAGNOSTICS_MAX_BYTES = 5_000_000 as const;

/**
 * Storage operations used by the diagnostics journal.
 */
export interface DiagnosticStorage {
    /**
     * Reads diagnostic values from storage.
     */
    get(
        keys?: string | readonly string[] | Record<string, unknown>,
    ): Promise<Record<string, unknown>>;

    /**
     * Writes diagnostic values to storage.
     */
    set(items: Record<string, unknown>): Promise<void>;

    /**
     * Removes diagnostic values from storage.
     */
    remove(keys: string | readonly string[]): Promise<void>;
}

/**
 * Result of reading a diagnostic snapshot.
 */
export type DiagnosticJournalSnapshotResult = | {
    /**
     * Marks a successful snapshot read.
     */
    readonly ok: true;

    /**
     * Canonical events loaded from storage.
     */
    readonly entries: readonly DiagnosticEvent[];
}
    | {
        /**
         * Marks a failed snapshot read.
         */
        readonly ok: false;

        /**
         * Stable failure reported to the options page.
         */
        readonly error: DiagnosticsSnapshotError;
    };

/**
 * Result of clearing diagnostic entries.
 */
export type DiagnosticJournalClearResult = | {
    /**
     * Marks a successful clear.
     */
    readonly ok: true;
}
    | {
        /**
         * Marks a failed clear.
         */
        readonly ok: false;

        /**
         * Stable clear failure reported to the options page.
         */
        readonly error: DiagnosticsClearError;
    };

/**
 * Extension-owned envelope persisted under the diagnostics storage key.
 */
interface DiagnosticJournalEnvelope {
    /**
     * Canonical events written by this extension, oldest first.
     */
    readonly entries: readonly DiagnosticEvent[];
}

/**
 * Measures a diagnostic envelope's serialized UTF-8 size.
 *
 * @param value - Diagnostic envelope.
 *
 * @returns - Serialized byte length.
 */
function byteLength(value: unknown): number {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

/**
 * Durable diagnostic journal as the diagnostics service uses it.
 */
export interface DiagnosticJournalStore {
    /**
     * Enables or disables collection.
     *
     * @param enabled - Requested collection state.
     *
     * @returns - Promise settled after the policy change.
     */
    setEnabled(enabled: boolean): Promise<void>;

    /**
     * Appends one trusted event while collection is enabled.
     *
     * @param event - Sanitized diagnostic event.
     *
     * @returns - Promise settled after the storage attempt.
     */
    append(event: DiagnosticEvent): Promise<void>;

    /**
     * Removes every stored entry and disables collection.
     *
     * @returns - Promise settled after the removal attempt.
     */
    clear(): Promise<void>;

    /**
     * Reads stored entries while collection is enabled.
     *
     * @returns - Canonical events or a contained storage error.
     */
    readSnapshot(): Promise<DiagnosticJournalSnapshotResult>;

    /**
     * Reads stored entries regardless of the collection policy.
     *
     * @returns - Canonical events or a contained storage error.
     */
    readStored(): Promise<DiagnosticJournalSnapshotResult>;

    /**
     * Removes every stored entry while keeping collection enabled.
     *
     * @returns - Durable clear result.
     */
    clearEntries(): Promise<DiagnosticJournalClearResult>;
}

/**
 * Serializes diagnostic storage work and deletes entries when logging is disabled.
 */
export class DiagnosticJournal implements DiagnosticJournalStore {
    /**
     * Whether new events may be persisted.
     */
    private enabledState = false;

    /**
     * Policy generation used to discard writes queued before a disable.
     */
    private generation = 0;

    /**
     * Tail of the serialized storage-operation queue.
     */
    private operationTail: Promise<void> = Promise.resolve();

    /**
     * Creates a bounded diagnostic journal.
     *
     * @param storage - Durable extension storage.
     * @param maxBytes - Maximum serialized journal size.
     */
    public constructor(
        private readonly storage: DiagnosticStorage,
        private readonly maxBytes: number = DIAGNOSTICS_MAX_BYTES,
    ) {
        if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
            throw new TypeError('Invalid diagnostics limit');
        }
    }

    /**
     * Reports whether new events are persisted.
     *
     * @returns - Current diagnostic policy.
     */
    public get enabled(): boolean {
        return this.enabledState;
    }

    /**
     * Enables logging or disables it and deletes retained entries.
     *
     * @param enabled - Requested logging policy.
     *
     * @returns - Promise settled after the policy change.
     */
    public setEnabled(enabled: boolean): Promise<void> {
        this.generation += 1;
        this.enabledState = enabled;
        return enabled ? Promise.resolve() : this.removeStoredEntries();
    }

    /**
     * Appends one canonical event and evicts oldest entries above the byte limit.
     *
     * @param event - Canonical diagnostic event.
     *
     * @returns - Promise settled after the storage attempt.
     */
    public append(event: DiagnosticEvent): Promise<void> {
        if (!this.enabledState) {
            return Promise.resolve();
        }
        const { generation } = this;
        return this.enqueue(async () => {
            if (!this.isCurrent(generation)) {
                return;
            }
            let values: Record<string, unknown>;
            try {
                values = await this.storage.get(DIAGNOSTICS_STORAGE_KEY);
            } catch {
                return;
            }
            const stored = values[DIAGNOSTICS_STORAGE_KEY] as
                DiagnosticJournalEnvelope | undefined;
            const entries = [...stored?.entries ?? [], event];
            while (entries.length > 0 && byteLength({ entries }) > this.maxBytes) {
                entries.shift();
            }
            if (entries.length === 0 || !this.isCurrent(generation)) {
                return;
            }
            try {
                await this.storage.set({ [DIAGNOSTICS_STORAGE_KEY]: { entries } });
            } catch {
                /* diagnostics never interfere with timestamp processing */
            }
        });
    }

    /**
     * Disables logging and removes all retained entries.
     *
     * @returns - Promise settled after the removal attempt.
     */
    public clear(): Promise<void> {
        this.generation += 1;
        this.enabledState = false;
        return this.removeStoredEntries();
    }

    /**
     * Reads and validates the current stored envelope once while logging is enabled.
     *
     * @returns - Canonical events or a contained storage error.
     */
    public readSnapshot(): Promise<DiagnosticJournalSnapshotResult> {
        if (!this.enabledState) {
            return Promise.resolve({ ok: false, error: DIAGNOSTICS_ERROR.DISABLED });
        }
        const { generation } = this;
        return this.serialize(async () => (this.isCurrent(generation)
            ? this.readEnvelope()
            : { ok: false, error: DIAGNOSTICS_ERROR.DISABLED } as const));
    }

    /**
     * Reads retained entries regardless of the logging policy, for recovery
     * views that offer logs while settings cannot be read.
     *
     * @returns - Canonical events or a contained storage error.
     */
    public readStored(): Promise<DiagnosticJournalSnapshotResult> {
        return this.serialize(() => this.readEnvelope());
    }

    /**
     * Reads and validates the stored envelope.
     *
     * @returns - Canonical events or a contained storage error.
     */
    private async readEnvelope(): Promise<DiagnosticJournalSnapshotResult> {
        let values: Record<string, unknown>;
        try {
            values = await this.storage.get(DIAGNOSTICS_STORAGE_KEY);
        } catch {
            return { ok: false, error: DIAGNOSTICS_ERROR.STORAGE_FAILED };
        }
        if (!Object.hasOwn(values, DIAGNOSTICS_STORAGE_KEY)) {
            return { ok: false, error: DIAGNOSTICS_ERROR.EMPTY };
        }
        const { entries } = values[DIAGNOSTICS_STORAGE_KEY] as DiagnosticJournalEnvelope;
        return entries.length === 0
            ? { ok: false, error: DIAGNOSTICS_ERROR.EMPTY }
            : { ok: true, entries };
    }

    /**
     * Clears retained entries while keeping logging enabled.
     *
     * @returns - Durable clear result.
     */
    public clearEntries(): Promise<DiagnosticJournalClearResult> {
        if (!this.enabledState) {
            return Promise.resolve({ ok: false, error: DIAGNOSTICS_ERROR.DISABLED });
        }
        this.generation += 1;
        return this.serialize(async () => {
            try {
                await this.storage.remove(DIAGNOSTICS_STORAGE_KEY);
                return { ok: true } as const;
            } catch {
                return { ok: false, error: DIAGNOSTICS_ERROR.STORAGE_FAILED } as const;
            }
        });
    }

    /**
     * Removes stored entries without exposing storage failures.
     *
     * @returns - Promise settled after the removal attempt.
     */
    private removeStoredEntries(): Promise<void> {
        return this.enqueue(async () => {
            try {
                await this.storage.remove(DIAGNOSTICS_STORAGE_KEY);
            } catch {
                /* diagnostics cleanup is best effort */
            }
        });
    }

    /**
     * Reports whether a queued operation still belongs to the active policy.
     *
     * @param generation - Operation generation.
     *
     * @returns - Whether the operation may persist data.
     */
    private isCurrent(generation: number): boolean {
        return this.enabledState && generation === this.generation;
    }

    /**
     * Serializes a fire-and-forget storage operation.
     *
     * @param operation - Storage operation.
     *
     * @returns - Promise settled after the operation.
     */
    private enqueue(operation: () => Promise<void>): Promise<void> {
        return this.serialize(operation).then(
            () => undefined,
            () => undefined,
        );
    }

    /**
     * Serializes one storage operation and preserves its result.
     *
     * @param operation - Storage operation.
     *
     * @returns - Operation result.
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
