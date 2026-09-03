/**
 * @file Converts, validates, and previews editable options-page display settings.
 */

import type { DatePresentationResult } from "../shared/date/format-default-date";
import { formatDateWithPresentation } from "../shared/date/format-default-date";
import { UNAVAILABLE_TIME_ZONE_ERROR } from "../shared/date/presentation-errors";
import type { DisplaySettings } from "../shared/settings/snapshot";
import {
    CUSTOM_FORMAT_MAX_LENGTH,
    CUSTOM_FORMAT_ERROR,
    DEFAULT_CUSTOM_FORMAT_PATTERN,
    validateCustomFormatPattern,
} from "../shared/settings/custom-format";

/**
 * User-visible outcome of saving display settings.
 */
export type DisplayNotice =
    | "invalid-time-zone"
    | "invalid-format"
    | typeof UNAVAILABLE_TIME_ZONE_ERROR
    | "save-failed"
    | "interrupted"
    | "partial-refresh"
    | "unknown"
    | undefined;

/**
 * Editable representation of the display settings form.
 */
export interface DisplayDraft {
    /**
     * Whether dates use the browser format or a custom pattern.
     */
    readonly formatMode: "system" | "custom";

    /**
     * Custom date format pattern, retained while system formatting is selected.
     */
    readonly pattern: string;

    /**
     * Whether dates use the system zone, UTC, or a named IANA zone.
     */
    readonly timeZoneMode: "system" | "utc" | "iana";

    /**
     * IANA zone identifier when the named-zone mode is selected.
     */
    readonly identifier: string;
}

const PREVIEW_INSTANT = new Date("2026-08-25T12:34:00.000Z");

/**
 * Converts saved display settings into fields for the editable form.
 *
 * @param display Persisted display settings.
 * @returns The corresponding form draft, with a default custom pattern when needed.
 */
export function draftFromDisplay(display: DisplaySettings): DisplayDraft {
    return {
        formatMode: display.formatMode,
        pattern: display.formatMode === "custom" ? display.pattern : DEFAULT_CUSTOM_FORMAT_PATTERN,
        timeZoneMode: display.timeZone.mode,
        identifier: display.timeZone.mode === "iana" ? display.timeZone.identifier : "",
    };
}

/**
 * Converts the display form fields into settings for persistence.
 *
 * @param draft Current form draft.
 * @returns Display settings represented by the draft.
 */
export function displayFromDraft(draft: DisplayDraft): DisplaySettings {
    const timeZone =
        draft.timeZoneMode === "iana"
            ? { mode: "iana" as const, identifier: draft.identifier }
            : { mode: draft.timeZoneMode };
    return draft.formatMode === "custom"
        ? { formatMode: "custom", pattern: draft.pattern, timeZone }
        : { formatMode: "system", timeZone };
}

/**
 * Validates an IANA time-zone identifier before settings are saved.
 *
 * @param identifier Candidate IANA time-zone identifier.
 * @returns A user-visible validation error, or undefined when the identifier is usable.
 */
export function validateIdentifier(identifier: string): string | undefined {
    if (identifier.length === 0 || identifier.trim() !== identifier) {
        return "Enter an IANA time zone identifier, for example America/New_York.";
    }
    const components = identifier.split("/");
    if (components.some((component) => component === "." || component === "..")) {
        return "Use a valid IANA time zone identifier without path traversal.";
    }
    if (!/^[A-Za-z][A-Za-z0-9_.+-]*(?:\/[A-Za-z][A-Za-z0-9_.+-]*)*$/.test(identifier)) {
        return "Use a valid IANA time zone identifier, such as America/New_York.";
    }
    try {
        new Intl.DateTimeFormat(undefined, { timeZone: identifier }).resolvedOptions();
    } catch {
        return "This time zone is not available in the current browser. Choose another identifier.";
    }
    return undefined;
}

/**
 * Maps a display-settings outcome to its user-visible error message.
 *
 * @param notice Outcome reported after saving display settings.
 * @returns An error message, or undefined when there is no notice to show.
 */
export function displayNoticeText(notice: DisplayNotice): string | undefined {
    if (notice === "invalid-time-zone") {
        return "This time zone is invalid or unavailable. Enter a supported IANA identifier and "
            + "try again.";
    }
    if (notice === "invalid-format") {
        return "The date format is invalid. Correct the pattern and try again.";
    }
    if (notice === UNAVAILABLE_TIME_ZONE_ERROR) {
        return "The saved time zone is unavailable in this browser. Choose System or another "
            + "supported zone, then save.";
    }
    if (notice === "save-failed") {
        return "Could not save the display settings. Your previous format remains active. "
            + "Try again.";
    }
    if (notice === "interrupted") {
        return "The response was interrupted. Display settings were reread.";
    }
    if (notice === "partial-refresh") {
        return "Display settings were saved, but one or more open pages could not be refreshed. "
            + "New dates will use the saved setting.";
    }
    if (notice === "unknown") {
        return "Could not confirm whether the display settings were saved. Reopen Settings to "
            + "try again.";
    }
    return undefined;
}

/**
 * Maps custom date-format validation failures to form errors.
 *
 * @param pattern Candidate custom date-format pattern.
 * @returns A validation error, or undefined when the pattern is valid.
 */
export function customPatternError(pattern: string): string | undefined {
    const result = validateCustomFormatPattern(pattern);
    if (result.ok) {
        return undefined;
    }
    switch (result.error) {
        case CUSTOM_FORMAT_ERROR.EMPTY:
            return "Enter a date format pattern.";
        case CUSTOM_FORMAT_ERROR.TOO_LONG:
            return `Use a date format pattern of ${String(CUSTOM_FORMAT_MAX_LENGTH)} `
                + "characters or fewer.";
        case CUSTOM_FORMAT_ERROR.CONTROL_CHARACTER:
            return "Remove control characters from the date format pattern.";
        case CUSTOM_FORMAT_ERROR.UNCLOSED_QUOTE:
            return "Close the quoted text in the date format pattern.";
        case CUSTOM_FORMAT_ERROR.MISSING_DATE_TOKEN:
            return "Include at least one date or time token, such as yyyy or HH:mm.";
        case CUSTOM_FORMAT_ERROR.LEGACY_TOKEN:
            return "Use Unicode date tokens, such as yyyy instead of YYYY or DD.";
        case CUSTOM_FORMAT_ERROR.INVALID_TOKEN:
            return "Use supported Unicode date and time tokens in the pattern.";
        case CUSTOM_FORMAT_ERROR.EMPTY_OUTPUT:
            return "The date format must produce visible text.";
    }
}

/**
 * Creates a localized preview for a valid custom-format draft.
 *
 * @param draft Current display form fields.
 * @returns A presentation preview, or undefined when custom formatting is not ready.
 */
export function previewDisplayDraft(draft: DisplayDraft): DatePresentationResult | undefined {
    if (draft.formatMode !== "custom" || customPatternError(draft.pattern)) {
        return undefined;
    }
    return formatDateWithPresentation(PREVIEW_INSTANT, previewLocales(), displayFromDraft(draft));
}

/**
 * Selects browser locales for the display-format preview.
 *
 * @returns Browser preference locales, or en-US when browser information is unavailable.
 */
function previewLocales(): readonly string[] {
    if (typeof navigator === "undefined") {
        return ["en-US"];
    }
    const locales = navigator.languages;
    return locales.length > 0 ? locales : navigator.language ? [navigator.language] : ["en-US"];
}
