/**
 * @file Parses supported LinkedIn logical IDs and decodes their timestamp bits.
 */

/**
 * Supported LinkedIn logical ID kinds.
 */
export const LINKEDIN_ID_KIND = {
    ACTIVITY: "activity",
    UGC_POST: "ugcPost",
    SHARE: "share",
    COMMENT: "comment",
} as const;

/**
 * Supported LinkedIn logical ID kind.
 */
export type LinkedInIdKind =
    (typeof LINKEDIN_ID_KIND)[keyof typeof LINKEDIN_ID_KIND];

/**
 * Strict logical ID parsed from adapter-approved evidence.
 */
export interface LinkedInLogicalId {
    /**
     * Supported entity kind.
     */
    readonly kind: LinkedInIdKind;

    /**
     * Full positive ASCII decimal value.
     */
    readonly decimal: string;
}

const DECIMAL_PATTERN = /^[1-9]\d*$/u;
const DIRECT_URN_PATTERN =
    /urn:li:(activity|ugcPost|share):([1-9]\d*)(?=$|[/?#&,)\]])/gu;
const NAMED_ID_PATTERN =
    /\b(activity|ugcPost|share|comment)Id=([1-9]\d*)(?=$|[,)])/gu;
const COMMENT_URN_PATTERN = new RegExp(
    "urn:li:comment:\\((?:(?:urn:li:)?(?:activity|ugcPost|share):)?"
        + "[1-9]\\d*,([1-9]\\d*)\\)(?![0-9A-Za-z_])",
    "gu",
);
const LINKEDIN_TIMESTAMP_BITS = 22n;
const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

/**
 * Decodes a URL-encoded evidence value without making malformed encoding fatal.
 *
 * @param value - Raw page attribute value.
 * @returns - Raw and successfully decoded forms without duplicates.
 */
function getEvidenceForms(value: string): readonly string[] {
    const forms = new Set([value]);
    try {
        forms.add(decodeURIComponent(value));
    } catch {
        return [...forms];
    }
    return [...forms];
}

/**
 * Adds one strictly validated logical ID to a deduplicated result map.
 *
 * @param ids - Mutable result map.
 * @param kind - Supported logical kind.
 * @param decimal - Candidate decimal token.
 */
function addId(
    ids: Map<string, LinkedInLogicalId>,
    kind: LinkedInIdKind,
    decimal: string,
): void {
    if (!DECIMAL_PATTERN.test(decimal)) {
        return;
    }
    ids.set(`${kind}:${decimal}`, { kind, decimal });
}

/**
 * Parses every supported logical ID explicitly present in one evidence value.
 *
 * @param value - Adapter-approved URL, URN, component-key, or data-anchor value.
 * @returns - Deduplicated logical IDs in first-seen order.
 */
export function parseLinkedInIds(value: string): readonly LinkedInLogicalId[] {
    const ids = new Map<string, LinkedInLogicalId>();
    for (const form of getEvidenceForms(value)) {
        for (const match of form.matchAll(COMMENT_URN_PATTERN)) {
            const decimal = match[1];
            if (decimal) {
                addId(ids, LINKEDIN_ID_KIND.COMMENT, decimal);
            }
        }
        for (const match of form.matchAll(NAMED_ID_PATTERN)) {
            const kind = match[1] as LinkedInIdKind | undefined;
            const decimal = match[2];
            if (kind && decimal) {
                addId(ids, kind, decimal);
            }
        }
        for (const match of form.matchAll(DIRECT_URN_PATTERN)) {
            const kind = match[1] as LinkedInIdKind | undefined;
            const decimal = match[2];
            if (kind && decimal) {
                addId(ids, kind, decimal);
            }
        }
    }
    return [...ids.values()];
}

/**
 * Decodes the upper timestamp bits of one strict LinkedIn logical ID.
 *
 * @param id - Strict logical ID parsed from page evidence.
 * @returns - Exact safe Unix milliseconds, or null outside the numeric domain.
 */
export function decodeLinkedInIdMilliseconds(id: LinkedInLogicalId): number | null {
    if (!DECIMAL_PATTERN.test(id.decimal)) {
        return null;
    }
    const epoch = BigInt(id.decimal) >> LINKEDIN_TIMESTAMP_BITS;
    if (epoch <= 0n || epoch > MAX_SAFE_INTEGER_BIGINT) {
        return null;
    }
    return Number(epoch);
}
