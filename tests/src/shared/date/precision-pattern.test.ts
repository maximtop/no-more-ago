/**
 * @file Verifies how custom date patterns are cut down to a maximum output precision.
 */

import { describe, expect, it } from 'vitest';

import { projectPrecisionPattern } from '../../../../src/shared/date/precision-pattern';
import { DATE_PRECISION } from '../../../../src/shared/settings/precision-policy';

describe('projectPrecisionPattern', () => {
    it.each([
        ['seconds keep every field', 'yyyy-MM-dd HH:mm:ss', DATE_PRECISION.SECONDS, 'yyyy-MM-dd HH:mm:ss'],
        ['minutes drop seconds and their separator', 'yyyy-MM-dd HH:mm:ss', DATE_PRECISION.MINUTES, 'yyyy-MM-dd HH:mm'],
        ['day drops the whole clock', 'yyyy-MM-dd HH:mm:ss', DATE_PRECISION.DAY, 'yyyy-MM-dd'],
        ['year keeps only the year', 'yyyy-MM-dd HH:mm:ss', DATE_PRECISION.YEAR, 'yyyy'],
        ['a trailing clock separator goes with the clock', 'dd.MM.yyyy, HH:mm', DATE_PRECISION.DAY, 'dd.MM.yyyy'],
        ['a leading clock is dropped with its separator', 'HH:mm dd/MM/yyyy', DATE_PRECISION.DAY, 'dd/MM/yyyy'],
        ['zone and meridiem go with the clock', 'yyyy-MM-dd h:mm a XXX', DATE_PRECISION.DAY, 'yyyy-MM-dd'],
        ['a zone stays while minutes show', 'yyyy-MM-dd HH:mm XXX', DATE_PRECISION.MINUTES, 'yyyy-MM-dd HH:mm XXX'],
        ['quoted literals between kept fields survive', "yyyy 'at' HH:mm", DATE_PRECISION.MINUTES, "yyyy 'at' HH:mm"],
        ['a doubled apostrophe is a literal', "yyyy''MM", DATE_PRECISION.DAY, "yyyy''MM"],
    ])('%s', (_name, pattern, precision, expected) => {
        expect(projectPrecisionPattern(pattern, precision)).toBe(expected);
    });

    it.each([
        ['a clock-only pattern at day precision', 'HH:mm', DATE_PRECISION.DAY],
        ['a clock-only pattern at year precision', 'HH:mm', DATE_PRECISION.YEAR],
        ['a month-only pattern at year precision', 'MMMM', DATE_PRECISION.YEAR],
        ['an unterminated quote', "yyyy 'at", DATE_PRECISION.DAY],
        ['an unknown field letter', 'yyyy Z', DATE_PRECISION.DAY],
        ['a literal-only pattern', "'today'", DATE_PRECISION.DAY],
    ])('falls back to the locale format for %s', (_name, pattern, precision) => {
        expect(projectPrecisionPattern(pattern, precision)).toBeNull();
    });

    it('expands localized long-date tokens before projecting them', () => {
        expect(projectPrecisionPattern('PP', DATE_PRECISION.YEAR, ['en-US'])).toBe('y');
        expect(projectPrecisionPattern('PPpp', DATE_PRECISION.DAY, ['en-US'])).toBe('MMM d, y');
        expect(projectPrecisionPattern('PPpp', DATE_PRECISION.DAY, ['de-DE'])).toBe('do MMM y');
    });
});
