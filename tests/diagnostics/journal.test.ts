import { describe, expect, it, vi } from "vitest";
import { DiagnosticJournal, DIAGNOSTICS_MAX_BYTES, DIAGNOSTICS_STORAGE_KEY, type DiagnosticStorage } from "../../src/diagnostics/journal";
import type { DiagnosticEvent } from "../../src/diagnostics/events";

const event = (n: number, text = "") : DiagnosticEvent => ({ category: "mutation", timestamp: n, hostname: "github.com", pageCategory: "repository", incognito: false, count: n, ...(text ? { reason: text } : {}) });

function storage(initial?: unknown): DiagnosticStorage & { value: unknown; calls: string[] } {
    const state = { value: initial, calls: [] as string[] };
    return {
        get: vi.fn(() => {
            state.calls.push("get");
            return Promise.resolve(state.value === undefined ? {} : { [DIAGNOSTICS_STORAGE_KEY]: state.value });
        }),
        set: vi.fn((items: Record<string, unknown>) => {
            state.calls.push("set");
            state.value = items[DIAGNOSTICS_STORAGE_KEY];
            return Promise.resolve();
        }),
        remove: vi.fn(() => {
            state.calls.push("remove");
            state.value = undefined;
            return Promise.resolve();
        }),
        get value() {
            return state.value;
        },
        get calls() {
            return state.calls;
        }
    };
}

describe("DiagnosticJournal", () => {
    it("uses the exact five-megabyte default envelope limit", () => {
        expect(DIAGNOSTICS_MAX_BYTES).toBe(5_000_000);
    });

    it("does no storage work while disabled and deletes on disable", async () => {
        const backend = storage();
        const journal = new DiagnosticJournal(backend, 500);
        await journal.append(event(1));
        expect(backend.calls).toEqual([]);
        await journal.setEnabled(true);
        await journal.append(event(1));
        expect(backend.calls).toEqual(["get", "set"]);
        await journal.setEnabled(false);
        expect(backend.calls.at(-1)).toBe("remove");
        expect(backend.value).toBeUndefined();
    });

    it("evicts oldest records and includes the complete UTF-8 envelope in the cap", async () => {
        const backend = storage();
        const journal = new DiagnosticJournal(backend, 300);
        await journal.setEnabled(true);
        await journal.append(event(1));
        await journal.append(event(2));
        const envelope = backend.value as { entries: DiagnosticEvent[] };
        expect(envelope.entries.at(-1)?.timestamp).toBe(2);
        expect(new TextEncoder().encode(JSON.stringify(envelope)).byteLength).toBeLessThanOrEqual(300);
    });

    it("discards an individually excessive event", async () => {
        const backend = storage();
        const journal = new DiagnosticJournal(backend, 10);
        await journal.setEnabled(true);
        await journal.append(event(1));
        expect(backend.value).toBeUndefined();
        expect(backend.calls).toEqual(["get"]);
    });

    it("serializes appends and cannot resurrect an event across disable/enable", async () => {
        const backend = storage();
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        backend.get = vi.fn(async () => {
            await gate; return {};
        });
        const journal = new DiagnosticJournal(backend, DIAGNOSTICS_MAX_BYTES);
        await journal.setEnabled(true);
        const pending = journal.append(event(1));
        const disabled = journal.setEnabled(false);
        const enabled = journal.setEnabled(true);
        release();
        await Promise.all([pending, disabled, enabled]);
        expect(backend.calls).not.toContain("set");
    });

    it("contains storage errors", async () => {
        const backend = storage();
        backend.get = vi.fn().mockRejectedValue(new Error("no access"));
        backend.set = vi.fn().mockRejectedValue(new Error("full"));
        backend.remove = vi.fn().mockRejectedValue(new Error("no access"));
        const journal = new DiagnosticJournal(backend);
        await expect(journal.setEnabled(true)).resolves.toBeUndefined();
        await expect(journal.append(event(1))).resolves.toBeUndefined();
        await expect(journal.clear()).resolves.toBeUndefined();
    });

    it("discards malformed or poisoned persisted entries before the next append", async () => {
        const poisoned = { entries: [{ category: "error", timestamp: 1, hostname: "github.com", pageCategory: "other", incognito: false, url: "https://secret", text: "DOM" }] };
        const backend = storage(poisoned);
        const journal = new DiagnosticJournal(backend, 500);
        await journal.setEnabled(true);
        await journal.append(event(2));
        expect(backend.value).toEqual({ entries: [event(2)] });
    });

    it("keeps concurrent appends ordered", async () => {
        const backend = storage();
        const journal = new DiagnosticJournal(backend, 1000);
        await journal.setEnabled(true);
        await Promise.all([journal.append(event(1)), journal.append(event(2)), journal.append(event(3))]);
        expect((backend.value as { entries: DiagnosticEvent[] }).entries.map((entry) => entry.timestamp)).toEqual([1, 2, 3]);
    });

    it("reads the complete ordered sanitized journal only while collection is enabled", async () => {
        const backend = storage();
        const journal = new DiagnosticJournal(backend);
        await expect(journal.readSnapshot()).resolves.toEqual({ ok: false, error: "disabled" });
        expect(backend.calls).toEqual([]);
        await journal.setEnabled(true);
        await expect(journal.readSnapshot()).resolves.toEqual({ ok: false, error: "empty" });
        await Promise.all([journal.append(event(1)), journal.append(event(2)), journal.append(event(3))]);
        await expect(journal.readSnapshot()).resolves.toEqual({ ok: true, entries: [event(1), event(2), event(3)] });
    });

    it.each([
        null,
        [],
        {},
        { entries: [event(1)], extra: true },
        { entries: [{ ...event(1), url: "https://github.com/private?token=secret" }] },
        { entries: [{ ...event(1), datetime: "2026-08-23T10:15:00Z" }] },
        { entries: [{ ...event(1), browserFamily: "attacker" }] },
        { entries: [{ ...event(1), stack: ["https://github.com/private"] }] },
        { entries: [Object.assign(Object.create({ count: 9 }) as Record<string, unknown>, { category: "mutation", timestamp: 1, hostname: "github.com", pageCategory: "repository", incognito: false })] },
        { entries: [Object.assign(Object.create({ url: "https://github.com/private" }) as Record<string, unknown>, event(1))] },
        Object.assign(Object.create({ entries: [event(1)] }) as Record<string, unknown>, { extra: true })
    ])("refuses malformed or privacy-violating complete journal %#", async (invalid) => {
        const backend = storage(invalid);
        const journal = new DiagnosticJournal(backend);
        await journal.setEnabled(true);
        await expect(journal.readSnapshot()).resolves.toEqual({ ok: false, error: "invalid-journal" });
    });

    it("treats a valid zero-entry persisted envelope as empty", async () => {
        const journal = new DiagnosticJournal(storage({ entries: [] }));
        await journal.setEnabled(true);
        await expect(journal.readSnapshot()).resolves.toEqual({ ok: false, error: "empty" });
    });

    it("rejects inherited envelope fields and hidden serializers at every persisted boundary", async () => {
        const serializer = Object.defineProperty({}, "toJSON", {
            value: () => ({ url: "https://github.com/private?token=secret", datetime: "2026-08-23T10:15:00Z", dom: "<secret>" })
        });
        const arraySerializer = Object.defineProperty(Object.create(Array.prototype) as object, "toJSON", { value: () => ({ token: "secret" }) });
        const inheritedEnvelope = Object.assign(Object.create({ secret: "inherited-private-field" }) as Record<string, unknown>, { entries: [event(1)] });
        const serializedEnvelope = Object.assign(Object.create(serializer) as Record<string, unknown>, { entries: [event(1)] });
        const serializedEntries = Object.setPrototypeOf([event(1)], arraySerializer) as DiagnosticEvent[];
        const serializedEvent = Object.assign(Object.create(serializer) as Record<string, unknown>, event(1));
        const serializedStack = Object.setPrototypeOf(["frame:42"], arraySerializer) as string[];
        const inheritedArray = Object.setPrototypeOf([event(1)], Object.assign(Object.create(Array.prototype) as object, { secret: "private" })) as DiagnosticEvent[];
        const readGetter = vi.fn(() => [event(1)]);
        const accessorEnvelope = Object.defineProperty({}, "entries", { enumerable: true, get: readGetter });
        for (const invalid of [inheritedEnvelope, serializedEnvelope, accessorEnvelope, { entries: serializedEntries }, { entries: inheritedArray }, { entries: [serializedEvent] }, { entries: [{ ...event(1), stack: serializedStack }] }]) {
            const journal = new DiagnosticJournal(storage(invalid));
            await journal.setEnabled(true);
            await expect(journal.readSnapshot()).resolves.toEqual({ ok: false, error: "invalid-journal" });
        }
        expect(readGetter).not.toHaveBeenCalled();
    });

    it("accepts the exact complete UTF-8 envelope limit and refuses one byte above it", async () => {
        const envelope = { entries: [event(1), event(2)] };
        const exactBytes = new TextEncoder().encode(JSON.stringify(envelope)).byteLength;
        const exact = new DiagnosticJournal(storage(envelope), exactBytes);
        const excessive = new DiagnosticJournal(storage(envelope), exactBytes - 1);
        await Promise.all([exact.setEnabled(true), excessive.setEnabled(true)]);
        await expect(exact.readSnapshot()).resolves.toEqual({ ok: true, entries: envelope.entries });
        await expect(excessive.readSnapshot()).resolves.toEqual({ ok: false, error: "invalid-journal" });
    });

    it("accepts exactly five million UTF-8 bytes and rejects five million plus one", async () => {
        const base = { entries: [{ ...event(1), stack: ["frame:"] }] };
        const overhead = new TextEncoder().encode(JSON.stringify(base)).byteLength;
        const frame = `frame:${"1".repeat(DIAGNOSTICS_MAX_BYTES - overhead)}`;
        const exact = { entries: [{ ...event(1), stack: [frame] }] };
        const oversized = { entries: [{ ...event(1), stack: [`${frame}1`] }] };
        expect(new TextEncoder().encode(JSON.stringify(exact)).byteLength).toBe(DIAGNOSTICS_MAX_BYTES);
        expect(new TextEncoder().encode(JSON.stringify(oversized)).byteLength).toBe(DIAGNOSTICS_MAX_BYTES + 1);
        for (const [envelope, accepted] of [[exact, true], [oversized, false]] as const) {
            const journal = new DiagnosticJournal(storage(envelope));
            await journal.setEnabled(true);
            const result = await journal.readSnapshot();
            expect(result.ok).toBe(accepted);
            if (!result.ok) {
                expect(result.error).toBe("invalid-journal");
            }
        }
    });

    it("reports failed snapshot storage access without changing collection", async () => {
        const backend = storage();
        backend.get = vi.fn().mockRejectedValue(new Error("journal unavailable"));
        const journal = new DiagnosticJournal(backend);
        await journal.setEnabled(true);
        await expect(journal.readSnapshot()).resolves.toEqual({ ok: false, error: "storage-failed" });
        expect(journal.enabled).toBe(true);
    });

    it("clears only existing entries and keeps accepting newer diagnostics", async () => {
        const backend = storage();
        const journal = new DiagnosticJournal(backend);
        await expect(journal.clearEntries()).resolves.toEqual({ ok: false, error: "disabled" });
        expect(backend.calls).toEqual([]);
        await journal.setEnabled(true);
        await journal.append(event(1));
        await expect(journal.clearEntries()).resolves.toEqual({ ok: true });
        expect(journal.enabled).toBe(true);
        expect(backend.value).toBeUndefined();
        await expect(journal.readSnapshot()).resolves.toEqual({ ok: false, error: "empty" });
        await journal.append(event(2));
        await expect(journal.readSnapshot()).resolves.toEqual({ ok: true, entries: [event(2)] });
        expect(backend.calls.filter((call) => call === "remove")).toHaveLength(1);
    });

    it("reports manual clear rejection without disabling or replacing persisted entries", async () => {
        const backend = storage({ entries: [event(1)] });
        backend.remove = vi.fn().mockRejectedValue(new Error("cannot remove journal"));
        const journal = new DiagnosticJournal(backend);
        await journal.setEnabled(true);
        await expect(journal.clearEntries()).resolves.toEqual({ ok: false, error: "storage-failed" });
        expect(journal.enabled).toBe(true);
        expect(backend.value).toEqual({ entries: [event(1)] });
    });

    it("invalidates pre-clear writes while retaining a genuinely newer post-clear event", async () => {
        const backend = storage();
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        const originalGet = backend.get.bind(backend);
        let first = true;
        backend.get = vi.fn(async (keys?: string | readonly string[] | Record<string, unknown>) => {
            if (first) {
                first = false; await gate;
            }
            return originalGet(keys);
        });
        const journal = new DiagnosticJournal(backend);
        await journal.setEnabled(true);
        const stale = journal.append(event(1));
        await Promise.resolve();
        const clearing = journal.clearEntries();
        const newer = journal.append(event(2));
        release();
        await expect(clearing).resolves.toEqual({ ok: true });
        await Promise.all([stale, newer]);
        await expect(journal.readSnapshot()).resolves.toEqual({ ok: true, entries: [event(2)] });
    });

    it("cannot resurrect diagnostics when manual clear races with disabling or reset clear", async () => {
        for (const reset of [false, true]) {
            const backend = storage();
            const journal = new DiagnosticJournal(backend);
            await journal.setEnabled(true);
            await journal.append(event(1));
            const clearing = journal.clearEntries();
            const stopped = reset ? journal.clear() : journal.setEnabled(false);
            const stale = journal.append(event(2));
            await Promise.all([clearing, stopped, stale]);
            expect(journal.enabled).toBe(false);
            expect(backend.value).toBeUndefined();
        }
    });
});
