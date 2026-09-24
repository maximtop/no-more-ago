/**
 * @file Opt-in label expansion and age-based output precision contracts.
 */

/**
 * Named output precision levels, ordered from coarse to fine.
 */
export const DATE_PRECISION = {
    YEAR: 'year',
    DAY: 'day',
    MINUTES: 'minutes',
    SECONDS: 'seconds',
} as const;

/**
 * Supported output precision choices.
 */
export const DATE_PRECISIONS = Object.values(DATE_PRECISION);

/**
 * Precision of a rendered timestamp.
 */
export type DatePrecision = (typeof DATE_PRECISION)[keyof typeof DATE_PRECISION];

/**
 * Maximum number of editable age ranges.
 */
export const MAX_AGE_RANGES = 4;

/**
 * One inclusive age bound and its output precision.
 */
export interface AgeRange {
    /**
     * Inclusive upper bound measured in elapsed hours.
     */
    readonly hours: number;

    /**
     * Maximum output precision within this range.
     */
    readonly precision: DatePrecision;
}

/**
 * Independent opt-in policies for labels and output precision.
 */
export interface PrecisionPolicy {
    /**
     * Allows existing incomplete absolute date labels to be expanded.
     */
    readonly absoluteLabels: boolean;

    /**
     * Enables precision selection by timestamp age.
     */
    readonly agePrecision: boolean;

    /**
     * Strictly increasing inclusive upper bounds.
     */
    readonly ranges: readonly AgeRange[];

    /**
     * Precision used beyond the last bound.
     */
    readonly older: DatePrecision;
}

/**
 * Defaults preserve relative-only processing and the saved format.
 */
export const DEFAULT_PRECISION_POLICY: PrecisionPolicy = Object.freeze({
    absoluteLabels: false,
    agePrecision: false,
    ranges: Object.freeze([
        Object.freeze({ hours: 24, precision: DATE_PRECISION.SECONDS }),
        Object.freeze({ hours: 720, precision: DATE_PRECISION.MINUTES }),
        Object.freeze({ hours: 8760, precision: DATE_PRECISION.DAY }),
    ]),
    older: DATE_PRECISION.YEAR,
});

/**
 * Validates user-authored range bounds without revalidating internal object shapes.
 *
 * @param policy - Typed policy from the settings form.
 *
 * @returns - Whether thresholds and precision choices satisfy the domain.
 */
export function isPrecisionPolicyValid(policy: PrecisionPolicy): boolean {
    if (policy.ranges.length === 0 || policy.ranges.length > MAX_AGE_RANGES) {
        return false;
    }
    let previous = 0;
    for (const range of policy.ranges) {
        if (!Number.isFinite(range.hours) || range.hours <= previous
            || !DATE_PRECISIONS.includes(range.precision)) {
            return false;
        }
        previous = range.hours;
    }
    return DATE_PRECISIONS.includes(policy.older);
}

/**
 * Compares effective policies, including inactive ranges retained for later use.
 *
 * @param a - First policy, or the default policy when omitted.
 * @param b - Second policy, or the default policy when omitted.
 *
 * @returns - Whether both policies describe the same choices.
 */
export function samePrecisionPolicy(
    a: PrecisionPolicy = DEFAULT_PRECISION_POLICY,
    b: PrecisionPolicy = DEFAULT_PRECISION_POLICY,
): boolean {
    return a.absoluteLabels === b.absoluteLabels && a.agePrecision === b.agePrecision
        && a.older === b.older && a.ranges.length === b.ranges.length
        && a.ranges.every((range, index) => range.hours === b.ranges[index]?.hours
            && range.precision === b.ranges[index].precision);
}

/**
 * Selects the maximum output precision using inclusive elapsed-hour thresholds.
 *
 * @param instant - Trusted timestamp.
 * @param policy - Optional display policy; omission preserves the saved format.
 * @param now - Current instant in Unix milliseconds.
 *
 * @returns - Precision limit, or undefined when age selection is disabled.
 */
export function precisionForAge(
    instant: Date,
    policy: PrecisionPolicy | undefined,
    now?: number,
): DatePrecision | undefined {
    if (!policy?.agePrecision) {
        return undefined;
    }
    const hours = Math.max(0, (now ?? Date.now()) - instant.getTime()) / 3_600_000;
    return policy.ranges.find((range) => hours <= range.hours)?.precision ?? policy.older;
}
