/**
 * @file Converts, validates, and previews editable options-page display settings.
 */

import type { DatePresentationResult } from "../shared/date/format-default-date";
import { formatDateWithPresentation } from "../shared/date/format-default-date";
import { UNAVAILABLE_TIME_ZONE_ERROR } from "../shared/date/presentation-errors";
import {
    FORMAT_MODE,
    TIME_ZONE_MODE,
    type DisplaySettings,
    type FormatMode,
    type TimeZoneMode,
} from "../shared/settings/snapshot";
import {
    CUSTOM_FORMAT_ERROR,
    DEFAULT_CUSTOM_FORMAT_PATTERN,
    validateCustomFormatPattern,
} from "../shared/settings/custom-format";
import { t, type MessageKey } from "../shared/i18n/translator";
import { DISPLAY_SETTINGS_ERROR } from "../shared/messaging/view-state-values";

/**
 * Named outcomes of saving display settings.
 */
export const DISPLAY_NOTICE = {
    INVALID_TIME_ZONE: DISPLAY_SETTINGS_ERROR.INVALID_TIME_ZONE,
    INVALID_FORMAT: DISPLAY_SETTINGS_ERROR.INVALID_FORMAT,
    UNAVAILABLE_TIME_ZONE: UNAVAILABLE_TIME_ZONE_ERROR,
    SAVE_FAILED: DISPLAY_SETTINGS_ERROR.SAVE_FAILED,
    INTERRUPTED: "interrupted",
    PARTIAL_REFRESH: "partial-refresh",
    SAVED: "saved",
    EXTERNAL_CHANGE: "external-change",
    UNKNOWN: "unknown",
} as const;

/**
 * User-visible outcome of saving display settings, or undefined when there is none.
 */
export type DisplayNotice =
    | (typeof DISPLAY_NOTICE)[keyof typeof DISPLAY_NOTICE]
    | undefined;

/**
 * Editable representation of the display settings form.
 */
export interface DisplayDraft {
    /**
     * Whether dates use the browser format or a custom pattern.
     */
    readonly formatMode: FormatMode;

    /**
     * Custom date format pattern, retained while system formatting is selected.
     */
    readonly pattern: string;

    /**
     * Whether dates use the system zone, UTC, or a named IANA zone.
     */
    readonly timeZoneMode: TimeZoneMode;

    /**
     * IANA zone identifier when the named-zone mode is selected.
     */
    readonly identifier: string;
}

/**
 * Preview text and whether it is a rendered value or an instruction.
 */
export interface DisplayPreview {
    /**
     * Whether the text is the rendered fixture rather than a correction hint.
     */
    readonly ok: boolean;

    /**
     * Rendered fixture, or the sentence naming what must be fixed first.
     */
    readonly text: string;
}

/**
 * Fixed instant previewed by the Display section.
 */
export const DISPLAY_PREVIEW_INSTANT = new Date("2026-08-27T19:32:28.000Z");

/**
 * Label naming the previewed fixture beside the rendered value.
 */
export const DISPLAY_PREVIEW_SOURCE =
    `Fixed fixture · ${DISPLAY_PREVIEW_INSTANT.toISOString().replace(".000Z", "Z")}`;

/**
 * Converts saved display settings into fields for the editable form.
 *
 * @param display - Persisted display settings.
 * @returns - The corresponding form draft, with a default custom pattern when needed.
 */
export function draftFromDisplay(display: DisplaySettings): DisplayDraft {
    return {
        formatMode: display.formatMode,
        pattern: display.formatMode === FORMAT_MODE.CUSTOM
            ? display.pattern
            : DEFAULT_CUSTOM_FORMAT_PATTERN,
        timeZoneMode: display.timeZone.mode,
        identifier: display.timeZone.mode === TIME_ZONE_MODE.IANA
            ? display.timeZone.identifier
            : "",
    };
}

/**
 * Converts the display form fields into settings for persistence.
 *
 * @param draft - Current form draft.
 * @returns - Display settings represented by the draft.
 */
export function displayFromDraft(draft: DisplayDraft): DisplaySettings {
    const timeZone =
        draft.timeZoneMode === TIME_ZONE_MODE.IANA
            ? { mode: TIME_ZONE_MODE.IANA, identifier: draft.identifier }
            : { mode: draft.timeZoneMode };
    return draft.formatMode === FORMAT_MODE.CUSTOM
        ? { formatMode: FORMAT_MODE.CUSTOM, pattern: draft.pattern, timeZone }
        : { formatMode: FORMAT_MODE.SYSTEM, timeZone };
}

/**
 * Validates an IANA time-zone identifier before settings are saved.
 *
 * @param identifier - Candidate IANA time-zone identifier.
 * @returns - Key of a validation error, or undefined when the identifier is usable.
 */
export function validateIdentifier(identifier: string): MessageKey | undefined {
    if (identifier.length === 0 || identifier.trim() !== identifier) {
        return "display_zone_hint";
    }
    const components = identifier.split("/");
    if (components.some((component) => component === "." || component === "..")) {
        return "display_error_zone_traversal";
    }
    if (!/^[A-Za-z][A-Za-z0-9_.+-]*(?:\/[A-Za-z][A-Za-z0-9_.+-]*)*$/.test(identifier)) {
        return "display_error_zone_invalid";
    }
    try {
        new Intl.DateTimeFormat(undefined, { timeZone: identifier }).resolvedOptions();
    } catch {
        return "display_error_zone_unavailable";
    }
    return undefined;
}

/**
 * Maps a display-settings outcome to the message key describing it.
 *
 * @param notice - Outcome reported after saving display settings.
 * @returns - Message key, or undefined when there is no notice to show.
 */
export function displayNoticeKey(notice: DisplayNotice): MessageKey | undefined {
    if (notice === DISPLAY_NOTICE.INVALID_TIME_ZONE) {
        return "display_error_zone_rejected";
    }
    if (notice === DISPLAY_NOTICE.INVALID_FORMAT) {
        return "display_error_format_invalid";
    }
    if (notice === DISPLAY_NOTICE.UNAVAILABLE_TIME_ZONE) {
        return "display_error_zone_saved_unavailable";
    }
    if (notice === DISPLAY_NOTICE.SAVE_FAILED) {
        return "display_error_save_failed";
    }
    if (notice === DISPLAY_NOTICE.INTERRUPTED) {
        return "display_notice_interrupted";
    }
    if (notice === DISPLAY_NOTICE.PARTIAL_REFRESH) {
        return "display_notice_partial_refresh";
    }
    if (notice === DISPLAY_NOTICE.SAVED) {
        return "display_notice_saved";
    }
    if (notice === DISPLAY_NOTICE.EXTERNAL_CHANGE) {
        return "display_updated_elsewhere";
    }
    if (notice === DISPLAY_NOTICE.UNKNOWN) {
        return "display_notice_unknown";
    }
    return undefined;
}

/**
 * Maps custom date-format validation failures to their message keys.
 *
 * @param pattern - Candidate custom date-format pattern.
 * @returns - Key of a validation error, or undefined when the pattern is valid.
 */
export function customPatternError(pattern: string): MessageKey | undefined {
    const result = validateCustomFormatPattern(pattern);
    if (result.ok) {
        return undefined;
    }
    switch (result.error) {
        case CUSTOM_FORMAT_ERROR.EMPTY:
            return "display_pattern_error_empty";
        case CUSTOM_FORMAT_ERROR.TOO_LONG:
            return "display_pattern_error_too_long";
        case CUSTOM_FORMAT_ERROR.CONTROL_CHARACTER:
            return "display_pattern_error_control_chars";
        case CUSTOM_FORMAT_ERROR.UNCLOSED_QUOTE:
            return "display_pattern_error_unclosed_quote";
        case CUSTOM_FORMAT_ERROR.MISSING_DATE_TOKEN:
            return "display_pattern_error_no_tokens";
        case CUSTOM_FORMAT_ERROR.LEGACY_TOKEN:
            return "display_pattern_error_wrong_case";
        case CUSTOM_FORMAT_ERROR.INVALID_TOKEN:
            return "display_pattern_error_unsupported";
        case CUSTOM_FORMAT_ERROR.EMPTY_OUTPUT:
            return "display_pattern_error_blank_output";
    }
}

/**
 * Renders the fixture with the current draft, or explains what must be fixed.
 *
 * @param draft - Current display form fields.
 * @param patternError - Custom-pattern error already computed for the draft, when any.
 * @returns - Preview text and whether it is a rendered value.
 */
export function previewDisplayDraft(
    draft: DisplayDraft,
    patternError: MessageKey | undefined = draft.formatMode === FORMAT_MODE.CUSTOM
        ? customPatternError(draft.pattern)
        : undefined,
): DisplayPreview {
    if (patternError) {
        return { ok: false, text: t("display_preview_fix_pattern") };
    }
    if (draft.timeZoneMode === TIME_ZONE_MODE.IANA && validateIdentifier(draft.identifier)) {
        return { ok: false, text: t("display_preview_fix_zone") };
    }
    const result: DatePresentationResult = formatDateWithPresentation(
        DISPLAY_PREVIEW_INSTANT,
        previewLocales(),
        displayFromDraft(draft),
    );
    return result.text.length === 0
        ? { ok: false, text: t("display_preview_fix_pattern") }
        : { ok: true, text: result.text };
}

/**
 * Selects browser locales for the display-format preview.
 *
 * @returns - Browser preference locales, or en-US when browser information is unavailable.
 */
function previewLocales(): readonly string[] {
    if (typeof navigator === "undefined") {
        return ["en-US"];
    }
    const locales = Array.isArray(navigator.languages)
        ? navigator.languages.filter((value): value is string => typeof value === "string")
        : [];
    return locales.length > 0 ? locales : navigator.language ? [navigator.language] : ["en-US"];
}
