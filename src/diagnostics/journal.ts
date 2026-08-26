import { isCanonicalHostname } from "../settings/snapshot";
import type { DiagnosticEvent } from "./events";

export const DIAGNOSTICS_STORAGE_KEY = "diagnostics" as const;
export const DIAGNOSTICS_MAX_BYTES = 5_000_000 as const;

export interface DiagnosticStorage {
    get(keys?: string | readonly string[] | Record<string, unknown>): Promise<Record<string, unknown>>;
    set(items: Record<string, unknown>): Promise<void>;
    remove(keys: string | readonly string[]): Promise<void>;
}

interface DiagnosticEnvelope { readonly entries: readonly DiagnosticEvent[]; }

export type DiagnosticJournalSnapshotResult =
  | { readonly ok: true; readonly entries: readonly DiagnosticEvent[] }
  | { readonly ok: false; readonly error: "disabled" | "empty" | "invalid-journal" | "storage-failed" };

export type DiagnosticJournalClearResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: "disabled" | "storage-failed" };

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

const CATEGORIES = new Set(["lifecycle", "adapter", "mutation", "timing", "settings", "skip", "error"]);
const PAGES = new Set(["repository", "issue", "pull-request", "actions", "settings", "other"]);
const BROWSERS = new Set(["chromium", "firefox", "other"]);
const OPTIONAL = new Set(["count", "durationMs", "reason", "adapterVersion", "extensionVersion", "browserFamily", "stack"]);
const REASONS = new Set(["adapter-matched", "adapter-missing", "candidate-skipped", "invalid-timestamp", "already-owned", "unsupported", "processing-failed", "storage-failed", "settings-updated"]);

/** Allows ordinary cross-realm records while rejecting inherited fields, serializers, and getters. */
export function hasOnlyOwnDiagnosticProperties(value: object): boolean {
    try {
        if ("toJSON" in value) return false;
        for (const key in value) if (!Object.hasOwn(value, key)) return false;
        return Object.keys(value).every((key) => {
            const property = Object.getOwnPropertyDescriptor(value, key);
            return property !== undefined && Object.hasOwn(property, "value");
        });
    } catch {
        return false;
    }
}

function isSafeDiagnosticArray(value: unknown): value is readonly unknown[] {
    if (!Array.isArray(value) || !hasOnlyOwnDiagnosticProperties(value)) return false;
    const keys = Object.keys(value);
    return keys.length === value.length && keys.every((key, index) => key === String(index));
}

export function isDiagnosticJournalEvent(value: unknown): value is DiagnosticEvent {
    if (!isRecord(value) || !hasOnlyOwnDiagnosticProperties(value) || !Object.hasOwn(value, "category") || !Object.hasOwn(value, "timestamp") || !Object.hasOwn(value, "hostname") || !Object.hasOwn(value, "pageCategory") || !Object.hasOwn(value, "incognito")) return false;
    if (!CATEGORIES.has(String(value.category)) || typeof value.timestamp !== "number" || !Number.isSafeInteger(value.timestamp) || value.timestamp < 0 || typeof value.hostname !== "string" || !isCanonicalHostname(value.hostname) || !PAGES.has(String(value.pageCategory)) || typeof value.incognito !== "boolean") return false;
    if (Object.keys(value).some((key) => !["category", "timestamp", "hostname", "pageCategory", "incognito", ...OPTIONAL].includes(key))) return false;
    if ([...OPTIONAL].some((key) => key in value && !Object.hasOwn(value, key))) return false;
    if (Object.hasOwn(value, "count") && (typeof value.count !== "number" || !Number.isFinite(value.count) || value.count < 0 || value.count > 1_000_000)) return false;
    if (Object.hasOwn(value, "durationMs") && (typeof value.durationMs !== "number" || !Number.isFinite(value.durationMs) || value.durationMs < 0 || value.durationMs > 86_400_000)) return false;
    if (Object.hasOwn(value, "adapterVersion") && (typeof value.adapterVersion !== "string" || !/^[0-9A-Za-z][0-9A-Za-z._+-]{0,31}$/u.test(value.adapterVersion))) return false;
    if (Object.hasOwn(value, "extensionVersion") && (typeof value.extensionVersion !== "string" || !/^[0-9A-Za-z][0-9A-Za-z._+-]{0,31}$/u.test(value.extensionVersion))) return false;
    if (Object.hasOwn(value, "browserFamily") && (typeof value.browserFamily !== "string" || !BROWSERS.has(value.browserFamily))) return false;
    if (Object.hasOwn(value, "reason") && (typeof value.reason !== "string" || !REASONS.has(value.reason))) return false;
    if (Object.hasOwn(value, "stack") && (!isSafeDiagnosticArray(value.stack) || value.stack.length > 16 || value.stack.some((frame) => typeof frame !== "string" || !/^frame(?::\d+(?::\d+)?)?$/u.test(frame)))) return false;
    return true;
}

/** Validates the exact persisted journal envelope, including its complete UTF-8 byte limit. */
export function isDiagnosticJournalEntries(value: unknown, maxBytes: number = DIAGNOSTICS_MAX_BYTES): value is readonly DiagnosticEvent[] {
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0 || !isSafeDiagnosticArray(value) || !value.every(isDiagnosticJournalEvent)) return false;
    try {
        return bytes({ entries: value }) <= maxBytes;
    } catch {
        return false;
    }
}

function readEntries(value: unknown): DiagnosticEvent[] {
    if (!isRecord(value) || Object.keys(value).length !== 1 || !Object.hasOwn(value, "entries") || !Array.isArray(value.entries)) return [];
    return value.entries.filter(isDiagnosticJournalEvent);
}

function bytes(value: DiagnosticEnvelope): number {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

/** A background-owned journal. All storage work is serialized and failures are contained. */
export class DiagnosticJournal {
    private enabledState = false;
    private generation = 0;
    private operationTail: Promise<void> = Promise.resolve();

    public constructor(private readonly storage: DiagnosticStorage, private readonly maxBytes: number = DIAGNOSTICS_MAX_BYTES) {
        if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new TypeError("Invalid diagnostics limit");
    }

    public get enabled(): boolean { return this.enabledState; }

    public setEnabled(enabled: boolean): Promise<void> {
        if (typeof enabled !== "boolean") return Promise.resolve();
        this.generation += 1;
        this.enabledState = enabled;
        if (!enabled) return this.enqueue(async () => { try { await this.storage.remove(DIAGNOSTICS_STORAGE_KEY); } catch { /* diagnostics must not affect processing */ } });
        return Promise.resolve();
    }

    public record(event: DiagnosticEvent): Promise<void> { return this.append(event); }

    public append(event: DiagnosticEvent): Promise<void> {
        if (!this.enabledState) return Promise.resolve();
        const generation = this.generation;
        return this.enqueue(async () => {
            if (!this.isCurrentGeneration(generation) || !isDiagnosticJournalEvent(event)) return;
            let current: DiagnosticEvent[];
            try {
                const values = await this.storage.get(DIAGNOSTICS_STORAGE_KEY);
                if (!this.isCurrentGeneration(generation)) return;
                current = readEntries(values[DIAGNOSTICS_STORAGE_KEY]);
            } catch { return; }
            if (bytes({ entries: [event] }) > this.maxBytes) return;
            const entries = [...current, event];
            while (entries.length > 0 && bytes({ entries }) > this.maxBytes) entries.shift();
            if (entries.length === 0) return;
            if (!this.isCurrentGeneration(generation)) return;
            try { await this.storage.set({ [DIAGNOSTICS_STORAGE_KEY]: { entries } satisfies DiagnosticEnvelope }); } catch { /* isolated failure */ }
        });
    }

    public clear(): Promise<void> {
        this.generation += 1;
        this.enabledState = false;
        return this.enqueue(async () => { try { await this.storage.remove(DIAGNOSTICS_STORAGE_KEY); } catch { /* isolated failure */ } });
    }

    public readSnapshot(): Promise<DiagnosticJournalSnapshotResult> {
        if (!this.enabledState) return Promise.resolve({ ok: false, error: "disabled" });
        const generation = this.generation;
        return this.serialize(async (): Promise<DiagnosticJournalSnapshotResult> => {
            if (!this.isCurrentGeneration(generation)) return { ok: false, error: "disabled" };
            let values: Record<string, unknown>;
            try { values = await this.storage.get(DIAGNOSTICS_STORAGE_KEY); }
            catch { return { ok: false, error: "storage-failed" }; }
            if (!this.isCurrentGeneration(generation)) return { ok: false, error: "disabled" };
            if (!isRecord(values)) return { ok: false, error: "invalid-journal" };
            if (!Object.hasOwn(values, DIAGNOSTICS_STORAGE_KEY)) return { ok: false, error: "empty" };
            const value = values[DIAGNOSTICS_STORAGE_KEY];
            if (!isRecord(value) || !hasOnlyOwnDiagnosticProperties(value) || Object.keys(value).length !== 1 || !Object.hasOwn(value, "entries") || !isDiagnosticJournalEntries(value.entries, this.maxBytes)) {
                return { ok: false, error: "invalid-journal" };
            }
            if (value.entries.length === 0) return { ok: false, error: "empty" };
            return { ok: true, entries: [...value.entries] };
        });
    }

    public clearEntries(): Promise<DiagnosticJournalClearResult> {
        if (!this.enabledState) return Promise.resolve({ ok: false, error: "disabled" });
        this.generation += 1;
        const generation = this.generation;
        return this.serialize(async (): Promise<DiagnosticJournalClearResult> => {
            if (!this.isCurrentGeneration(generation)) return { ok: false, error: "disabled" };
            try { await this.storage.remove(DIAGNOSTICS_STORAGE_KEY); }
            catch { return { ok: false, error: "storage-failed" }; }
            return this.isCurrentGeneration(generation) ? { ok: true } : { ok: false, error: "disabled" };
        });
    }

    private isCurrentGeneration(generation: number): boolean {
        return this.enabledState && generation === this.generation;
    }

    private enqueue(operation: () => Promise<void>): Promise<void> {
        return this.serialize(operation).then(() => undefined, () => undefined);
    }

    private serialize<Result>(operation: () => Promise<Result>): Promise<Result> {
        const run = this.operationTail.then(operation, operation);
        this.operationTail = run.then(() => undefined, () => undefined);
        return run;
    }
}
