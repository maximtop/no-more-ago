/**
 * @file Verifies settings snapshot construction and user-authored domain validation.
 */

import { describe, expect, it } from 'vitest';

import { DEFAULT_SITE_SCOPE, SITE_SCOPE_MODE } from '../../../../src/shared/settings/site-scope';
import {
    APPEARANCE,
    DEFAULT_DISPLAY_SETTINGS,
    DEFAULT_SETTINGS_SNAPSHOT,
    SETTINGS_SCHEMA_VERSION,
    createSettingsSnapshot,
    isCurrentSettingsSnapshot,
    isDisplaySettings,
    isStructurallyValidTimeZoneIdentifier,
    isTimeZoneSelection,
    parseDisplaySettings,
    parseTimeZoneSelection,
    type DisplaySettings,
    type TimeZoneSelection,
} from '../../../../src/shared/settings/snapshot';

const display = (mode: 'system' | 'utc' | 'iana', identifier?: string): DisplaySettings => ({
    formatMode: 'system' as const,
    timeZone: mode === 'iana' ? { mode, identifier: identifier ?? 'America/New_York' } : { mode },
});

describe('Settings Snapshot', () => {
    it('uses one frozen default with the default scope and system appearance', () => {
        expect(DEFAULT_SETTINGS_SNAPSHOT).toEqual({
            schemaVersion: SETTINGS_SCHEMA_VERSION,
            revision: 0,
            globalEnabled: true,
            siteScope: DEFAULT_SITE_SCOPE,
            display: DEFAULT_DISPLAY_SETTINGS,
            appearance: APPEARANCE.SYSTEM,
            debugEnabled: false,
        });
        expect(Object.isFrozen(DEFAULT_SETTINGS_SNAPSHOT)).toBe(true);
        expect(Object.isFrozen(DEFAULT_SETTINGS_SNAPSHOT.siteScope)).toBe(true);
        expect(Object.isFrozen(DEFAULT_SETTINGS_SNAPSHOT.display)).toBe(true);
    });

    it('preserves strict display and time-zone validation', () => {
        expect(
            parseDisplaySettings({
                formatMode: 'custom',
                pattern: 'do MMMM yyyy',
                timeZone: { mode: 'utc' },
            }),
        ).not.toBeNull();
        expect(
            parseDisplaySettings({
                formatMode: 'custom',
                pattern: 'YYYY-MM-dd',
                timeZone: { mode: 'utc' },
            }),
        ).toBeNull();
    });

    it('constructs a snapshot while preserving every field', () => {
        expect(
            createSettingsSnapshot({
                revision: 3,
                globalEnabled: false,
                siteScope: {
                    mode: SITE_SCOPE_MODE.SELECTED_ONLY,
                    excludedSites: ['excluded.test'],
                    allowedSites: ['github.com'],
                },
                display: display('utc'),
                appearance: APPEARANCE.DARK,
                debugEnabled: true,
            }),
        ).toEqual({
            schemaVersion: SETTINGS_SCHEMA_VERSION,
            revision: 3,
            globalEnabled: false,
            siteScope: {
                mode: SITE_SCOPE_MODE.SELECTED_ONLY,
                excludedSites: ['excluded.test'],
                allowedSites: ['github.com'],
            },
            display: display('utc'),
            appearance: APPEARANCE.DARK,
            debugEnabled: true,
        });
        expect(() => createSettingsSnapshot({ revision: -1, globalEnabled: true }))
            .toThrow(TypeError);
        expect(() => createSettingsSnapshot({
            revision: 1,
            globalEnabled: true,
            siteScope: {
                mode: SITE_SCOPE_MODE.ALL_EXCEPT_EXCLUDED,
                excludedSites: ['EXAMPLE.COM'],
                allowedSites: [],
            },
        })).toThrow(TypeError);
    });

    it('accepts only the current schema version at the storage boundary', () => {
        expect(isCurrentSettingsSnapshot(DEFAULT_SETTINGS_SNAPSHOT)).toBe(true);
        expect(isCurrentSettingsSnapshot({ ...DEFAULT_SETTINGS_SNAPSHOT, schemaVersion: 6 }))
            .toBe(false);
        expect(isCurrentSettingsSnapshot(undefined)).toBe(false);
        expect(isCurrentSettingsSnapshot(null)).toBe(false);
        expect(isCurrentSettingsSnapshot('settings')).toBe(false);
    });
});

describe('strict schema and policy boundaries', () => {
    it.each([
        -1,
        Number.NaN,
        Number.POSITIVE_INFINITY,
        Number.MAX_SAFE_INTEGER + 1,
        1.5,
    ])('rejects unsafe revision %s', (revision) => {
        expect(() => createSettingsSnapshot({ revision, globalEnabled: true }))
            .toThrow(TypeError);
    });
});

describe('display and timezone snapshot validation', () => {
    it.each([
        { formatMode: 'system', timeZone: { mode: 'system' } },
        { formatMode: 'system', timeZone: { mode: 'utc' } },
        { formatMode: 'system', timeZone: { mode: 'iana', identifier: 'America/New_York' } },
        { formatMode: 'system', timeZone: { mode: 'iana', identifier: 'CET' } },
        { formatMode: 'custom', pattern: 'yyyy-MM-dd HH:mm', timeZone: { mode: 'utc' } },
        {
            formatMode: 'custom',
            pattern: "EEEE, do MMMM yyyy 'at' HH:mm",
            timeZone: { mode: 'iana', identifier: 'Europe/Nicosia' },
        },
    ] satisfies readonly DisplaySettings[])('accepts valid display discriminant %o', (value) => {
        expect(isDisplaySettings(value)).toBe(true);
        expect(parseDisplaySettings(value)).not.toBeNull();
    });

    it.each([
        'yyyy-MM-dd',
        'dd/MM/yyyy HH:mm',
        'EEEE, d MMMM yyyy',
        "do MMMM yyyy 'at' HH:mm",
        "yyyy '' MM",
        't',
        'yyyy-MM-dd XXX',
    ])('accepts bounded Unicode custom pattern %s', (pattern) => {
        expect(
            parseDisplaySettings({ formatMode: 'custom', pattern, timeZone: { mode: 'utc' } }),
        ).toMatchObject({ formatMode: 'custom', pattern });
    });

    it.each([
        '',
        '   ',
        'x'.repeat(257),
        `yyyy-MM-dd${String.fromCharCode(0)}`,
        "yyyy-MM-dd '",
        'yyyy-MM-dd J',
        'YYYY-MM-dd',
        'yyyy-DD-dd',
        'yyyy D',
        "'literal'",
        "'-'",
    ])('rejects bounded/legacy/invalid custom pattern %s', (pattern) => {
        expect(
            parseDisplaySettings({ formatMode: 'custom', pattern, timeZone: { mode: 'utc' } }),
        ).toBeNull();
    });

    it.each([
        { mode: 'system' },
        { mode: 'utc' },
        { mode: 'iana', identifier: 'UTC' },
        { mode: 'iana', identifier: 'America/New_York' },
        { mode: 'iana', identifier: 'Etc/GMT+5' },
        { mode: 'iana', identifier: 'US/Eastern' },
        { mode: 'iana', identifier: 'Historical/Unavailable/Zone' },
    ] satisfies readonly TimeZoneSelection[])(
        'accepts structurally safe timezone selection %o',
        (value) => {
            expect(isTimeZoneSelection(value)).toBe(true);
            expect(parseTimeZoneSelection(value)).not.toBeNull();
        },
    );

    it.each([
        '',
        ' UTC',
        'UTC ',
        'A//B',
        '/UTC',
        'UTC/',
        'A/../B',
        'A/./B',
        'A\\B',
        'A B',
        '1Europe',
        `Europe/${String.fromCharCode(0)}City`,
    ])('rejects unsafe timezone identifier %s', (identifier) => {
        expect(isStructurallyValidTimeZoneIdentifier(identifier)).toBe(false);
        expect(parseTimeZoneSelection({ mode: 'iana', identifier })).toBeNull();
    });

    it('accepts structurally valid historical zones without checking ICU availability', () => {
        const value: TimeZoneSelection = {
            mode: 'iana',
            identifier: 'Historical/Unavailable/Zone',
        };
        expect(parseDisplaySettings({ formatMode: 'system', timeZone: value })).not.toBeNull();
    });

    it('freezes parsed nested display and timezone values', () => {
        const snapshot = createSettingsSnapshot({
            revision: 0,
            globalEnabled: true,
            display: {
                formatMode: 'custom',
                pattern: 'yyyy-MM-dd',
                timeZone: { mode: 'iana', identifier: 'UTC' },
            },
        });
        expect(Object.isFrozen(snapshot)).toBe(true);
        expect(Object.isFrozen(snapshot.display)).toBe(true);
        expect(Object.isFrozen(snapshot.display.timeZone)).toBe(true);
    });
});
