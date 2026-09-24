/**
 * @file Projects custom date patterns while preserving field order and safe separators.
 */

import { longFormatters } from 'date-fns/format';

import { DATE_PRECISION, type DatePrecision } from '../settings/precision-policy';

import { resolveDateLocale } from './date-locale';

/**
 * Calendar date-fns field symbols recognized by custom projection.
 */
const CALENDAR_FIELD_SYMBOLS: ReadonlySet<string> = new Set(
    'GyYuURQqMLwIdDEeciP',
);

/**
 * Time, zone, and instant date-fns field symbols recognized by custom projection.
 */
const TIME_FIELD_SYMBOLS: ReadonlySet<string> = new Set(
    'abBhHKkmsSXxOztTp',
);

/**
 * One classified fragment from a validated custom pattern.
 */
interface PrecisionPatternPart {
    /**
     * Whether projection retains a field or associates a literal with nearby fields.
     */
    readonly kind: 'retained-field' | 'removed-field' | 'literal';

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
 *
 * @returns - Whether the character is an ASCII letter.
 */
function isFieldCharacter(character: string): boolean {
    return /[A-Za-z]/u.test(character);
}

/**
 * Tokenizes a validated date-fns pattern without interpreting page data.
 *
 * @param pattern - Validated bounded custom pattern.
 * @param precision - Maximum output precision.
 *
 * @returns - Classified exact fragments, or null when projection cannot proceed safely.
 */
function tokenizePrecisionPattern(
    pattern: string,
    precision: DatePrecision,
): readonly PrecisionPatternPart[] | null {
    const parts: PrecisionPatternPart[] = [];
    let offset = 0;
    while (offset < pattern.length) {
        const character = pattern[offset];
        if (character === undefined) {
            return null;
        }
        if (character === "'") {
            if (pattern[offset + 1] === "'") {
                parts.push({ kind: 'literal', source: "''", index: parts.length });
                offset += 2;
            } else {
                let end = offset + 1;
                let closed = false;
                while (end < pattern.length) {
                    if (pattern[end] !== "'") {
                        end += 1;
                    } else if (pattern[end + 1] === "'") {
                        end += 2;
                    } else {
                        end += 1;
                        closed = true;
                        break;
                    }
                }
                if (!closed) {
                    return null;
                }
                parts.push({
                    kind: 'literal',
                    source: pattern.slice(offset, end),
                    index: parts.length,
                });
                offset = end;
            }
        } else if (isFieldCharacter(character)) {
            const retainedField = precision === DATE_PRECISION.YEAR
                ? 'GyYuUR'.includes(character)
                : CALENDAR_FIELD_SYMBOLS.has(character)
                    || (precision !== DATE_PRECISION.DAY
                        && 'abBhHKkmXxOz'.includes(character))
                    || (precision === DATE_PRECISION.SECONDS && character === 's');
            const knownField = TIME_FIELD_SYMBOLS.has(character)
                || CALENDAR_FIELD_SYMBOLS.has(character);
            if (!retainedField && !knownField) {
                return null;
            }
            let end = offset + 1;
            while (pattern[end] === character) {
                end += 1;
            }
            if (character !== 'P' && character !== 'p' && pattern[end] === 'o') {
                end += 1;
            }
            parts.push({
                kind: retainedField ? 'retained-field' : 'removed-field',
                source: pattern.slice(offset, end),
                index: parts.length,
            });
            offset = end;
        } else {
            let end = offset + 1;
            while (
                end < pattern.length
                && pattern[end] !== "'"
                && !isFieldCharacter(pattern[end] ?? '')
            ) {
                end += 1;
            }
            parts.push({
                kind: 'literal',
                source: pattern.slice(offset, end),
                index: parts.length,
            });
            offset = end;
        }
    }
    return parts;
}

/**
 * Projects a custom pattern to its selected precision, retaining date order and literals.
 *
 * @param pattern - Validated bounded custom pattern.
 * @param precision - Maximum output precision.
 * @param locales - Preferred locales for expanding localized pattern tokens.
 *
 * @returns - Usable projected pattern, or null for localized fallback.
 */
export function projectPrecisionPattern(
    pattern: string,
    precision: DatePrecision,
    locales: readonly string[] = [],
): string | null {
    const { locale } = resolveDateLocale(locales);
    const expanded = (pattern.match(/P+p+|P+|p+|''|'(?:''|[^'])*'|./gu) ?? [])
        .map((fragment) => {
            const symbol = fragment[0];
            if (symbol !== 'P' && symbol !== 'p') {
                return fragment;
            }
            const expand = longFormatters[symbol];
            if (!expand) {
                throw new Error('Missing localized date formatter');
            }
            return expand(fragment, locale.formatLong);
        }).join('');
    const parts = tokenizePrecisionPattern(expanded, precision);
    if (!parts) {
        return null;
    }
    const previousFields: (PrecisionPatternPart['kind'] | undefined)[] = [];
    const nextFields: (PrecisionPatternPart['kind'] | undefined)[] = [];
    let nearestField: PrecisionPatternPart['kind'] | undefined;
    for (const part of parts) {
        previousFields[part.index] = nearestField;
        if (part.kind !== 'literal') {
            nearestField = part.kind;
        }
    }
    nearestField = undefined;
    for (let index = parts.length - 1; index >= 0; index -= 1) {
        const part = parts[index];
        if (part) {
            nextFields[part.index] = nearestField;
            if (part.kind !== 'literal') {
                nearestField = part.kind;
            }
        }
    }

    let projected = '';
    let retainedFieldCount = 0;
    let discardedSinceRetained = false;
    for (const part of parts) {
        if (part.kind === 'removed-field') {
            if (retainedFieldCount > 0) {
                discardedSinceRetained = true;
            }
        } else if (part.kind === 'retained-field') {
            if (discardedSinceRetained) {
                projected = `${projected.trimEnd()} `;
            }
            projected += part.source;
            retainedFieldCount += 1;
            discardedSinceRetained = false;
        } else {
            const previousField = previousFields[part.index];
            const nextField = nextFields[part.index];
            if (
                (previousField === 'retained-field' && nextField === 'retained-field')
                || (previousField === undefined && nextField === 'retained-field')
                || (previousField === 'retained-field' && nextField === undefined)
            ) {
                projected += part.source;
            }
        }
    }
    return retainedFieldCount === 0 ? null : projected.trim();
}
