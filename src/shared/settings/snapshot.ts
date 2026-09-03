/**
 * @file Canonical settings types, domain validation, and default values.
 */

import { validateCustomFormatPattern } from "./custom-format";
import {
    DEFAULT_SITE_SCOPE,
    parseSiteScopePolicy,
    type SiteScopePolicy,
} from "./site-scope";

/**
 * Current schema version written with extension settings.
 */
export const SETTINGS_SCHEMA_VERSION = 1 as const;

/**
 * Named appearance choices applied to the popup and the settings page.
 */
export const APPEARANCE = {
    SYSTEM: "system",
    LIGHT: "light",
    DARK: "dark",
} as const;

/**
 * Complete set of persisted appearance choices.
 */
export const APPEARANCES = [
    APPEARANCE.SYSTEM,
    APPEARANCE.LIGHT,
    APPEARANCE.DARK,
] as const;

/**
 * Appearance choice applied to both extension surfaces.
 */
export type Appearance = (typeof APPEARANCES)[number];

/**
 * The presentation choices persisted alongside the extension policy.
 */
export type TimeZoneSelection =
    | {
        /**
         * Uses the browser's current system time zone.
         */
        readonly mode: "system";
    }
    | {
        /**
         * Uses Coordinated Universal Time.
         */
        readonly mode: "utc";
    }
    | {
        /**
         * Uses an explicitly selected IANA time zone.
         */
        readonly mode: "iana";

        /**
         * Structurally valid IANA time-zone identifier.
         */
        readonly identifier: string;
    };

/**
 * Immutable formatting choices persisted with each settings revision.
 */
export type DisplaySettings =
    | {
        /**
         * Uses the browser locale's standard date and time format.
         */
        readonly formatMode: "system";

        /**
         * Time zone applied before the system format renders the timestamp.
         */
        readonly timeZone: TimeZoneSelection;
    }
    | {
        /**
         * Uses a validated user-supplied date-fns pattern.
         */
        readonly formatMode: "custom";

        /**
         * Validated date-fns pattern used to render the timestamp.
         */
        readonly pattern: string;

        /**
         * Time zone applied before the custom pattern renders the timestamp.
         */
        readonly timeZone: TimeZoneSelection;
    };

/**
 * Persisted settings document. The schema is unpublished, so a stored document
 * of any other version is discarded rather than migrated.
 */
export interface SettingsSnapshot {
    /**
     * Exact schema revision required before a snapshot is accepted.
     */
    readonly schemaVersion: typeof SETTINGS_SCHEMA_VERSION;

    /**
     * Monotonic revision used to order persisted settings writes.
     */
    readonly revision: number;

    /**
     * Whether timestamp replacement is enabled for every eligible site.
     */
    readonly globalEnabled: boolean;

    /**
     * Active scope mode and both retained hostname lists.
     */
    readonly siteScope: SiteScopePolicy;

    /**
     * Persisted presentation choices applied to rendered timestamps.
     */
    readonly display: DisplaySettings;

    /**
     * Appearance applied to the popup and the settings page.
     */
    readonly appearance: Appearance;

    /**
     * Whether bounded diagnostic events are retained locally.
     */
    readonly debugEnabled: boolean;
}

/**
 * Caller-supplied fields accepted when constructing a snapshot.
 */
export interface SettingsSnapshotInput {
    /**
     * Non-negative storage revision.
     */
    readonly revision: number;

    /**
     * Whether timestamp replacement is globally active.
     */
    readonly globalEnabled: boolean;

    /**
     * Scope mode and hostname lists; defaults to the initial policy.
     */
    readonly siteScope?: SiteScopePolicy;

    /**
     * Validated date presentation choices.
     */
    readonly display?: DisplaySettings;

    /**
     * Appearance choice; defaults to following the browser.
     */
    readonly appearance?: Appearance;

    /**
     * Whether diagnostic journaling is enabled.
     */
    readonly debugEnabled?: boolean;
}

/**
 * Storage key for the active settings snapshot.
 */
export const SETTINGS_STORAGE_KEY = "settings" as const;

/**
 * Storage key reserved for the previous settings snapshot during a write.
 */
export const SETTINGS_PREVIOUS_STORAGE_KEY = "settings.previous" as const;

/**
 * Immutable system-format fallback used when no valid saved display choice exists.
 */
export const DEFAULT_DISPLAY_SETTINGS: DisplaySettings = Object.freeze({
    formatMode: "system",
    timeZone: Object.freeze({ mode: "system" }),
});

/**
 * Known-good initial snapshot used for first run and failed-closed recovery.
 */
export const DEFAULT_SETTINGS_SNAPSHOT: SettingsSnapshot = Object.freeze({
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    revision: 0,
    globalEnabled: true,
    siteScope: DEFAULT_SITE_SCOPE,
    display: DEFAULT_DISPLAY_SETTINGS,
    appearance: APPEARANCE.SYSTEM,
    debugEnabled: false,
});

/**
 * Result of loading storage, distinguishing a usable snapshot from a recoverable failure.
 */
export type SettingsLoadResult =
    | {
        /**
         * Indicates that an authoritative settings snapshot is available.
         */
        readonly ok: true;

        /**
         * Validated settings snapshot selected by the load operation.
         */
        readonly snapshot: SettingsSnapshot;

        /**
         * Storage path from which the authoritative snapshot was obtained.
         * `discarded` means a document of another schema version was found
         * and replaced by persisted defaults.
         */
        readonly source: "default" | "stored" | "recovered" | "discarded";
    }
    | {
        /**
         * Indicates that no trustworthy settings snapshot could be loaded.
         */
        readonly ok: false;

        /**
         * Stable reason the settings load failed closed.
         */
        readonly error: "load-failed" | "invalid-settings";
    };

const IANA_COMPONENT = /^[A-Za-z][A-Za-z0-9_.+-]*$/;

/**
 * Rejects whitespace, control characters, traversal segments, and invalid IANA name components.
 *
 * @param identifier - IANA time-zone identifier supplied by the user.
 * @returns - Whether the value has a safe, structurally valid identifier shape.
 */
export function isStructurallyValidTimeZoneIdentifier(identifier: string): boolean {
    if (identifier.length === 0 || identifier.trim() !== identifier) {
        return false;
    }
    if (identifier.includes("\\") || /\s/u.test(identifier)) {
        return false;
    }
    for (const character of identifier) {
        const code = character.codePointAt(0) ?? 0;
        if (code <= 0x1f || code === 0x7f) {
            return false;
        }
    }
    const components = identifier.split("/");
    return (
        components.length > 0 &&
        components.every(
            (component) =>
                component !== "." && component !== ".." && IANA_COMPONENT.test(component),
        )
    );
}

/**
 * Checks domain constraints for a typed time-zone selection.
 *
 * @param value - Typed time-zone selection.
 * @returns - Whether the selection satisfies its domain constraints.
 */
export function isTimeZoneSelection(value: TimeZoneSelection): boolean {
    if (value.mode === "system" || value.mode === "utc") {
        return true;
    }
    return isStructurallyValidTimeZoneIdentifier(value.identifier);
}

/**
 * Returns an immutable time-zone selection after checking user-authored domain values.
 *
 * @param value - Typed time-zone selection.
 * @returns - Immutable validated selection, or null when invalid.
 */
export function parseTimeZoneSelection(value: TimeZoneSelection): TimeZoneSelection | null {
    if (!isTimeZoneSelection(value)) {
        return null;
    }
    return value.mode === "iana"
        ? Object.freeze({ mode: "iana", identifier: value.identifier })
        : Object.freeze({ mode: value.mode });
}

/**
 * Validates user-authored domain values inside typed display choices.
 *
 * @param value - Typed display settings.
 * @returns - Whether the settings satisfy their domain constraints.
 */
export function isDisplaySettings(value: DisplaySettings): boolean {
    return parseDisplaySettings(value) !== null;
}

/**
 * Copies validated display choices into an immutable representation, or returns null.
 *
 * @param value - Typed display settings.
 * @returns - Immutable validated display settings, or null when invalid.
 */
export function parseDisplaySettings(value: DisplaySettings): DisplaySettings | null {
    const timeZone = parseTimeZoneSelection(value.timeZone);
    if (timeZone === null) {
        return null;
    }
    if (value.formatMode === "system") {
        return Object.freeze({ formatMode: "system", timeZone });
    }
    const checked = validateCustomFormatPattern(value.pattern);
    if (!checked.ok) {
        return null;
    }
    return Object.freeze({ formatMode: "custom", pattern: checked.pattern, timeZone });
}

/**
 * Compares display choices without relying on object identity.
 *
 * @param a - First display-settings value.
 * @param b - Second display-settings value.
 * @returns - Whether both values contain the same presentation choices.
 */
export function sameDisplaySettings(a: DisplaySettings, b: DisplaySettings): boolean {
    if (a.formatMode !== b.formatMode) {
        return false;
    }
    if (a.formatMode === "custom" && b.formatMode === "custom" && a.pattern !== b.pattern) {
        return false;
    }
    if (a.timeZone.mode !== b.timeZone.mode) {
        return false;
    }
    return (
        a.timeZone.mode !== "iana"
        || b.timeZone.mode !== "iana"
        || a.timeZone.identifier === b.timeZone.identifier
    );
}

/**
 * Validates caller-supplied settings and freezes the canonical storage shape.
 *
 * @param input - Validated settings fields.
 * @returns - Frozen canonical settings snapshot.
 */
export function createSettingsSnapshot(input: SettingsSnapshotInput): SettingsSnapshot {
    if (!Number.isSafeInteger(input.revision) || input.revision < 0) {
        throw new TypeError("Invalid settings snapshot revision");
    }
    const siteScope = parseSiteScopePolicy(input.siteScope ?? DEFAULT_SITE_SCOPE);
    const display = parseDisplaySettings(input.display ?? DEFAULT_DISPLAY_SETTINGS);
    const appearance = input.appearance ?? APPEARANCE.SYSTEM;
    if (siteScope === null) {
        throw new TypeError("Invalid site scope");
    }
    if (display === null) {
        throw new TypeError("Invalid display settings");
    }
    if (!APPEARANCES.includes(appearance)) {
        throw new TypeError("Invalid appearance");
    }
    return Object.freeze({
        schemaVersion: SETTINGS_SCHEMA_VERSION,
        revision: input.revision,
        globalEnabled: input.globalEnabled,
        siteScope,
        display,
        appearance,
        debugEnabled: input.debugEnabled ?? false,
    });
}

/**
 * Recognizes a stored value written by this schema version. A document from any
 * other version is discarded, because no released build persisted one.
 *
 * @param value - Value read from durable storage.
 * @returns - Whether the value is a snapshot of the current schema version.
 */
export function isCurrentSettingsSnapshot(value: unknown): value is SettingsSnapshot {
    return (
        typeof value === "object"
        && value !== null
        && (value as { readonly schemaVersion?: unknown }).schemaVersion
            === SETTINGS_SCHEMA_VERSION
    );
}
