/**
 * @file Verifies exact-date formatting across locale and time-zone choices.
 */

import { describe, expect, it } from 'vitest';

import {
    formatDateWithPresentation,
    formatDefaultDate,
} from '../../../../src/shared/date/format-default-date';
import { DATE_PRECISION, DEFAULT_PRECISION_POLICY } from '../../../../src/shared/settings/precision-policy';

describe('formatDefaultDate', () => {
    it('matches browser defaults for explicit and runtime-default locales', () => {
        const instant = new Date('2026-08-23T07:15:00.000Z');
        const expectedEnGb = new Intl.DateTimeFormat(['en-GB'], {
            dateStyle: 'medium',
            timeStyle: 'short',
        }).format(instant);
        const expectedRuntimeDefault = new Intl.DateTimeFormat(undefined, {
            dateStyle: 'medium',
            timeStyle: 'short',
        }).format(instant);

        expect(formatDefaultDate(instant, ['en-GB'])).toBe(expectedEnGb);
        expect(formatDefaultDate(instant, [])).toBe(expectedRuntimeDefault);
    });

    it('uses the selected UTC and IANA zones without changing locale conventions', () => {
        const instant = new Date('2026-01-15T12:15:00.000Z');
        const utcExpected = new Intl.DateTimeFormat(['en-GB'], {
            dateStyle: 'medium',
            timeStyle: 'short',
            timeZone: 'UTC',
        }).format(instant);
        const nyExpected = new Intl.DateTimeFormat(['en-US'], {
            dateStyle: 'medium',
            timeStyle: 'short',
            timeZone: 'America/New_York',
        }).format(instant);
        expect(
            formatDateWithPresentation(instant, ['en-GB'], {
                formatMode: 'system',
                timeZone: { mode: 'utc' },
            }).text,
        ).toBe(utcExpected);
        expect(
            formatDateWithPresentation(instant, ['en-US'], {
                formatMode: 'system',
                timeZone: { mode: 'iana', identifier: 'America/New_York' },
            }).text,
        ).toBe(nyExpected);
    });

    it('preserves Unicode hour-cycle preferences for both 24-hour and 12-hour clocks', () => {
        const instant = new Date('2026-08-23T17:15:00.000Z');
        const display = { formatMode: 'system' as const, timeZone: { mode: 'utc' as const } };

        for (const [locale, hour12] of [
            ['en-US-u-hc-h23', false],
            ['en-GB-u-hc-h12', true],
        ] as const) {
            const formatter = new Intl.DateTimeFormat([locale], {
                dateStyle: 'medium',
                timeStyle: 'short',
                timeZone: 'UTC',
            });

            expect(formatter.resolvedOptions().hour12).toBe(hour12);
            expect(formatDateWithPresentation(instant, [locale], display).text).toBe(
                formatter.format(instant),
            );
        }
    });

    it('honors ordered browser locales and falls back past an unsupported valid locale', () => {
        const instant = new Date('2026-08-23T17:15:00.000Z');
        const display = { formatMode: 'system' as const, timeZone: { mode: 'utc' as const } };
        const localeLists = [
            ['en-GB', 'en-US'],
            ['en-US', 'en-GB'],
            ['zz-ZZ', 'en-GB'],
        ] as const;
        const results: string[] = [];

        for (const locales of localeLists) {
            const formatter = new Intl.DateTimeFormat(locales, {
                dateStyle: 'medium',
                timeStyle: 'short',
                timeZone: 'UTC',
            });
            const actual = formatDateWithPresentation(instant, locales, display).text;

            expect(actual).toBe(formatter.format(instant));
            results.push(actual);
        }

        expect(results[0]).not.toBe(results[1]);
        expect(results[2]).toBe(results[0]);
    });

    it('skips the nonexistent New York hour across the spring-forward boundary', () => {
        const formatter = new Intl.DateTimeFormat(['en-GB'], {
            dateStyle: 'medium',
            timeStyle: 'short',
            timeZone: 'America/New_York',
        });
        const display = {
            formatMode: 'system' as const,
            timeZone: { mode: 'iana' as const, identifier: 'America/New_York' },
        };
        const cases = [
            { instant: new Date('2026-03-08T06:59:00.000Z'), hour: '01', minute: '59' },
            { instant: new Date('2026-03-08T07:01:00.000Z'), hour: '03', minute: '01' },
        ] as const;

        for (const { instant, hour, minute } of cases) {
            const parts = formatter.formatToParts(instant);

            expect(formatDateWithPresentation(instant, ['en-GB'], display).text).toBe(
                formatter.format(instant),
            );
            expect(parts.find((part) => part.type === 'year')?.value).toBe('2026');
            expect(parts.find((part) => part.type === 'hour')?.value).toBe(hour);
            expect(parts.find((part) => part.type === 'minute')?.value).toBe(minute);
            expect(parts.some((part) => part.type === 'second')).toBe(false);
        }
    });

    it('falls back to System and reports an unavailable saved zone', () => {
        const instant = new Date('2026-01-15T12:15:00.000Z');
        const expected = formatDefaultDate(instant, ['en-GB']);
        expect(
            formatDateWithPresentation(
                instant,
                ['en-GB'],
                { formatMode: 'system', timeZone: { mode: 'iana', identifier: 'Gone/Zone' } },
                () => false,
            ),
        ).toEqual({ text: expected, error: 'unavailable-time-zone' });
    });

    it('formats custom patterns with locale and one selected zone', () => {
        const before = formatDateWithPresentation(new Date('2026-03-08T06:59:00.000Z'), ['en-US'], {
            formatMode: 'custom',
            pattern: 'yyyy-MM-dd HH:mm XXX',
            timeZone: { mode: 'iana', identifier: 'America/New_York' },
        });
        const after = formatDateWithPresentation(new Date('2026-03-08T07:01:00.000Z'), ['en-US'], {
            formatMode: 'custom',
            pattern: 'yyyy-MM-dd HH:mm XXX',
            timeZone: { mode: 'iana', identifier: 'America/New_York' },
        });
        expect(before).toEqual({ text: '2026-03-08 01:59 -05:00' });
        expect(after).toEqual({ text: '2026-03-08 03:01 -04:00' });
    });

    it('formats both occurrences of the New York fall-back hour', () => {
        const timeZone = 'America/New_York';
        const locales = ['en-GB'];
        const systemFormatter = new Intl.DateTimeFormat(locales, {
            dateStyle: 'medium',
            timeStyle: 'short',
            timeZone,
        });
        const systemDisplay = {
            formatMode: 'system' as const,
            timeZone: { mode: 'iana' as const, identifier: timeZone },
        };
        const customDisplay = {
            formatMode: 'custom' as const,
            pattern: 'yyyy-MM-dd HH:mm XXX',
            timeZone: { mode: 'iana' as const, identifier: timeZone },
        };
        const cases = [
            {
                instant: new Date('2026-11-01T05:30:00.000Z'),
                customText: '2026-11-01 01:30 -04:00',
            },
            {
                instant: new Date('2026-11-01T06:30:00.000Z'),
                customText: '2026-11-01 01:30 -05:00',
            },
        ] as const;

        expect(cases[1].instant.getTime() - cases[0].instant.getTime()).toBe(3_600_000);

        for (const { instant, customText } of cases) {
            expect(formatDateWithPresentation(instant, locales, systemDisplay)).toEqual({
                text: systemFormatter.format(instant),
            });
            expect(formatDateWithPresentation(instant, locales, customDisplay)).toEqual({
                text: customText,
            });
        }
    });

    it('retains the custom pattern when a saved zone is unavailable', () => {
        expect(
            formatDateWithPresentation(
                new Date('2026-01-15T12:15:00.000Z'),
                ['de-DE'],
                {
                    formatMode: 'custom',
                    pattern: 'd MMMM yyyy',
                    timeZone: { mode: 'iana', identifier: 'Gone/Zone' },
                },
                () => false,
            ),
        ).toEqual({ text: '15 Januar 2026', error: 'unavailable-time-zone' });
    });

    it('contains formatter failures and produces no displayable text', () => {
        expect(
            formatDateWithPresentation(new Date('2026-01-15T12:15:00.000Z'), ['en-US'], {
                formatMode: 'custom',
                pattern: 'yyyy ff',
                timeZone: { mode: 'system' },
            }),
        ).toEqual({ text: '', error: 'invalid-format' });
    });
});

describe('formatDateWithPresentation with age precision in system format', () => {
    const instant = new Date('2026-08-23T07:15:42.000Z');
    const now = instant.getTime() + 1;
    const precisionPolicy = {
        ...DEFAULT_PRECISION_POLICY,
        agePrecision: true,
    };
    const utc = { formatMode: 'system' as const, timeZone: { mode: 'utc' as const } };

    /**
     * Formats the instant in UTC with plain Intl, independent of the code under test.
     *
     * @param options - Intl date and time styles.
     *
     * @returns - Expected en-US text.
     */
    function intl(options: Intl.DateTimeFormatOptions): string {
        return new Intl.DateTimeFormat(['en-US'], { ...options, timeZone: 'UTC' }).format(instant);
    }

    it.each([
        [DATE_PRECISION.SECONDS, intl({ dateStyle: 'medium', timeStyle: 'medium' })],
        [DATE_PRECISION.MINUTES, intl({ dateStyle: 'medium', timeStyle: 'short' })],
        [DATE_PRECISION.DAY, intl({ dateStyle: 'medium' })],
        [DATE_PRECISION.YEAR, '2026'],
    ])('limits the age range precision to %s', (precision, expected) => {
        const ranges = [{ hours: 1, precision }];
        expect(formatDateWithPresentation(
            instant,
            ['en-US'],
            { ...utc, precisionPolicy: { ...precisionPolicy, ranges } },
            () => true,
            now,
        )).toEqual({ text: expected });
    });

    it('uses the precision beyond the last range for old timestamps', () => {
        expect(formatDateWithPresentation(
            instant,
            ['en-US'],
            { ...utc, precisionPolicy: { ...precisionPolicy, older: DATE_PRECISION.YEAR } },
            () => true,
            instant.getTime() + 10 * 8760 * 3_600_000,
        )).toEqual({ text: '2026' });
    });

    it('applies the selected named zone to the limited precision', () => {
        const ranges = [{ hours: 1, precision: DATE_PRECISION.MINUTES }];
        const { text } = formatDateWithPresentation(
            instant,
            ['en-US'],
            {
                formatMode: 'system',
                timeZone: { mode: 'iana', identifier: 'Asia/Tokyo' },
                precisionPolicy: { ...precisionPolicy, ranges },
            },
            () => true,
            now,
        );
        expect(text).toBe(new Intl.DateTimeFormat(['en-US'], {
            dateStyle: 'medium',
            timeStyle: 'short',
            timeZone: 'Asia/Tokyo',
        }).format(instant));
        expect(text).not.toBe(intl({ dateStyle: 'medium', timeStyle: 'short' }));
    });

    it('reports an unavailable saved zone and formats in the system zone', () => {
        const ranges = [{ hours: 1, precision: DATE_PRECISION.DAY }];
        expect(formatDateWithPresentation(
            instant,
            ['en-US'],
            {
                formatMode: 'system',
                timeZone: { mode: 'iana', identifier: 'Gone/Zone' },
                precisionPolicy: { ...precisionPolicy, ranges },
            },
            () => false,
            now,
        )).toEqual({
            text: new Intl.DateTimeFormat(['en-US'], { dateStyle: 'medium' }).format(instant),
            error: 'unavailable-time-zone',
        });
    });

    it('falls back to the locale format when a custom pattern has nothing left to show', () => {
        const ranges = [{ hours: 1, precision: DATE_PRECISION.DAY }];
        expect(formatDateWithPresentation(
            instant,
            ['en-US'],
            {
                formatMode: 'custom',
                pattern: 'HH:mm',
                timeZone: { mode: 'utc' },
                precisionPolicy: { ...precisionPolicy, ranges },
            },
            () => true,
            now,
        )).toEqual({ text: intl({ dateStyle: 'medium' }) });
    });
});
