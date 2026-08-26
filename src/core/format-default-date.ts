/**
 * @file Formats trusted instants using system or user-selected timezone presentation.
 */

import { format, intlFormat } from "date-fns";
import { tz } from "@date-fns/tz";
import { resolveDateLocale } from "./date-locale";
import type { DisplaySettings } from "../settings/snapshot";

/**
 * Date text together with the time-zone metadata needed to explain a fallback to callers.
 */
export interface DatePresentationResult {

    /**
     * Localized visible timestamp text shown to the user.
     */
    readonly text: string;

    /**
     * Reason a requested time zone could not be applied to the formatted result.
     */
    readonly error?: "unavailable-time-zone" | "invalid-format";
}

/**
 * Capability check for named IANA zones, injectable for deterministic tests.
 */
export type TimeZoneAvailability = (identifier: string) => boolean;

const SYSTEM_DISPLAY: DisplaySettings = Object.freeze({ formatMode: "system", timeZone: Object.freeze({ mode: "system" }) });

/**
 * Formats an instant with the browser's locale and system time zone.
 */
function systemFormat(instant: Date, locales: readonly string[]): string {
    const options = { dateStyle: "medium", timeStyle: "short" } as const;
    return locales.length === 0 ? intlFormat(instant, options) : intlFormat(instant, options, { locale: [...locales] });
}

/**
 * Uses Intl.DateTimeFormat construction to confirm a named zone is supported at runtime.
 */
export function isTimeZoneAvailable(identifier: string): boolean {
    try { new Intl.DateTimeFormat(undefined, { timeZone: identifier }).resolvedOptions(); return true; } catch { return false; }
}

/**
 * Formats an instant through the system locale and time zone; it is the safe fallback for an
 * unavailable named zone or an invalid custom presentation.
 */
export function formatDefaultDate(instant: Date, locales: readonly string[]): string { return systemFormat(instant, locales); }

/**
 * Applies validated display choices and reports an empty result with an error code when a custom
 * pattern fails or a requested named zone is unavailable.
 */
export function formatDateWithPresentation(
    instant: Date,
    locales: readonly string[],
    display: DisplaySettings = SYSTEM_DISPLAY,
    available: TimeZoneAvailability = isTimeZoneAvailable
): DatePresentationResult {
    if (display.formatMode === "system") {
        const zone = display.timeZone;
        if (zone.mode === "system") return { text: systemFormat(instant, locales) };
        if (zone.mode === "iana" && !available(zone.identifier)) return { text: systemFormat(instant, locales), error: "unavailable-time-zone" };
        try {
            const options = { dateStyle: "medium", timeStyle: "short", timeZone: zone.mode === "utc" ? "UTC" : zone.identifier } as const;
            return { text: locales.length === 0 ? intlFormat(instant, options) : intlFormat(instant, options, { locale: [...locales] }) };
        } catch (error) {
            if (zone.mode === "iana" && error instanceof RangeError) return { text: systemFormat(instant, locales), error: "unavailable-time-zone" };
            throw error;
        }
    }
    const zone = display.timeZone;
    if (zone.mode === "iana" && !available(zone.identifier)) {
        try { return { text: format(instant, display.pattern, { locale: resolveDateLocale(locales).locale }), error: "unavailable-time-zone" }; }
        catch { return { text: "", error: "invalid-format" }; }
    }
    try {
        const locale = resolveDateLocale(locales).locale;
        const options = zone.mode === "system" ? { locale } : { locale, in: tz(zone.mode === "utc" ? "UTC" : zone.identifier) };
        const text = format(instant, display.pattern, options);
        return text.trim().length > 0 ? { text } : { text: "", error: "invalid-format" };
    } catch { return { text: "", error: "invalid-format" }; }
}
