/**
 * @file Loads and serializes typed extension settings with failure-safe persistence.
 */

import {
    DEFAULT_SETTINGS_SNAPSHOT,
    FORMAT_MODE,
    SETTINGS_LOAD_ERROR,
    SETTINGS_LOAD_SOURCE,
    SETTINGS_PREVIOUS_STORAGE_KEY,
    SETTINGS_STORAGE_KEY,
    TIME_ZONE_MODE,
    createSettingsSnapshot,
    isCurrentSettingsSnapshot,
    parseDisplaySettings,
    sameDisplaySettings,
    type Appearance,
    type DisplaySettings,
    type SettingsLoadError,
    type SettingsLoadResult,
    type SettingsSnapshot,
    type SettingsSnapshotInput,
} from "../../shared/settings/snapshot";
import {
    DISPLAY_SETTINGS_ERROR,
    SITE_SETTINGS_ERROR,
} from "../../shared/messaging/view-state-values";
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
 * Named reasons a settings mutation is rejected or cannot be persisted.
 */
export const SETTINGS_WRITE_ERROR = {
    PERSISTENCE_FAILED: "persistence-failed",
    INVALID_HOSTNAME: SITE_SETTINGS_ERROR.INVALID_HOSTNAME,
    LIST_FULL: SITE_SETTINGS_ERROR.LIST_FULL,
    SCOPE_CHANGED: SITE_SETTINGS_ERROR.SCOPE_CHANGED,
    INVALID_TIME_ZONE: DISPLAY_SETTINGS_ERROR.INVALID_TIME_ZONE,
    INVALID_FORMAT: DISPLAY_SETTINGS_ERROR.INVALID_FORMAT,
    INVALID_DISPLAY_SETTINGS: DISPLAY_SETTINGS_ERROR.INVALID_DISPLAY_SETTINGS,
} as const;

/**
 * Reason a settings mutation failed.
 */
export type SettingsWriteError = (typeof SETTINGS_WRITE_ERROR)[keyof typeof SETTINGS_WRITE_ERROR];

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
    readonly error: SettingsWriteError;

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
 * Settings load as the lifecycle uses it.
 */
export interface SettingsLoader {
    /**
     * Loads the current or recovery snapshot, or reports why neither is usable.
     *
     * @returns - Loaded settings snapshot or a contained load failure.
     */
    load(): Promise<SettingsLoadResult>;
}

/**
 * Settings persistence as the command handler uses it: serialized writes and
 * the last load failure for unavailable-state reporting.
 */
export interface SettingsPersistence extends SettingsLoader {
    /**
     * Last initialization failure, when settings are unavailable.
     */
    readonly lastLoadError: SettingsLoadError | undefined;

    /**
     * Persists the global activation flag.
     *
     * @param enabled - Requested global activation state.
     * @returns - Persisted write result with the effective snapshot.
     */
    setGlobalEnabled(enabled: boolean): Promise<SettingsWriteResult>;

    /**
     * Applies one hostname decision to the list of the given scope mode.
     *
     * @param hostname - Canonical hostname whose processing state changes.
     * @param enabled - Whether processing should apply to the hostname.
     * @param mode - Scope mode the caller rendered when it made the decision.
     * @returns - Persisted write result with the effective snapshot.
     */
    setSiteEnabled(
        hostname: string,
        enabled: boolean,
        mode: SiteScopeMode,
    ): Promise<SettingsWriteResult>;

    /**
     * Persists the active scope mode.
     *
     * @param mode - Requested scope mode.
     * @returns - Persisted write result with the effective snapshot.
     */
    setSiteScopeMode(mode: SiteScopeMode): Promise<SettingsWriteResult>;

    /**
     * Persists the appearance applied to both extension surfaces.
     *
     * @param appearance - Requested appearance.
     * @returns - Persisted write result with the effective snapshot.
     */
    setAppearance(appearance: Appearance): Promise<SettingsWriteResult>;

    /**
     * Validates and persists presentation choices.
     *
     * @param display - Typed display settings to validate and persist.
     * @returns - Persisted write result with the effective snapshot.
     */
    setDisplaySettings(display: DisplaySettings): Promise<SettingsWriteResult>;

    /**
     * Persists diagnostic journaling policy.
     *
     * @param enabled - Requested diagnostic journaling state.
     * @returns - Persisted write result with the effective snapshot.
     */
    setDebugEnabled(enabled: boolean): Promise<SettingsWriteResult>;

    /**
     * Replaces the stored pair with a known-good default pair.
     *
     * @returns - Persisted reset result with the default snapshot.
     */
    resetAll(): Promise<SettingsWriteResult>;
}

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
 * Named outcomes of one pure snapshot transformation.
 */
const MUTATION_OUTCOME = {
    CHANGED: "changed",
    UNCHANGED: "unchanged",
    REJECTED: "rejected",
} as const;

/**
 * Result of transforming the loaded snapshot: a successor to persist, nothing
 * to persist, or a domain rejection that leaves the snapshot untouched.
 */
type MutationOutcome =
    | {
        /**
         * The transformation produced a successor snapshot.
         */
        readonly kind: typeof MUTATION_OUTCOME.CHANGED;

        /**
         * Successor snapshot to persist.
         */
        readonly snapshot: SettingsSnapshot;
    }
    | {
        /**
         * The request is already satisfied by the loaded snapshot.
         */
        readonly kind: typeof MUTATION_OUTCOME.UNCHANGED;
    }
    | {
        /**
         * The request was rejected by a domain rule.
         */
        readonly kind: typeof MUTATION_OUTCOME.REJECTED;

        /**
         * Reason the request was rejected.
         */
        readonly error: SettingsWriteError;
    };

/**
 * Pure snapshot transformation applied under the mutation lock.
 */
type SnapshotMutator = (current: SettingsSnapshot) => MutationOutcome;

const UNCHANGED: MutationOutcome = { kind: MUTATION_OUTCOME.UNCHANGED };

/**
 * Wraps a successor snapshot as a changed outcome.
 *
 * @param snapshot - Successor snapshot to persist.
 * @returns - Changed outcome.
 */
function changed(snapshot: SettingsSnapshot): MutationOutcome {
    return { kind: MUTATION_OUTCOME.CHANGED, snapshot };
}

/**
 * Wraps a domain rejection as a mutation outcome.
 *
 * @param error - Reason the request was rejected.
 * @returns - Rejected outcome.
 */
function rejected(error: SettingsWriteError): MutationOutcome {
    return { kind: MUTATION_OUTCOME.REJECTED, error };
}

/**
 * Serializes settings reads and writes, preserving a recoverable previous snapshot across failures.
 */
export class SettingsService implements SettingsPersistence {
    /**
     * Last loaded snapshot, used to project settings while storage remains available.
     */
    private current: SettingsSnapshot | undefined;

    /**
     * Most recent load failure retained so clients can present the unavailable state accurately.
     */
    private loadError: SettingsLoadError | undefined;

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
            this.loadError = SETTINGS_LOAD_ERROR.LOAD_FAILED;
            return { ok: false, error: SETTINGS_LOAD_ERROR.LOAD_FAILED };
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
            return { ok: true, snapshot: current, source: SETTINGS_LOAD_SOURCE.STORED };
        }

        if (storedPrevious === undefined) {
            if (stored === undefined && storedPreviousValue === undefined) {
                this.loadError = undefined;
                this.current = DEFAULT_SETTINGS_SNAPSHOT;
                return { ok: true, snapshot: this.current, source: SETTINGS_LOAD_SOURCE.DEFAULT };
            }
            // A document of another schema version is discarded, not migrated.
            // The defaults are persisted so the stale document stops being
            // re-read on every worker start and recovery can trust storage.
            try {
                await this.storage.set(
                    this.pair(DEFAULT_SETTINGS_SNAPSHOT, DEFAULT_SETTINGS_SNAPSHOT),
                );
            } catch {
                this.loadError = SETTINGS_LOAD_ERROR.INVALID_SETTINGS;
                return { ok: false, error: SETTINGS_LOAD_ERROR.INVALID_SETTINGS };
            }
            console.warn("Discarded stored settings of another schema version");
            this.loadError = undefined;
            this.current = DEFAULT_SETTINGS_SNAPSHOT;
            return { ok: true, snapshot: this.current, source: SETTINGS_LOAD_SOURCE.DISCARDED };
        }

        try {
            await this.storage.set(this.pair(storedPrevious, storedPrevious));
        } catch {
            this.loadError = SETTINGS_LOAD_ERROR.INVALID_SETTINGS;
            return { ok: false, error: SETTINGS_LOAD_ERROR.INVALID_SETTINGS };
        }
        this.loadError = undefined;
        this.current = storedPrevious;
        return { ok: true, snapshot: storedPrevious, source: SETTINGS_LOAD_SOURCE.RECOVERED };
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
    public get lastLoadError(): SettingsLoadError | undefined {
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
     * @param mutator - Pure snapshot transformation applied to the loaded snapshot.
     * @returns - Persisted write result with the effective snapshot.
     */
    private async mutate(mutator: SnapshotMutator): Promise<SettingsWriteResult> {
        let result: SettingsWriteResult | undefined;
        const run = this.mutationTail.then(async () => {
            const loaded = await this.load();
            if (!loaded.ok) {
                result = {
                    ok: false,
                    error: SETTINGS_WRITE_ERROR.PERSISTENCE_FAILED,
                    snapshot: this.fallbackSnapshot(),
                };
                return;
            }
            const outcome = mutator(loaded.snapshot);
            if (outcome.kind === MUTATION_OUTCOME.UNCHANGED) {
                result = { ok: true, changed: false, snapshot: loaded.snapshot };
                return;
            }
            if (outcome.kind === MUTATION_OUTCOME.REJECTED) {
                result = { ok: false, error: outcome.error, snapshot: loaded.snapshot };
                return;
            }
            const candidate = outcome.snapshot;
            try {
                await this.storage.set(this.pair(candidate, loaded.snapshot));
            } catch {
                result = {
                    ok: false,
                    error: SETTINGS_WRITE_ERROR.PERSISTENCE_FAILED,
                    snapshot: loaded.snapshot,
                };
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
            result = {
                ok: false,
                error: SETTINGS_WRITE_ERROR.PERSISTENCE_FAILED,
                snapshot: this.fallbackSnapshot(),
            };
        }
        return (
            result ?? {
                ok: false,
                error: SETTINGS_WRITE_ERROR.PERSISTENCE_FAILED,
                snapshot: this.fallbackSnapshot(),
            }
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
            current.globalEnabled === enabled
                ? UNCHANGED
                : changed(next(current, { globalEnabled: enabled })),
        );
    }

    /**
     * Applies one hostname decision to the list of the scope mode the caller
     * was looking at. The decision is rejected when another surface changed
     * the mode first, because the same flag would then edit the other list.
     *
     * @param hostname - Canonical hostname whose processing state changes.
     * @param enabled - Whether processing should apply to the hostname.
     * @param mode - Scope mode the caller rendered when it made the decision.
     * @returns - Persisted write result with the effective snapshot.
     */
    public async setSiteEnabled(
        hostname: string,
        enabled: boolean,
        mode: SiteScopeMode,
    ): Promise<SettingsWriteResult> {
        if (!isCanonicalHostname(hostname)) {
            return {
                ok: false,
                error: SETTINGS_WRITE_ERROR.INVALID_HOSTNAME,
                snapshot: this.fallbackSnapshot(),
            };
        }
        return this.mutate((current) => {
            if (current.siteScope.mode !== mode) {
                return rejected(SETTINGS_WRITE_ERROR.SCOPE_CHANGED);
            }
            if (isSiteProcessingEnabled(current.siteScope, hostname) === enabled) {
                return UNCHANGED;
            }
            if (isSiteListFull(current.siteScope, hostname)) {
                return rejected(SETTINGS_WRITE_ERROR.LIST_FULL);
            }
            return changed(next(current, {
                siteScope: withSiteProcessing(current.siteScope, hostname, enabled),
            }));
        });
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
                ? UNCHANGED
                : changed(next(current, { siteScope: { ...current.siteScope, mode } })),
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
            current.appearance === appearance
                ? UNCHANGED
                : changed(next(current, { appearance })),
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
                display.formatMode === FORMAT_MODE.CUSTOM
                && !validateCustomFormatPattern(display.pattern).ok
            ) {
                return {
                    ok: false,
                    error: SETTINGS_WRITE_ERROR.INVALID_FORMAT,
                    snapshot: this.fallbackSnapshot(),
                };
            }
            return {
                ok: false,
                error: SETTINGS_WRITE_ERROR.INVALID_DISPLAY_SETTINGS,
                snapshot: this.fallbackSnapshot(),
            };
        }
        if (
            parsed.timeZone.mode === TIME_ZONE_MODE.IANA &&
            !this.isTimeZoneAvailable(parsed.timeZone.identifier)
        ) {
            return {
                ok: false,
                error: SETTINGS_WRITE_ERROR.INVALID_TIME_ZONE,
                snapshot: this.fallbackSnapshot(),
            };
        }
        return this.mutate((current) =>
            sameDisplaySettings(current.display, parsed)
                ? UNCHANGED
                : changed(next(current, { display: parsed })),
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
            current.debugEnabled === enabled
                ? UNCHANGED
                : changed(next(current, { debugEnabled: enabled })),
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
                    error: SETTINGS_WRITE_ERROR.PERSISTENCE_FAILED,
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
            result = {
                ok: false,
                error: SETTINGS_WRITE_ERROR.PERSISTENCE_FAILED,
                snapshot: this.fallbackSnapshot(),
            };
        }
        return (
            result ?? {
                ok: false,
                error: SETTINGS_WRITE_ERROR.PERSISTENCE_FAILED,
                snapshot: this.fallbackSnapshot(),
            }
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
