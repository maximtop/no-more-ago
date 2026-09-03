/**
 * @file Locale-aware presentation for calendar dates without instant semantics.
 */

import { format } from "date-fns";
import { tz } from "@date-fns/tz";

import type { CalendarDate } from "./calendar-date";
import { resolveDateLocale } from "./date-locale";
import {
    DEFAULT_DISPLAY_SETTINGS,
    FORMAT_MODE,
    type DisplaySettings,
} from "../settings/snapshot";

/**
 * Calendar-only date-fns field symbols retained by custom projection.
 */
const CALENDAR_FIELD_SYMBOLS: ReadonlySet<string> = new Set(
    "GyYuURQqMLwIdDEeciP",
);

/**
 * Time, zone, and instant date-fns field symbols removed by custom projection.
 */
const TIME_FIELD_SYMBOLS: ReadonlySet<string> = new Set(
    "abBhHKkmsSXxOztTp",
);

/**
 * One classified fragment from a validated custom pattern.
 */
interface CalendarPatternPart {
    /**
     * Semantic role used by calendar-only projection.
     */
    readonly kind: "calendar-field" | "time-field" | "literal";

    /**
     * Exact date-fns pattern fragment.
     */
    readonly source: string;

    /**
     * Stable source order.
     */
    readonly index: number;
}

/**
 * Checks whether one pattern character begins a date-fns field.
 *
 * @param character - Pattern character to classify.
 * @returns - Whether the character is an ASCII letter.
 */
function isFieldCharacter(character: string): boolean {
    return /[A-Za-z]/u.test(character);
}

/**
 * Tokenizes a validated date-fns pattern without interpreting page data.
 *
 * @param pattern - Validated bounded custom pattern.
 * @returns - Classified exact fragments, or null when projection cannot proceed safely.
 */
function tokenizeCalendarPattern(pattern: string): readonly CalendarPatternPart[] | null {
    const parts: CalendarPatternPart[] = [];
    let offset = 0;
    while (offset < pattern.length) {
        const character = pattern[offset];
        if (character === undefined) {
            return null;
        }
        if (character === "'") {
            if (pattern[offset + 1] === "'") {
                parts.push({ kind: "literal", source: "''", index: parts.length });
                offset += 2;
                continue;
            }
            let end = offset + 1;
            let closed = false;
            while (end < pattern.length) {
                if (pattern[end] !== "'") {
                    end += 1;
                    continue;
                }
                if (pattern[end + 1] === "'") {
                    end += 2;
                    continue;
                }
                end += 1;
                closed = true;
                break;
            }
            if (!closed) {
                return null;
            }
            parts.push({
                kind: "literal",
                source: pattern.slice(offset, end),
                index: parts.length,
            });
            offset = end;
            continue;
        }
        if (isFieldCharacter(character)) {
            const calendarField = CALENDAR_FIELD_SYMBOLS.has(character);
            const timeField = TIME_FIELD_SYMBOLS.has(character);
            if (!calendarField && !timeField) {
                return null;
            }
            let end = offset + 1;
            while (pattern[end] === character) {
                end += 1;
            }
            if (character !== "P" && character !== "p" && pattern[end] === "o") {
                end += 1;
            }
            parts.push({
                kind: calendarField ? "calendar-field" : "time-field",
                source: pattern.slice(offset, end),
                index: parts.length,
            });
            offset = end;
            continue;
        }
        let end = offset + 1;
        while (
            end < pattern.length
            && pattern[end] !== "'"
            && !isFieldCharacter(pattern[end] ?? "")
        ) {
            end += 1;
        }
        parts.push({
            kind: "literal",
            source: pattern.slice(offset, end),
            index: parts.length,
        });
        offset = end;
    }
    return parts;
}

/**
 * Projects one validated custom pattern to its safe calendar-only subset.
 *
 * @param pattern - Validated bounded custom pattern.
 * @returns - Usable calendar-only pattern, or null for localized fallback.
 */
function projectCalendarPattern(pattern: string): string | null {
    const parts = tokenizeCalendarPattern(pattern);
    if (!parts) {
        return null;
    }
    const previousFields: Array<CalendarPatternPart["kind"] | undefined> = [];
    const nextFields: Array<CalendarPatternPart["kind"] | undefined> = [];
    let nearestField: CalendarPatternPart["kind"] | undefined;
    for (const part of parts) {
        previousFields[part.index] = nearestField;
        if (part.kind !== "literal") {
            nearestField = part.kind;
        }
    }
    nearestField = undefined;
    for (let index = parts.length - 1; index >= 0; index -= 1) {
        const part = parts[index];
        if (!part) {
            continue;
        }
        nextFields[part.index] = nearestField;
        if (part.kind !== "literal") {
            nearestField = part.kind;
        }
    }

    let projected = "";
    let calendarFieldCount = 0;
    let discardedTimeSinceCalendar = false;
    for (const part of parts) {
        if (part.kind === "time-field") {
            if (calendarFieldCount > 0) {
                discardedTimeSinceCalendar = true;
            }
            continue;
        }
        if (part.kind === "calendar-field") {
            if (discardedTimeSinceCalendar) {
                projected = `${projected.trimEnd()} `;
            }
            projected += part.source;
            calendarFieldCount += 1;
            discardedTimeSinceCalendar = false;
            continue;
        }
        const previousField = previousFields[part.index];
        const nextField = nextFields[part.index];
        if (
            (previousField === "calendar-field" && nextField === "calendar-field")
            || (previousField === undefined && nextField === "calendar-field")
            || (previousField === "calendar-field" && nextField === undefined)
        ) {
            projected += part.source;
        }
    }
    return calendarFieldCount === 0 ? null : projected;
}

/**
 * Creates a private stable UTC anchor used only by the presentation boundary.
 *
 * @param value - Validated calendar date.
 * @returns - UTC midday anchor carrying the same calendar components.
 */
function createFormattingAnchor(value: CalendarDate): Date {
    const anchor = new Date(0);
    anchor.setUTCFullYear(value.year, value.month - 1, value.day);
    anchor.setUTCHours(12, 0, 0, 0);
    return anchor;
}

/**
 * Formats a calendar date with the stable localized medium date presentation.
 *
 * @param value - Validated calendar date.
 * @param locales - Preferred browser locales.
 * @returns - Localized date-only text.
 */
function systemCalendarFormat(
    value: CalendarDate,
    locales: readonly string[],
): string {
    const formatter = new Intl.DateTimeFormat(
        locales.length === 0 ? undefined : [...locales],
        { dateStyle: "medium", timeZone: "UTC" },
    );
    return formatter.format(createFormattingAnchor(value));
}

/**
 * Formats a calendar date without consulting a configured time zone.
 *
 * @param value - Validated calendar date.
 * @param locales - Preferred browser locales.
 * @param display - Validated format choices; its configured time zone is ignored.
 * @returns - Localized date-only text.
 */
export function formatCalendarDate(
    value: CalendarDate,
    locales: readonly string[],
    display: DisplaySettings = DEFAULT_DISPLAY_SETTINGS,
): string {
    const fallback = systemCalendarFormat(value, locales);
    if (display.formatMode === FORMAT_MODE.SYSTEM) {
        return fallback;
    }
    try {
        const pattern = projectCalendarPattern(display.pattern);
        if (pattern === null) {
            return fallback;
        }
        const text = format(createFormattingAnchor(value), pattern, {
            locale: resolveDateLocale(locales).locale,
            in: tz("UTC"),
        }).trim();
        return text.length === 0 ? fallback : text;
    } catch {
        return fallback;
    }
}
