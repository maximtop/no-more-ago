/**
 * @file Exercises optional absolute labels and precision through document processing.
 */

import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';

import { genericTimeRule } from '../../../../src/content-script/adapters/generic-time';
import { AdapterRegistry } from '../../../../src/content-script/adapters/registry';
import {
    TIMESTAMP_VALIDATION_RULE,
    type TimestampSourceRule,
} from '../../../../src/content-script/adapters/types';
import { processDocument } from '../../../../src/content-script/transformation/process-document';
import {
    restoreTimestampPresentations,
} from '../../../../src/content-script/transformation/render-timestamp-presentation';
import {
    DEFAULT_PRECISION_POLICY,
    DATE_PRECISION,
    type PrecisionPolicy,
} from '../../../../src/shared/settings/precision-policy';
import {
    FORMAT_MODE, TIME_ZONE_MODE, type DisplaySettings,
} from '../../../../src/shared/settings/snapshot';

const instant = '2026-08-22T09:19:17Z';
const now = new Date('2026-08-23T09:19:17Z');
const expanded: PrecisionPolicy = { ...DEFAULT_PRECISION_POLICY, absoluteLabels: true };
const aged: PrecisionPolicy = {
    ...DEFAULT_PRECISION_POLICY,
    agePrecision: true,
    ranges: [
        { hours: 24, precision: DATE_PRECISION.SECONDS },
        { hours: 48, precision: DATE_PRECISION.MINUTES },
        { hours: 72, precision: DATE_PRECISION.DAY },
    ],
};
const display: DisplaySettings = {
    formatMode: FORMAT_MODE.CUSTOM,
    pattern: 'yyyy-MM-dd HH:mm:ss',
    timeZone: { mode: TIME_ZONE_MODE.UTC },
};

/**
 * Processes one standard timestamp through the production transformation boundary.
 *
 * @param label - Existing page-owned label.
 * @param settings - Display choices.
 * @param datetime - Machine-supplied value.
 *
 * @returns - Generated timestamp elements.
 *
 * @throws If the document has no timestamp source.
 */
function processLabel(label: string, settings = display, datetime = instant) {
    document.body.innerHTML = `<time datetime="${datetime}"></time>`;
    const source = document.querySelector('time');
    if (!source) {
        throw new Error('Expected timestamp source');
    }
    source.textContent = label;
    return processDocument({
        url: new URL('https://example.test'),
        root: document,
        locales: ['en-US'],
        display: settings,
    });
}

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    document.documentElement.lang = 'en';
});

afterEach(() => {
    restoreTimestampPresentations(document);
    document.body.innerHTML = '';
    document.documentElement.removeAttribute('lang');
    vi.useRealTimers();
});

describe('absolute date policy', () => {
    it('keeps absolute dates unchanged by default and processes relative labels', () => {
        expect(processLabel('Aug 22, 2026')).toHaveLength(0);
        expect(processLabel('1 day ago')[0]?.textContent).toBe('2026-08-22 09:19:17');
    });

    it.each([
        'Aug 22, 2026',
        '2026-08-22',
        '2026-08-22 09:19',
    ])('expands the existing incomplete label %s only after opting in', (label) => {
        expect(processLabel(label, { ...display, precisionPolicy: expanded })[0]?.textContent)
            .toBe('2026-08-22 09:19:17');
    });

    it.each([
        '',
        'Unknown',
        '2026-08-22 09:19:17',
        '09:19',
        'Aug 21, 2026',
    ])('leaves empty, unknown, complete, clock-only, or mismatched labels alone: %s', (label) => {
        expect(processLabel(label, { ...display, precisionPolicy: expanded })).toHaveLength(0);
    });

    it('does not infer a missing zone or invent seconds missing from the source', () => {
        expect(processLabel(
            'Aug 22, 2026',
            { ...display, precisionPolicy: expanded },
            '2026-08-22T09:19:17',
        )).toHaveLength(0);
        expect(processLabel(
            '2026-08-22 09:19',
            { ...display, precisionPolicy: expanded },
            '2026-08-22T09:19Z',
        )).toHaveLength(0);
    });

    it('restores the original label after the policy is disabled', () => {
        expect(processLabel('Aug 22, 2026', {
            ...display, precisionPolicy: expanded,
        })).toHaveLength(1);
        expect(processDocument({
            url: new URL('https://example.test'),
            root: document,
            locales: ['en-US'],
            display,
        })).toHaveLength(0);
        expect(document.body.textContent).toBe('Aug 22, 2026');
    });

    it('recognizes a localized absolute date using the page language', () => {
        document.documentElement.lang = 'de';
        expect(processLabel('22. August 2026', {
            ...display, precisionPolicy: expanded,
        })[0]?.textContent).toBe('2026-08-22 09:19:17');
    });

    it("preserves regional date recognition and the source offset's calendar day", () => {
        document.documentElement.lang = 'en-GB';
        expect(processLabel('22 Aug 2026', {
            ...display, precisionPolicy: expanded,
        })[0]?.textContent).toBe('2026-08-22 09:19:17');
        document.documentElement.lang = 'en';
        expect(processLabel('Aug 22, 2026', {
            ...display, precisionPolicy: expanded,
        }, '2026-08-22T00:19:17+0300')[0]?.textContent).toBe('2026-08-21 21:19:17');
    });

    it('keeps calendar-only sources date-only and never expands their absolute labels', () => {
        const calendarRule: TimestampSourceRule = {
            ...genericTimeRule,
            extract: (source) => {
                const candidate = genericTimeRule.extract(source);
                return candidate && candidate.validationRule
                    !== TIMESTAMP_VALIDATION_RULE.DERIVED_UNIX_MILLISECONDS ? {
                        ...candidate, validationRule: TIMESTAMP_VALIDATION_RULE.CALENDAR_DATE,
                    } : null;
            },
        };
        const registry = new AdapterRegistry([], calendarRule);
        document.body.innerHTML = '<time datetime="2026-08-22">1 day ago</time>';
        const input = {
            url: new URL('https://example.test'),
            root: document,
            locales: ['en-US'],
            registry,
            display: { ...display, precisionPolicy: { ...aged, absoluteLabels: true } },
        };
        expect(processDocument(input)[0]?.textContent).toBe('2026-08-22');
        restoreTimestampPresentations(document);
        const source = document.querySelector('time');
        if (!source) {
            throw new Error('Expected source');
        }
        source.textContent = 'Aug 22, 2026';
        expect(processDocument(input)).toHaveLength(0);
    });
});

describe('age-based output', () => {
    it.each([
        [0, '2026-08-22 09:19:17'],
        [1, '2026-08-22 09:19'],
        [86_400_000, '2026-08-22 09:19'],
        [86_400_001, '2026-08-22'],
        [172_800_000, '2026-08-22'],
        [172_800_001, '2026'],
    ])('honors inclusive boundaries with now shifted by %s ms', (shift, expected) => {
        vi.setSystemTime(now.getTime() + shift);
        expect(processLabel('1 day ago', { ...display, precisionPolicy: aged })[0]?.textContent)
            .toBe(expected);
    });

    it('uses one age boundary for identical timestamps in the same document pass', () => {
        document.body.innerHTML = [1, 2].map(() => `<time datetime="${instant}">1 day ago</time>`).join('');
        vi.spyOn(Date, 'now')
            .mockReturnValueOnce(now.getTime())
            .mockReturnValue(now.getTime() + 1);
        const outputs = processDocument({
            url: new URL('https://example.test'),
            root: document,
            locales: ['en-US'],
            display: { ...display, precisionPolicy: aged },
        });
        expect(outputs.map((output) => output.textContent))
            .toEqual(['2026-08-22 09:19:17', '2026-08-22 09:19:17']);
    });

    it('uses the first range for future timestamps without enabling absolute labels', () => {
        expect(processLabel(
            'in 1 day',
            { ...display, precisionPolicy: aged },
            '2026-08-24T09:19:17Z',
        )[0]?.textContent).toBe('2026-08-24 09:19:17');
        expect(processLabel('Aug 22, 2026', { ...display, precisionPolicy: aged })).toHaveLength(0);
    });

    it('preserves locale and configured time zone for system formatting', () => {
        const settings: DisplaySettings = {
            formatMode: FORMAT_MODE.SYSTEM,
            timeZone: { mode: TIME_ZONE_MODE.IANA, identifier: 'Pacific/Honolulu' },
            precisionPolicy: aged,
        };
        const expected = new Intl.DateTimeFormat('en-US', {
            dateStyle: 'medium', timeStyle: 'medium', timeZone: 'Pacific/Honolulu',
        }).format(new Date(instant));
        expect(processLabel('1 day ago', settings)[0]?.textContent).toBe(expected);
    });

    it.each([
        ['dd/MM/yyyy HH:mm:ss', '21/08/2026'],
        ["EEEE, d MMMM yyyy 'at' h:mm:ss a", 'Friday, 21 August 2026'],
        ['PPpp', 'Aug 21, 2026'],
    ])('preserves custom date order, locale and zone for %s', (pattern, expected) => {
        vi.setSystemTime(now.getTime() + 86_400_001);
        expect(processLabel('3 days ago', {
            formatMode: FORMAT_MODE.CUSTOM,
            pattern,
            timeZone: { mode: TIME_ZONE_MODE.IANA, identifier: 'Pacific/Honolulu' },
            precisionPolicy: aged,
        })[0]?.textContent).toBe(expected);
    });
});
