/**
 * @file Loads, migrates, and serializes extension settings with failure-safe persistence.
 */

import {
    DEFAULT_SETTINGS_SNAPSHOT,
    SETTINGS_PREVIOUS_STORAGE_KEY,
    SETTINGS_SCHEMA_VERSION,
    SETTINGS_STORAGE_KEY,
    createSettingsSnapshot,
    isCanonicalHostname,
    parseDisplaySettings,
    parseSettingsSnapshot,
    type DisplaySettings,
    type SettingsLoadResult,
    type SettingsSnapshotV5
} from "./snapshot";
import { validateCustomFormatPattern } from "./custom-format";

/**
 * Durable storage operations needed to read, atomically replace, and recover settings snapshots.
 */
export interface SettingsStorage {
    /**
     * Fetches active and recovery snapshots from durable browser storage.
     */
    get(keys?: string | readonly string[] | Record<string, unknown>): Promise<Record<string, unknown>>;

    /**
     * Persists a complete record of key-value updates.
     */
    set(items: Record<string, unknown>): Promise<void>;
}

/**
 * Persisted mutation outcome, including the revision that callers may safely project.
 */
export type SettingsWriteResult =
  | { readonly ok: true; readonly changed: boolean; readonly snapshot: SettingsSnapshotV5 }
  | { readonly ok: false; readonly error: "persistence-failed" | "invalid-hostname" | "invalid-time-zone" | "invalid-format" | "invalid-display-settings" | "invalid-debug"; readonly snapshot: SettingsSnapshotV5 };

/**
 * Injected capability check that separates structural zone validation from runtime Intl support.
 */
export type TimeZoneAvailability = (identifier: string) => boolean;

/**
 * Uses Intl to determine whether an IANA time-zone identifier is available.
 */
function defaultTimeZoneAvailability(identifier: string): boolean {
    try {
        new Intl.DateTimeFormat(undefined, { timeZone: identifier }).resolvedOptions(); return true;
    } catch {
        return false;
    }
}

/**
 * Compares display choices without relying on object identity.
 */
function sameDisplay(a: DisplaySettings, b: DisplaySettings): boolean {
    if (a.formatMode !== b.formatMode) {
        return false;
    }
    if (a.formatMode === "custom" && b.formatMode === "custom" && a.pattern !== b.pattern) {
        return false;
    }
    if (a.timeZone.mode !== b.timeZone.mode) {
        return false;
    }
    return a.timeZone.mode !== "iana" || b.timeZone.mode !== "iana" || a.timeZone.identifier === b.timeZone.identifier;
}

/**
 * Serializes settings reads and writes, preserving a recoverable previous snapshot across failures.
 *
 */
export class SettingsService {
    /**
     * Last validated snapshot, used to project settings while storage remains available.
     */
    private current: SettingsSnapshotV5 | undefined;

    /**
     * Most recent load failure retained so clients can present the unavailable state accurately.
     */
    private loadError: "load-failed" | "invalid-settings" | undefined;

    /**
     * Promise tail that makes settings mutations durable in revision order.
     */
    private mutationTail: Promise<void> = Promise.resolve();

    /**
     * Initializes the storage boundary, active key, and injectable time-zone capability check.
     */
    public constructor(
        private readonly storage: SettingsStorage,
        private readonly key = SETTINGS_STORAGE_KEY,
        private readonly isTimeZoneAvailable: TimeZoneAvailability = defaultTimeZoneAvailability
    ) {}

    /**
     * Loads a valid current or recovery snapshot and records the unavailable reason on failure.
     */
    public async load(): Promise<SettingsLoadResult> {
        let values: Record<string, unknown>;
        try {
            values = await this.storage.get([this.key, SETTINGS_PREVIOUS_STORAGE_KEY]);
        } catch {
            this.loadError = "load-failed";
            return { ok: false, error: "load-failed" };
        }

        const hasCurrent = Object.hasOwn(values, this.key);
        const hasPrevious = Object.hasOwn(values, SETTINGS_PREVIOUS_STORAGE_KEY);
        if (!hasCurrent && !hasPrevious) {
            this.loadError = undefined;
            this.current = DEFAULT_SETTINGS_SNAPSHOT;
            return { ok: true, snapshot: this.current, source: "default" };
        }

        const snapshot = hasCurrent ? parseSettingsSnapshot(values[this.key]) : null;
        if (snapshot) {
            this.loadError = undefined;
            this.current = snapshot;
            return { ok: true, snapshot, source: "stored" };
        }

        // A newer schema must never be replaced by an older backup. It may contain
        // fields this unpublished build does not understand, so fail closed.
        const rawCurrent = hasCurrent ? values[this.key] : undefined;
        if (isUnknownFutureSnapshot(rawCurrent)) {
            this.loadError = "invalid-settings";
            return { ok: false, error: "invalid-settings" };
        }

        const previous = hasPrevious ? parseSettingsSnapshot(values[SETTINGS_PREVIOUS_STORAGE_KEY]) : null;
        if (!previous) {
            this.loadError = "invalid-settings";
            return { ok: false, error: "invalid-settings" };
        }

        try {
            await this.storage.set(this.pair(previous, previous));
        } catch {
            this.loadError = "invalid-settings";
            return { ok: false, error: "invalid-settings" };
        }
        this.loadError = undefined;
        this.current = previous;
        return { ok: true, snapshot: previous, source: "recovered" };
    }

    /**
     * Returns the most recently loaded snapshot, if initialization succeeded.
     */
    public get loadedSnapshot(): SettingsSnapshotV5 | undefined {
        return this.current;
    }

    /**
     * Exposes the last initialization failure for unavailable-state reporting.
     */
    public get lastLoadError(): "load-failed" | "invalid-settings" | undefined {
        return this.loadError;
    }

    /**
     * Creates the known-good default snapshot used after an unrecoverable read.
     */
    private fallbackSnapshot(): SettingsSnapshotV5 {
        return this.current ?? DEFAULT_SETTINGS_SNAPSHOT;
    }

    /**
     * Writes current and previous snapshots as one recoverable storage pair.
     */
    private pair(current: SettingsSnapshotV5, previous: SettingsSnapshotV5): Record<string, unknown> {
        return { [this.key]: current, [SETTINGS_PREVIOUS_STORAGE_KEY]: previous };
    }

    /**
     * Applies a serialized mutation and persists its incremented snapshot revision.
     */
    private async mutate(mutator: (current: SettingsSnapshotV5) => SettingsSnapshotV5 | null): Promise<SettingsWriteResult> {
        let result: SettingsWriteResult | undefined;
        const run = this.mutationTail.then(async () => {
            const loaded = await this.load();
            if (!loaded.ok) {
                result = { ok: false, error: "persistence-failed", snapshot: this.fallbackSnapshot() }; return;
            }
            const candidate = mutator(loaded.snapshot);
            if (candidate === null) {
                result = { ok: true, changed: false, snapshot: loaded.snapshot }; return;
            }
            const parsedCandidate = parseSettingsSnapshot(candidate);
            if (parsedCandidate === null) {
                result = { ok: false, error: "invalid-display-settings", snapshot: loaded.snapshot };
                return;
            }
            try {
                await this.storage.set(this.pair(parsedCandidate, loaded.snapshot));
            } catch {
                result = { ok: false, error: "persistence-failed", snapshot: loaded.snapshot }; return;
            }
            this.current = parsedCandidate; result = { ok: true, changed: true, snapshot: parsedCandidate };
        });
        this.mutationTail = run.then(() => undefined, () => undefined);
        try {
            await run;
        } catch {
            result = { ok: false, error: "persistence-failed", snapshot: this.fallbackSnapshot() };
        }
        return result ?? { ok: false, error: "persistence-failed", snapshot: this.fallbackSnapshot() };
    }

    /**
     * Persists the global activation flag and returns the resulting revision or failure projection.
     */
    public async setGlobalEnabled(enabled: boolean): Promise<SettingsWriteResult> {
        if (typeof enabled !== "boolean") {
            return { ok: false, error: "persistence-failed", snapshot: this.fallbackSnapshot() };
        }
        return this.mutate((current) => current.globalEnabled === enabled ? null : createSettingsSnapshot(current.revision + 1, enabled, current.sitePreferences, current.display, current.debugEnabled));
    }

    /**
     * Persists one canonical-host override without changing other site preferences.
     */
    public async setSiteEnabled(hostname: string, enabled: boolean): Promise<SettingsWriteResult> {
        if (!isCanonicalHostname(hostname) || typeof enabled !== "boolean") {
            return { ok: false, error: "invalid-hostname", snapshot: this.fallbackSnapshot() };
        }
        return this.mutate((current) => {
            if (Object.hasOwn(current.sitePreferences, hostname) && current.sitePreferences[hostname] === enabled) {
                return null;
            }
            const entries = Object.entries(current.sitePreferences);
            const index = entries.findIndex(([key]) => key === hostname);
            if (index >= 0) {
                entries[index] = [hostname, enabled];
            } else {
                entries.push([hostname, enabled]);
            }
            return createSettingsSnapshot(current.revision + 1, current.globalEnabled, Object.fromEntries(entries), current.display, current.debugEnabled);
        });
    }

    /**
     * Persists validated presentation choices and refreshes the derived display projection.
     */
    public async setDisplaySettings(display: unknown): Promise<SettingsWriteResult> {
        if (typeof display === "object" && display !== null && Object.hasOwn(display, "formatMode") && (display as { formatMode?: unknown }).formatMode === "custom") {
            const pattern = (display as { pattern?: unknown }).pattern;
            if (!validateCustomFormatPattern(pattern).ok) {
                return { ok: false, error: "invalid-format", snapshot: this.fallbackSnapshot() };
            }
        }
        const parsed = parseDisplaySettings(display);
        if (parsed === null) {
            return { ok: false, error: "invalid-display-settings", snapshot: this.fallbackSnapshot() };
        }
        if (parsed.timeZone.mode === "iana" && !this.isTimeZoneAvailable(parsed.timeZone.identifier)) {
            return { ok: false, error: "invalid-time-zone", snapshot: this.fallbackSnapshot() };
        }
        return this.mutate((current) => sameDisplay(current.display, parsed) ? null : createSettingsSnapshot(current.revision + 1, current.globalEnabled, current.sitePreferences, parsed, current.debugEnabled));
    }

    /**
     * Persists diagnostic journaling policy before background tabs are refreshed.
     */
    public async setDebugEnabled(enabled: boolean): Promise<SettingsWriteResult> {
        if (typeof enabled !== "boolean") {
            return { ok: false, error: "invalid-debug", snapshot: this.fallbackSnapshot() };
        }
        return this.mutate((current) => current.debugEnabled === enabled
            ? null
            : createSettingsSnapshot(current.revision + 1, current.globalEnabled, current.sitePreferences, current.display, enabled));
    }

    /**
     * Replace an unrecoverable pair with a known-good default pair.
     */
    public async resetAll(): Promise<SettingsWriteResult> {
        let result: SettingsWriteResult | undefined;
        const run = this.mutationTail.then(async () => {
            const defaults = DEFAULT_SETTINGS_SNAPSHOT;
            try {
                await this.storage.set(this.pair(defaults, defaults));
            } catch {
                result = { ok: false, error: "persistence-failed", snapshot: this.fallbackSnapshot() };
                return;
            }
            this.current = defaults;
            this.loadError = undefined;
            result = { ok: true, changed: true, snapshot: defaults };
        });
        this.mutationTail = run.then(() => undefined, () => undefined);
        try {
            await run;
        } catch {
            result = { ok: false, error: "persistence-failed", snapshot: this.fallbackSnapshot() };
        }
        return result ?? { ok: false, error: "persistence-failed", snapshot: this.fallbackSnapshot() };
    }

    /**
     * Reloads the newest valid stored snapshot after an ambiguous write response.
     */
    public async readLatest(): Promise<SettingsLoadResult> {
        return this.load();
    }
}

/**
 * Detects a newer schema marker so it is never overwritten by an older extension build.
 */
function isUnknownFutureSnapshot(value: unknown): boolean {
    return typeof value === "object"
    && value !== null
    && !Array.isArray(value)
    && Object.hasOwn(value, "schemaVersion")
    && typeof (value as { schemaVersion?: unknown }).schemaVersion === "number"
    && (value as { schemaVersion: number }).schemaVersion > SETTINGS_SCHEMA_VERSION;
}
