/**
 * @file Loads and serializes typed extension settings with failure-safe persistence.
 */

import {
    DEFAULT_SETTINGS_SNAPSHOT,
    SETTINGS_PREVIOUS_STORAGE_KEY,
    SETTINGS_STORAGE_KEY,
    createSettingsSnapshot,
    isCurrentSettingsSnapshot,
    parseDisplaySettings,
    sameDisplaySettings,
    type Appearance,
    type DisplaySettings,
    type SettingsLoadResult,
    type SettingsSnapshot,
    type SettingsSnapshotInput,
} from "../../shared/settings/snapshot";
import { isCanonicalHostname } from "../../shared/settings/hostname";
import {
    isSiteListFull,
    isSiteProcessingEnabled,
    withSiteProcessing,
    type SiteScopeMode,
} from "../../shared/settings/site-scope";
import { validateCustomFormatPattern } from "../../shared/settings/custom-format";

/**
 * Durable storage operations needed to read, atomically replace, and recover settings snapshots.
 */
export interface SettingsStorage {
    /**
     * Fetches active and recovery snapshots from durable browser storage.
     */
    get(
        keys?: string | readonly string[] | Record<string, unknown>,
    ): Promise<Readonly<Record<string, unknown>>>;

    /**
     * Persists a complete record of key-value updates.
     */
    set(items: Readonly<Record<string, SettingsSnapshot>>): Promise<void>;
}

/**
 * Successful persisted mutation, including the revision that callers may safely project.
 */
export interface SettingsWriteSuccess {
    /**
     * Indicates that the requested mutation completed successfully.
     */
    readonly ok: true;

    /**
     * Whether the persisted settings differ from the previous snapshot.
     */
    readonly changed: boolean;

    /**
     * Authoritative settings snapshot after the mutation.
     */
    readonly snapshot: SettingsSnapshot;
}

/**
 * Rejected or unpersisted mutation and the snapshot that remains authoritative.
 */
export interface SettingsWriteFailure {
    /**
     * Indicates that the requested mutation was rejected or could not be persisted.
     */
    readonly ok: false;

    /**
     * Stable reason the settings mutation failed.
     */
    readonly error:
          | "persistence-failed"
          | "invalid-hostname"
          | "list-full"
          | "invalid-time-zone"
          | "invalid-format"
          | "invalid-display-settings";

    /**
     * Last authoritative settings snapshot retained after the failure.
     */
    readonly snapshot: SettingsSnapshot;
}

/**
 * Persisted mutation outcome.
 */
export type SettingsWriteResult = SettingsWriteSuccess | SettingsWriteFailure;

/**
 * Injected capability check that separates structural zone validation from runtime Intl support.
 */
export type TimeZoneAvailability = (identifier: string) => boolean;

/**
 * Uses Intl to determine whether an IANA time-zone identifier is available.
 *
 * @param identifier - Structurally valid IANA time-zone identifier.
 * @returns - Whether the current runtime can resolve the identifier.
 */
function defaultTimeZoneAvailability(identifier: string): boolean {
    try {
        new Intl.DateTimeFormat(undefined, { timeZone: identifier }).resolvedOptions();
        return true;
    } catch {
        return false;
    }
}

/**
 * Builds the successor of a snapshot, carrying every field forward except the patch.
 *
 * @param current - Snapshot being replaced.
 * @param patch - Fields that change in the successor.
 * @returns - Frozen successor with the next revision.
 */
function next(
    current: SettingsSnapshot,
    patch: Partial<Omit<SettingsSnapshotInput, "revision">>,
): SettingsSnapshot {
    return createSettingsSnapshot({ ...current, ...patch, revision: current.revision + 1 });
}

/**
 * Serializes settings reads and writes, preserving a recoverable previous snapshot across failures.
 */
export class SettingsService {
    /**
     * Last loaded snapshot, used to project settings while storage remains available.
     */
    private current: SettingsSnapshot | undefined;

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
     *
     * @param storage - Durable storage boundary for settings snapshots.
     * @param key - Storage key for the current snapshot.
     * @param isTimeZoneAvailable - Runtime capability check for named zones.
     */
    public constructor(
        private readonly storage: SettingsStorage,
        private readonly key = SETTINGS_STORAGE_KEY,
        private readonly isTimeZoneAvailable: TimeZoneAvailability = defaultTimeZoneAvailability,
    ) {}

    /**
     * Loads the current or recovery snapshot and records the unavailable reason on failure.
     *
     * @returns - Loaded settings snapshot or a contained load failure.
     */
    public async load(): Promise<SettingsLoadResult> {
        let values: Readonly<Record<string, unknown>>;
        try {
            values = await this.storage.get([this.key, SETTINGS_PREVIOUS_STORAGE_KEY]);
        } catch {
            this.loadError = "load-failed";
            return { ok: false, error: "load-failed" };
        }

        const stored = values[this.key];
        const storedPreviousValue = values[SETTINGS_PREVIOUS_STORAGE_KEY];
        const current = isCurrentSettingsSnapshot(stored) ? stored : undefined;
        const storedPrevious = isCurrentSettingsSnapshot(storedPreviousValue)
            ? storedPreviousValue
            : undefined;
        if (current !== undefined) {
            this.loadError = undefined;
            this.current = current;
            return { ok: true, snapshot: current, source: "stored" };
        }

        if (storedPrevious === undefined) {
            if (stored === undefined && storedPreviousValue === undefined) {
                this.loadError = undefined;
                this.current = DEFAULT_SETTINGS_SNAPSHOT;
                return { ok: true, snapshot: this.current, source: "default" };
            }
            // A document of another schema version is discarded, not migrated.
            // The defaults are persisted so the stale document stops being
            // re-read on every worker start and recovery can trust storage.
            try {
                await this.storage.set(
                    this.pair(DEFAULT_SETTINGS_SNAPSHOT, DEFAULT_SETTINGS_SNAPSHOT),
                );
            } catch {
                this.loadError = "invalid-settings";
                return { ok: false, error: "invalid-settings" };
            }
            console.warn("Discarded stored settings of another schema version");
            this.loadError = undefined;
            this.current = DEFAULT_SETTINGS_SNAPSHOT;
            return { ok: true, snapshot: this.current, source: "discarded" };
        }

        try {
            await this.storage.set(this.pair(storedPrevious, storedPrevious));
        } catch {
            this.loadError = "invalid-settings";
            return { ok: false, error: "invalid-settings" };
        }
        this.loadError = undefined;
        this.current = storedPrevious;
        return { ok: true, snapshot: storedPrevious, source: "recovered" };
    }

    /**
     * Returns the most recently loaded snapshot, if initialization succeeded.
     *
     * @returns - Most recently loaded valid snapshot, if available.
     */
    public get loadedSnapshot(): SettingsSnapshot | undefined {
        return this.current;
    }

    /**
     * Exposes the last initialization failure for unavailable-state reporting.
     *
     * @returns - Most recent settings initialization failure, if any.
     */
    public get lastLoadError(): "load-failed" | "invalid-settings" | undefined {
        return this.loadError;
    }

    /**
     * Creates the known-good default snapshot used after an unrecoverable read.
     *
     * @returns - Current snapshot or immutable default snapshot.
     */
    private fallbackSnapshot(): SettingsSnapshot {
        return this.current ?? DEFAULT_SETTINGS_SNAPSHOT;
    }

    /**
     * Writes current and previous snapshots as one recoverable storage pair.
     *
     * @param current - Snapshot to store as the active value.
     * @param previous - Known-good recovery snapshot.
     * @returns - Atomic storage payload containing both snapshots.
     */
    private pair(
        current: SettingsSnapshot,
        previous: SettingsSnapshot,
    ): Readonly<Record<string, SettingsSnapshot>> {
        return { [this.key]: current, [SETTINGS_PREVIOUS_STORAGE_KEY]: previous };
    }

    /**
     * Applies a serialized mutation and persists its incremented snapshot revision.
     *
     * @param mutator - Pure snapshot transformation, or null for an invalid request.
     * @returns - Persisted write result with the effective snapshot.
     */
    private async mutate(
        mutator: (current: SettingsSnapshot) => SettingsSnapshot | null,
    ): Promise<SettingsWriteResult> {
        let result: SettingsWriteResult | undefined;
        const run = this.mutationTail.then(async () => {
            const loaded = await this.load();
            if (!loaded.ok) {
                result = {
                    ok: false,
                    error: "persistence-failed",
                    snapshot: this.fallbackSnapshot(),
                };
                return;
            }
            const candidate = mutator(loaded.snapshot);
            if (candidate === null) {
                result = { ok: true, changed: false, snapshot: loaded.snapshot };
                return;
            }
            try {
                await this.storage.set(this.pair(candidate, loaded.snapshot));
            } catch {
                result = { ok: false, error: "persistence-failed", snapshot: loaded.snapshot };
                return;
            }
            this.current = candidate;
            result = { ok: true, changed: true, snapshot: candidate };
        });
        this.mutationTail = run.then(
            () => undefined,
            () => undefined,
        );
        try {
            await run;
        } catch {
            result = { ok: false, error: "persistence-failed", snapshot: this.fallbackSnapshot() };
        }
        return (
            result ?? { ok: false, error: "persistence-failed", snapshot: this.fallbackSnapshot() }
        );
    }

    /**
     * Persists the global activation flag and returns the resulting revision or failure projection.
     *
     * @param enabled - Requested global activation state.
     * @returns - Persisted write result with the effective snapshot.
     */
    public async setGlobalEnabled(enabled: boolean): Promise<SettingsWriteResult> {
        return this.mutate((current) =>
            current.globalEnabled === enabled ? null : next(current, { globalEnabled: enabled }),
        );
    }

    /**
     * Applies one hostname decision to the list the active scope mode owns.
     *
     * @param hostname - Canonical hostname whose processing state changes.
     * @param enabled - Whether processing should apply to the hostname.
     * @returns - Persisted write result with the effective snapshot.
     */
    public async setSiteEnabled(hostname: string, enabled: boolean): Promise<SettingsWriteResult> {
        if (!isCanonicalHostname(hostname)) {
            return { ok: false, error: "invalid-hostname", snapshot: this.fallbackSnapshot() };
        }
        const bound = { full: false };
        const result = await this.mutate((current) => {
            if (isSiteProcessingEnabled(current.siteScope, hostname) === enabled) {
                return null;
            }
            if (isSiteListFull(current.siteScope, hostname)) {
                bound.full = true;
                return null;
            }
            return next(current, {
                siteScope: withSiteProcessing(current.siteScope, hostname, enabled),
            });
        });
        return bound.full
            ? { ok: false, error: "list-full", snapshot: result.snapshot }
            : result;
    }

    /**
     * Persists the active scope mode without changing either hostname list.
     *
     * @param mode - Requested scope mode.
     * @returns - Persisted write result with the effective snapshot.
     */
    public async setSiteScopeMode(mode: SiteScopeMode): Promise<SettingsWriteResult> {
        return this.mutate((current) =>
            current.siteScope.mode === mode
                ? null
                : next(current, { siteScope: { ...current.siteScope, mode } }),
        );
    }

    /**
     * Persists the appearance applied to both extension surfaces.
     *
     * @param appearance - Requested appearance.
     * @returns - Persisted write result with the effective snapshot.
     */
    public async setAppearance(appearance: Appearance): Promise<SettingsWriteResult> {
        return this.mutate((current) =>
            current.appearance === appearance ? null : next(current, { appearance }),
        );
    }

    /**
     * Persists validated presentation choices.
     *
     * @param display - Typed display settings to validate and persist.
     * @returns - Persisted write result with the effective snapshot.
     */
    public async setDisplaySettings(display: DisplaySettings): Promise<SettingsWriteResult> {
        const parsed = parseDisplaySettings(display);
        if (parsed === null) {
            if (
                display.formatMode === "custom"
                && !validateCustomFormatPattern(display.pattern).ok
            ) {
                return { ok: false, error: "invalid-format", snapshot: this.fallbackSnapshot() };
            }
            return {
                ok: false,
                error: "invalid-display-settings",
                snapshot: this.fallbackSnapshot(),
            };
        }
        if (
            parsed.timeZone.mode === "iana" &&
            !this.isTimeZoneAvailable(parsed.timeZone.identifier)
        ) {
            return { ok: false, error: "invalid-time-zone", snapshot: this.fallbackSnapshot() };
        }
        return this.mutate((current) =>
            sameDisplaySettings(current.display, parsed)
                ? null
                : next(current, { display: parsed }),
        );
    }

    /**
     * Persists diagnostic journaling policy before background tabs are refreshed.
     *
     * @param enabled - Requested diagnostic journaling state.
     * @returns - Persisted write result with the effective snapshot.
     */
    public async setDebugEnabled(enabled: boolean): Promise<SettingsWriteResult> {
        return this.mutate((current) =>
            current.debugEnabled === enabled ? null : next(current, { debugEnabled: enabled }),
        );
    }

    /**
     * Replace an unrecoverable pair with a known-good default pair.
     *
     * @returns - Persisted reset result with the default snapshot.
     */
    public async resetAll(): Promise<SettingsWriteResult> {
        let result: SettingsWriteResult | undefined;
        const run = this.mutationTail.then(async () => {
            const loaded = await this.load();
            const previous = loaded.ok
                ? loaded.snapshot
                : this.current ?? DEFAULT_SETTINGS_SNAPSHOT;
            const defaults = createSettingsSnapshot({
                revision: previous.revision + 1,
                globalEnabled: DEFAULT_SETTINGS_SNAPSHOT.globalEnabled,
            });
            try {
                await this.storage.set(this.pair(defaults, defaults));
            } catch {
                result = {
                    ok: false,
                    error: "persistence-failed",
                    snapshot: this.fallbackSnapshot(),
                };
                return;
            }
            this.current = defaults;
            this.loadError = undefined;
            result = { ok: true, changed: true, snapshot: defaults };
        });
        this.mutationTail = run.then(
            () => undefined,
            () => undefined,
        );
        try {
            await run;
        } catch {
            result = { ok: false, error: "persistence-failed", snapshot: this.fallbackSnapshot() };
        }
        return (
            result ?? { ok: false, error: "persistence-failed", snapshot: this.fallbackSnapshot() }
        );
    }

    /**
     * Reloads the newest stored snapshot after an ambiguous write response.
     *
     * @returns - Latest valid snapshot or a contained load failure.
     */
    public async readLatest(): Promise<SettingsLoadResult> {
        return this.load();
    }
}
