/**
 * @file Verifies age-range validation, comparison, and inclusive age thresholds.
 */

import { describe, expect, it } from 'vitest';

import {
    DATE_PRECISION,
    DEFAULT_PRECISION_POLICY,
    isPrecisionPolicyValid,
    MAX_AGE_RANGES,
    precisionForAge,
    samePrecisionPolicy,
    type AgeRange,
    type PrecisionPolicy,
} from '../../../../src/shared/settings/precision-policy';

const HOUR_MS = 3_600_000;
const NOW = Date.UTC(2026, 7, 30, 12, 0, 0);

/**
 * Builds a policy that differs from the default only where a test names it.
 *
 * @param overrides - Fields the test cares about.
 *
 * @returns - Complete policy.
 */
function policy(overrides: Partial<PrecisionPolicy> = {}): PrecisionPolicy {
    return { ...DEFAULT_PRECISION_POLICY, ...overrides };
}

describe('isPrecisionPolicyValid', () => {
    it('accepts the default policy', () => {
        expect(isPrecisionPolicyValid(DEFAULT_PRECISION_POLICY)).toBe(true);
    });

    it('accepts one range and the maximum number of ranges', () => {
        expect(isPrecisionPolicyValid(policy({
            ranges: [{ hours: 1, precision: DATE_PRECISION.SECONDS }],
        }))).toBe(true);
        const ranges: AgeRange[] = Array.from({ length: MAX_AGE_RANGES }, (_, index) => ({
            hours: index + 1,
            precision: DATE_PRECISION.DAY,
        }));
        expect(isPrecisionPolicyValid(policy({ ranges }))).toBe(true);
    });

    it('rejects no ranges and more ranges than the cap', () => {
        expect(isPrecisionPolicyValid(policy({ ranges: [] }))).toBe(false);
        const ranges: AgeRange[] = Array.from({ length: MAX_AGE_RANGES + 1 }, (_, index) => ({
            hours: index + 1,
            precision: DATE_PRECISION.DAY,
        }));
        expect(isPrecisionPolicyValid(policy({ ranges }))).toBe(false);
    });

    it.each([
        ['equal bounds', [1, 1]],
        ['descending bounds', [2, 1]],
        ['a zero bound', [0, 1]],
        ['a negative bound', [-1, 1]],
        ['a NaN bound', [1, Number.NaN]],
        ['an infinite bound', [1, Number.POSITIVE_INFINITY]],
    ])('rejects %s', (_name, bounds) => {
        const ranges = bounds.map((hours) => ({ hours, precision: DATE_PRECISION.DAY }));
        expect(isPrecisionPolicyValid(policy({ ranges }))).toBe(false);
    });

    it('accepts fractional strictly increasing bounds', () => {
        const ranges = [0.5, 1.5].map((hours) => ({ hours, precision: DATE_PRECISION.DAY }));
        expect(isPrecisionPolicyValid(policy({ ranges }))).toBe(true);
    });
});

describe('samePrecisionPolicy', () => {
    it('treats omitted policies as the default and equal copies as the same', () => {
        expect(samePrecisionPolicy()).toBe(true);
        expect(samePrecisionPolicy(undefined, policy({ ranges: [...DEFAULT_PRECISION_POLICY.ranges] })))
            .toBe(true);
    });

    it.each([
        ['absoluteLabels', policy({ absoluteLabels: true })],
        ['agePrecision', policy({ agePrecision: true })],
        ['older', policy({ older: DATE_PRECISION.DAY })],
        ['range hours', policy({
            ranges: [{ hours: 25, precision: DATE_PRECISION.SECONDS }, ...DEFAULT_PRECISION_POLICY.ranges.slice(1)],
        })],
        ['range precision', policy({
            ranges: [{ hours: 24, precision: DATE_PRECISION.DAY }, ...DEFAULT_PRECISION_POLICY.ranges.slice(1)],
        })],
        ['range count', policy({ ranges: DEFAULT_PRECISION_POLICY.ranges.slice(0, 2) })],
    ])('detects a difference in %s', (_name, other) => {
        expect(samePrecisionPolicy(DEFAULT_PRECISION_POLICY, other)).toBe(false);
        expect(samePrecisionPolicy(other, DEFAULT_PRECISION_POLICY)).toBe(false);
    });
});

describe('precisionForAge', () => {
    const enabled = policy({
        agePrecision: true,
        ranges: [
            { hours: 1, precision: DATE_PRECISION.SECONDS },
            { hours: 24, precision: DATE_PRECISION.MINUTES },
        ],
        older: DATE_PRECISION.YEAR,
    });

    it('does nothing when age precision is off or the policy is absent', () => {
        expect(precisionForAge(new Date(NOW), undefined, NOW)).toBeUndefined();
        expect(precisionForAge(new Date(NOW), policy({ ...enabled, agePrecision: false }), NOW))
            .toBeUndefined();
    });

    it.each([
        ['just now', 0, DATE_PRECISION.SECONDS],
        ['exactly on the first bound', HOUR_MS, DATE_PRECISION.SECONDS],
        ['1 ms past the first bound', HOUR_MS + 1, DATE_PRECISION.MINUTES],
        ['exactly on the last bound', 24 * HOUR_MS, DATE_PRECISION.MINUTES],
        ['1 ms past the last bound', 24 * HOUR_MS + 1, DATE_PRECISION.YEAR],
    ])('picks the range for a timestamp %s old', (_name, ageMs, expected) => {
        expect(precisionForAge(new Date(NOW - ageMs), enabled, NOW)).toBe(expected);
    });

    it('treats a timestamp in the future as brand new', () => {
        expect(precisionForAge(new Date(NOW + 5 * HOUR_MS), enabled, NOW)).toBe(DATE_PRECISION.SECONDS);
    });
});
