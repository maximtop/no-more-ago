/**
 * @file Canonical settings schema, validation, migration, and default values.
 */

import { validateCustomFormatPattern } from "./custom-format";

/**
 * The presentation choices persisted alongside the extension policy.
 */
export type TimeZoneSelection =
    | { readonly mode: "system" }
    | { readonly mode: "utc" }
    | { readonly mode: "iana"; readonly identifier: string };

/**
 * Immutable formatting choices persisted with each settings revision.
 */
export type DisplaySettings =
    | { readonly formatMode: "system"; readonly timeZone: TimeZoneSelection }
    | {
        readonly formatMode: "custom";
        readonly pattern: string;
        readonly timeZone: TimeZoneSelection;
    };

/**
 * V5 is intentionally an unpublished schema; older documents are rejected.
 */
export interface SettingsSnapshotV5 {
    /**
     * Exact schema revision required before a snapshot is accepted.
     */
    readonly schemaVersion: 5;

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
 * Current schema version accepted by the settings parser.
 */
export const SETTINGS_SCHEMA_VERSION = 5 as const;

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
        readonly ok: true;
        readonly snapshot: SettingsSnapshotV5;
        readonly source: "default" | "stored" | "recovered";
    }
    | { readonly ok: false; readonly error: "load-failed" | "invalid-settings" };

/**
 * Accepts plain JSON-like records before schema validation.
 *
 * @param value - Untrusted value to inspect.
 * @returns - Whether the value is a non-array object record.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * A site key is the canonical URL.hostname, never a URL or URL.host.
 *
 * @param hostname - Candidate hostname to use as a site-preference key.
 * @returns - Whether the string is an exact canonical hostname.
 */
export function isCanonicalHostname(hostname: string): boolean {
    if (typeof hostname !== "string" || hostname.length === 0 || hostname.trim() !== hostname) {
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
 * Rejects non-records and invalid host overrides, then freezes a copied preference map so callers
 * cannot mutate a validated settings snapshot through its input object.
 *
 * @param value - Untrusted site-preferences value.
 * @returns - Frozen validated preference map, or null when invalid.
 */
function copySitePreferences(value: unknown): Readonly<Record<string, boolean>> | null {
    if (!isRecord(value)) {
        return null;
    }
    const entries: [string, boolean][] = [];
    for (const [hostname, enabled] of Object.entries(value)) {
        if (!isCanonicalHostname(hostname) || typeof enabled !== "boolean") {
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
 * @param identifier - Untrusted IANA time-zone identifier.
 * @returns - Whether the value has a safe, structurally valid identifier shape.
 */
export function isStructurallyValidTimeZoneIdentifier(identifier: unknown): identifier is string {
    if (
        typeof identifier !== "string" ||
        identifier.length === 0 ||
        identifier.trim() !== identifier
    ) {
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
 * Accepts only complete system, UTC, or structurally valid named-zone selections.
 *
 * @param value - Untrusted time-zone selection.
 * @returns - Whether the value is a complete supported selection.
 */
export function isTimeZoneSelection(value: unknown): value is TimeZoneSelection {
    if (!isRecord(value) || !Object.hasOwn(value, "mode")) {
        return false;
    }
    if (value.mode === "system" || value.mode === "utc") {
        return Object.keys(value).length === 1;
    }
    return (
        value.mode === "iana" &&
        Object.keys(value).length === 2 &&
        Object.hasOwn(value, "identifier") &&
        isStructurallyValidTimeZoneIdentifier(value.identifier)
    );
}

/**
 * Returns an immutable time-zone selection or null without coercing untrusted input.
 *
 * @param value - Untrusted time-zone selection.
 * @returns - Immutable validated selection, or null when invalid.
 */
export function parseTimeZoneSelection(value: unknown): TimeZoneSelection | null {
    if (!isTimeZoneSelection(value)) {
        return null;
    }
    return value.mode === "iana"
        ? Object.freeze({ mode: "iana", identifier: value.identifier })
        : Object.freeze({ mode: value.mode });
}

/**
 * Verifies the exact key set and validates custom patterns before accepting display choices.
 *
 * @param value - Untrusted display-settings value.
 * @returns - Whether the value has the exact valid display-settings shape.
 */
export function isDisplaySettings(value: unknown): value is DisplaySettings {
    if (
        !isRecord(value) ||
        !Object.hasOwn(value, "formatMode") ||
        !Object.hasOwn(value, "timeZone")
    ) {
        return false;
    }
    const timeZone = parseTimeZoneSelection(value.timeZone);
    if (timeZone === null) {
        return false;
    }
    if (value.formatMode === "system") {
        return Object.keys(value).length === 2;
    }
    return (
        value.formatMode === "custom" &&
        Object.keys(value).length === 3 &&
        Object.hasOwn(value, "pattern") &&
        typeof value.pattern === "string" &&
        validateCustomFormatPattern(value.pattern).ok
    );
}

/**
 * Copies validated display choices into an immutable representation, or returns null.
 *
 * @param value - Untrusted display-settings value.
 * @returns - Immutable validated display settings, or null when invalid.
 */
export function parseDisplaySettings(value: unknown): DisplaySettings | null {
    if (!isDisplaySettings(value)) {
        return null;
    }
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
 * Enforces the exact V5 schema and validates every nested settings value.
 *
 * @param value - Untrusted persisted settings value.
 * @returns - Whether the value satisfies the complete V5 schema.
 */
export function isSettingsSnapshotV5(value: unknown): value is SettingsSnapshotV5 {
    if (!isRecord(value)) {
        return false;
    }
    const keys = Object.keys(value);
    if (
        keys.length !== 6 ||
        !Object.hasOwn(value, "schemaVersion") ||
        !Object.hasOwn(value, "revision") ||
        !Object.hasOwn(value, "globalEnabled") ||
        !Object.hasOwn(value, "sitePreferences") ||
        !Object.hasOwn(value, "display") ||
        !Object.hasOwn(value, "debugEnabled")
    ) {
        return false;
    }
    return (
        value.schemaVersion === SETTINGS_SCHEMA_VERSION &&
        typeof value.revision === "number" &&
        Number.isSafeInteger(value.revision) &&
        value.revision >= 0 &&
        typeof value.globalEnabled === "boolean" &&
        copySitePreferences(value.sitePreferences) !== null &&
        isDisplaySettings(value.display) &&
        typeof value.debugEnabled === "boolean"
    );
}

/**
 * Produces an immutable V5 snapshot only from a fully validated storage record.
 *
 * @param value - Untrusted persisted settings value.
 * @returns - Immutable V5 snapshot, or null when validation fails.
 */
export function parseSettingsSnapshot(value: unknown): SettingsSnapshotV5 | null {
    if (!isSettingsSnapshotV5(value)) {
        return null;
    }
    const sitePreferences = copySitePreferences(value.sitePreferences);
    const display = parseDisplaySettings(value.display);
    if (sitePreferences === null || display === null) {
        return null;
    }
    return Object.freeze({
        schemaVersion: SETTINGS_SCHEMA_VERSION,
        revision: value.revision,
        globalEnabled: value.globalEnabled,
        sitePreferences,
        display,
        debugEnabled: value.debugEnabled,
    });
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
    if (!Number.isSafeInteger(revision) || revision < 0 || typeof globalEnabled !== "boolean") {
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
    if (typeof debugEnabled !== "boolean") {
        throw new TypeError("Invalid V5 debug setting");
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
