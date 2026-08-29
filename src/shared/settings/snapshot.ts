/**
 * @file Canonical settings types, domain validation, and default values.
 */

import { validateCustomFormatPattern } from "./custom-format";

/**
 * Current schema version written with extension settings.
 */
export const SETTINGS_SCHEMA_VERSION = 5 as const;

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
 * V5 is intentionally an unpublished schema; older documents are rejected.
 */
export interface SettingsSnapshotV5 {
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
     * Per-host overrides keyed by canonical URL.hostname values.
     */
    readonly sitePreferences: Readonly<Record<string, boolean>>;

    /**
     * Persisted presentation choices applied to rendered timestamps.
     */
    readonly display: DisplaySettings;

    /**
     * Whether bounded diagnostic events are retained locally.
     */
    readonly debugEnabled: boolean;
}

/**
 * Storage key for the active settings snapshot.
 */
export const SETTINGS_STORAGE_KEY = "settings" as const;

/**
 * Storage key reserved for the previous settings snapshot during a write.
 */
export const SETTINGS_PREVIOUS_STORAGE_KEY = "settings.previous" as const;

const EMPTY_SITE_PREFERENCES: Readonly<Record<string, boolean>> = Object.freeze(
    Object.create(null) as Record<string, boolean>,
);

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
export const DEFAULT_SETTINGS_SNAPSHOT: SettingsSnapshotV5 = Object.freeze({
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    revision: 0,
    globalEnabled: true,
    sitePreferences: EMPTY_SITE_PREFERENCES,
    display: DEFAULT_DISPLAY_SETTINGS,
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
        readonly snapshot: SettingsSnapshotV5;

        /**
         * Storage path from which the authoritative snapshot was obtained.
         */
        readonly source: "default" | "stored" | "recovered";
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

/**
 * A site key is the canonical URL.hostname, never a URL or URL.host.
 *
 * @param hostname - Candidate hostname to use as a site-preference key.
 * @returns - Whether the string is an exact canonical hostname.
 */
export function isCanonicalHostname(hostname: string): boolean {
    if (hostname.length === 0 || hostname.trim() !== hostname) {
        return false;
    }
    if (hostname.endsWith("..") || hostname.includes("*")) {
        return false;
    }
    try {
        const parsed = new URL(`https://${hostname}`);
        return (
            parsed.protocol === "https:" &&
            parsed.hostname === hostname &&
            parsed.username === "" &&
            parsed.password === "" &&
            parsed.port === "" &&
            parsed.pathname === "/" &&
            parsed.search === "" &&
            parsed.hash === ""
        );
    } catch {
        return false;
    }
}

/**
 * Rejects noncanonical host overrides and freezes a copied preference map so callers cannot
 * mutate a settings snapshot through its input object.
 *
 * @param value - Typed site-preferences value.
 * @returns - Frozen validated preference map, or null when invalid.
 */
function copySitePreferences(
    value: Readonly<Record<string, boolean>>,
): Readonly<Record<string, boolean>> | null {
    const entries: [string, boolean][] = [];
    for (const [hostname, enabled] of Object.entries(value)) {
        if (!isCanonicalHostname(hostname)) {
            return null;
        }
        entries.push([hostname, enabled]);
    }
    return Object.freeze(Object.fromEntries(entries));
}

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
 * Validates caller-supplied settings and freezes the canonical V5 storage shape.
 *
 * @param revision - Non-negative storage revision.
 * @param globalEnabled - Whether timestamp replacement is globally active.
 * @param sitePreferences - Canonical-host activation overrides.
 * @param display - Validated date presentation choices.
 * @param debugEnabled - Whether diagnostic journaling is enabled.
 * @returns - Frozen canonical V5 settings snapshot.
 */
export function createSettingsSnapshot(
    revision: number,
    globalEnabled: boolean,
    sitePreferences: Readonly<Record<string, boolean>> = EMPTY_SITE_PREFERENCES,
    display: DisplaySettings = DEFAULT_DISPLAY_SETTINGS,
    debugEnabled = false,
): SettingsSnapshotV5 {
    if (!Number.isSafeInteger(revision) || revision < 0) {
        throw new TypeError("Invalid V5 settings snapshot");
    }
    const copied = copySitePreferences(sitePreferences);
    const parsedDisplay = parseDisplaySettings(display);
    if (copied === null) {
        throw new TypeError("Invalid V5 site preferences");
    }
    if (parsedDisplay === null) {
        throw new TypeError("Invalid V5 display settings");
    }
    return Object.freeze({
        schemaVersion: SETTINGS_SCHEMA_VERSION,
        revision,
        globalEnabled,
        sitePreferences: copied,
        display: parsedDisplay,
        debugEnabled,
    });
}

/**
 * Treats an absent per-site override as enabled and only disables explicit false entries.
 *
 * @param sitePreferences - Canonical-host activation overrides.
 * @param hostname - Canonical hostname whose effective state is requested.
 * @returns - Whether processing is enabled for the hostname.
 */
export function isSiteEnabled(
    sitePreferences: Readonly<Record<string, boolean>>,
    hostname: string,
): boolean {
    return !Object.hasOwn(sitePreferences, hostname) || sitePreferences[hostname] !== false;
}
