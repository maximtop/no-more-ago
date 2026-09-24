/**
 * @file Validates bounded user-supplied date-fns custom format patterns.
 */

import { format } from 'date-fns';
import { enUS } from 'date-fns/locale/en-US';

/**
 * Named failures returned by custom date-format validation.
 */
export const CUSTOM_FORMAT_ERROR = {
    EMPTY: 'empty',
    TOO_LONG: 'too-long',
    CONTROL_CHARACTER: 'control-character',
    UNCLOSED_QUOTE: 'unclosed-quote',
    MISSING_DATE_TOKEN: 'missing-date-token',
    LEGACY_TOKEN: 'legacy-token',
    INVALID_TOKEN: 'invalid-token',
    EMPTY_OUTPUT: 'empty-output',
} as const;

/**
 * Stable custom date-format validation failure.
 */
export type CustomFormatError = (typeof CUSTOM_FORMAT_ERROR)[keyof typeof CUSTOM_FORMAT_ERROR];

/**
 * User-pattern validation result; successful patterns have passed all bounded safety checks.
 */
export type CustomPatternValidation = | {
    /**
     * Indicates that every custom-pattern validation check passed.
     */
    readonly ok: true;

    /**
     * Validated pattern safe to pass to date-fns.
     */
    readonly pattern: string;
}
    | {
        /**
         * Indicates that the custom pattern was rejected.
         */
        readonly ok: false;

        /**
         * Stable validation failure shown by the options page.
         */
        readonly error: CustomFormatError;
    };

/**
 * Fallback date-fns pattern used when users enable custom formatting without a saved pattern.
 */
export const DEFAULT_CUSTOM_FORMAT_PATTERN = 'yyyy-MM-dd HH:mm' as const;

/**
 * Maximum accepted pattern length, limiting storage and formatter work from user input.
 */
export const CUSTOM_FORMAT_MAX_LENGTH = 256 as const;

// Unicode date-fns field symbols. Keeping this list finite means malformed
// alphabetic input is rejected before it reaches the formatter.
const FORMAT_SYMBOLS = new Set('GyYuURQqMLwIdDEeciahHKkmsSXxXOzPpotTbB');

/**
 * Detects Unicode control characters that are unsafe in a saved pattern.
 *
 * @param character - Unicode code point from the candidate pattern.
 *
 * @returns - Whether the character belongs to the Unicode control category.
 */
function isControl(character: string): boolean {
    return /\p{Cc}/u.test(character);
}

/**
 * Validate one user pattern without constructing a user-controlled RegExp.
 *
 * @param pattern - User-authored custom date-format pattern.
 *
 * @returns - Successful normalized pattern or a specific validation error.
 */
export function validateCustomFormatPattern(pattern: string): CustomPatternValidation {
    if (pattern.trim().length === 0) {
        return { ok: false, error: CUSTOM_FORMAT_ERROR.EMPTY };
    }
    if (pattern.length > CUSTOM_FORMAT_MAX_LENGTH) {
        return { ok: false, error: CUSTOM_FORMAT_ERROR.TOO_LONG };
    }

    let quoted = false;
    let hasToken = false;
    for (let index = 0; index < pattern.length;) {
        const character = pattern[index];
        if (character === undefined) {
            break;
        }
        if (isControl(character)) {
            return { ok: false, error: CUSTOM_FORMAT_ERROR.CONTROL_CHARACTER };
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
            if (run === 'YY' || run === 'YYYY' || run === 'D' || run === 'DD') {
                return { ok: false, error: CUSTOM_FORMAT_ERROR.LEGACY_TOKEN };
            }
            if (!FORMAT_SYMBOLS.has(character)) {
                return { ok: false, error: CUSTOM_FORMAT_ERROR.INVALID_TOKEN };
            }
            hasToken = true;
            index = end;
            continue;
        }
        index += 1;
    }
    if (quoted) {
        return { ok: false, error: CUSTOM_FORMAT_ERROR.UNCLOSED_QUOTE };
    }
    if (!hasToken) {
        return { ok: false, error: CUSTOM_FORMAT_ERROR.MISSING_DATE_TOKEN };
    }

    try {
        const output = format(new Date('2026-01-02T03:04:05.000Z'), pattern, { locale: enUS });
        if (output.trim().length === 0) {
            return { ok: false, error: CUSTOM_FORMAT_ERROR.EMPTY_OUTPUT };
        }
    } catch {
        return { ok: false, error: CUSTOM_FORMAT_ERROR.INVALID_TOKEN };
    }
    return { ok: true, pattern };
}
