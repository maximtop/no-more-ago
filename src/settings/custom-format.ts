/**
 * @file Validates bounded user-supplied date-fns custom format patterns.
 */

import { format } from "date-fns";
import { enUS } from "date-fns/locale/en-US";

/**
 * User-pattern validation result; successful patterns have passed all bounded safety checks.
 */
export type CustomPatternValidation =
  | { readonly ok: true; readonly pattern: string }
  | {
      readonly ok: false;
      readonly error:
        | "empty"
        | "too-long"
        | "control-character"
        | "unclosed-quote"
        | "missing-date-token"
        | "legacy-token"
        | "invalid-token"
        | "empty-output";
  };

/**
 * Fallback date-fns pattern used when users enable custom formatting without a saved pattern.
 */
export const DEFAULT_CUSTOM_FORMAT_PATTERN = "yyyy-MM-dd HH:mm" as const;

/**
 * Maximum accepted pattern length, limiting storage and formatter work from user input.
 */
export const CUSTOM_FORMAT_MAX_LENGTH = 256 as const;

// Unicode date-fns field symbols. Keeping this list finite means malformed
// alphabetic input is rejected before it reaches the formatter.
const FORMAT_SYMBOLS = new Set("GyYuURQqMLwIdDEeciahHKkmsSXxXOzPpotTbB");

/**
 * Detects Unicode control characters that are unsafe in a saved pattern.
 *
 * @param character - Unicode code point from the candidate pattern.
 * @returns - Whether the character belongs to the Unicode control category.
 */
function isControl(character: string): boolean {
    return /\p{Cc}/u.test(character);
}

/**
 * Validate one user pattern without constructing a user-controlled RegExp.
 *
 * @param pattern - Untrusted custom date-format pattern.
 * @returns - Successful normalized pattern or a specific validation error.
 */
export function validateCustomFormatPattern(pattern: unknown): CustomPatternValidation {
    if (typeof pattern !== "string" || pattern.trim().length === 0) {
        return { ok: false, error: "empty" };
    }
    if (pattern.length > CUSTOM_FORMAT_MAX_LENGTH) {
        return { ok: false, error: "too-long" };
    }

    let quoted = false;
    let hasToken = false;
    for (let index = 0; index < pattern.length;) {
        const character = pattern[index];
        if (character === undefined) {
            break;
        }
        if (isControl(character)) {
            return { ok: false, error: "control-character" };
        }

        if (character === "'") {
            if (pattern[index + 1] === "'") {
                index += 2;
                continue;
            }
            quoted = !quoted;
            index += 1;
            continue;
        }
        if (quoted) {
            index += 1;
            continue;
        }
        if (/[A-Za-z]/u.test(character)) {
            let end = index + 1;
            while (end < pattern.length && pattern[end] === character) {
                end += 1;
            }
            const run = pattern.slice(index, end);
            if (run === "YY" || run === "YYYY" || run === "D" || run === "DD") {
                return { ok: false, error: "legacy-token" };
            }
            if (!FORMAT_SYMBOLS.has(character)) {
                return { ok: false, error: "invalid-token" };
            }
            hasToken = true;
            index = end;
            continue;
        }
        index += 1;
    }
    if (quoted) {
        return { ok: false, error: "unclosed-quote" };
    }
    if (!hasToken) {
        return { ok: false, error: "missing-date-token" };
    }

    try {
        const output = format(new Date("2026-01-02T03:04:05.000Z"), pattern, { locale: enUS });
        if (output.trim().length === 0) {
            return { ok: false, error: "empty-output" };
        }
    } catch {
        return { ok: false, error: "invalid-token" };
    }
    return { ok: true, pattern };
}
