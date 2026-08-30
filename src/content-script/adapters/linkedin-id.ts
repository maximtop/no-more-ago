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

const MAX_LINKEDIN_ID_DIGITS = 20;
const DECIMAL_TOKEN = `[1-9]\\d{0,${String(MAX_LINKEDIN_ID_DIGITS - 1)}}`;
const POST_ID_KIND_TOKEN = "activity|ugcPost|share";
const LEFT_TOKEN_BOUNDARY = "(?:^|[^0-9A-Za-z_])";
const DECIMAL_PATTERN = new RegExp(`^${DECIMAL_TOKEN}$`, "u");
const STRICT_POST_URN_PATTERN = new RegExp(
    `^urn:li:(${POST_ID_KIND_TOKEN}):(${DECIMAL_TOKEN})$`,
    "u",
);
const DIRECT_URN_PATTERN = new RegExp(
    `${LEFT_TOKEN_BOUNDARY}urn:li:(${POST_ID_KIND_TOKEN}):`
        + `(${DECIMAL_TOKEN})(?=$|[/?#&,)\\]])`,
    "gu",
);
const NAMED_ID_PATTERN = new RegExp(
    `\\b(${POST_ID_KIND_TOKEN}|comment)Id=(${DECIMAL_TOKEN})(?=$|[,)])`,
    "gu",
);
const COMMENT_URN_PATTERN = new RegExp(
    `${LEFT_TOKEN_BOUNDARY}urn:li:comment:\\(`
        + `(?:(?:urn:li:)?(?:${POST_ID_KIND_TOKEN}):)?`
        + `${DECIMAL_TOKEN},(${DECIMAL_TOKEN})\\)(?![0-9A-Za-z_])`,
    "gu",
);
const COMMENT_URN_CONTEXT_PATTERN = new RegExp(
    `${LEFT_TOKEN_BOUNDARY}urn:li:comment:\\(`
        + `(?:(?:urn:li:)?(${POST_ID_KIND_TOKEN}):)`
        + `(${DECIMAL_TOKEN}),(${DECIMAL_TOKEN})\\)(?![0-9A-Za-z_])`,
    "gu",
);
const NAMED_COMMENT_CONTEXT_PATTERN = new RegExp(
    `commentId=(${DECIMAL_TOKEN}),\\s*thread=urn:li:`
        + `(${POST_ID_KIND_TOKEN}):(${DECIMAL_TOKEN})(?=$|[,)])`,
    "gu",
);
const LINKEDIN_TIMESTAMP_BITS = 22n;
const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
const MAX_UNSIGNED_64_BIT_INTEGER = (1n << 64n) - 1n;

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
 * Parses one complete supported post URN without accepting surrounding text.
 *
 * @param value - Candidate complete LinkedIn post URN.
 * @returns - Strict post ID, or null for any unsupported grammar.
 */
export function parseLinkedInPostUrn(value: string): LinkedInLogicalId | null {
    const match = value.match(STRICT_POST_URN_PATTERN);
    const kind = match?.[1] as LinkedInIdKind | undefined;
    const decimal = match?.[2];
    return kind && decimal ? { kind, decimal } : null;
}

/**
 * Parses target IDs while excluding only structurally proven comment-thread context.
 *
 * @param value - Adapter-approved non-href evidence value.
 * @returns - Deduplicated target IDs with composite parent threads removed.
 */
export function parseLinkedInTargetIds(value: string): readonly LinkedInLogicalId[] {
    const ids = parseLinkedInIds(value);
    const contextual = new Set<string>();
    for (const form of getEvidenceForms(value)) {
        for (const match of form.matchAll(COMMENT_URN_CONTEXT_PATTERN)) {
            const kind = match[1] as LinkedInIdKind | undefined;
            const decimal = match[2];
            if (kind && decimal) {
                contextual.add(`${kind}:${decimal}`);
            }
        }
        for (const match of form.matchAll(NAMED_COMMENT_CONTEXT_PATTERN)) {
            const kind = match[2] as LinkedInIdKind | undefined;
            const decimal = match[3];
            if (kind && decimal) {
                contextual.add(`${kind}:${decimal}`);
            }
        }
    }
    return ids.filter((id) => !contextual.has(`${id.kind}:${id.decimal}`));
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
    let numericId: bigint;
    try {
        numericId = BigInt(id.decimal);
    } catch {
        return null;
    }
    if (numericId > MAX_UNSIGNED_64_BIT_INTEGER) {
        return null;
    }
    const epoch = numericId >> LINKEDIN_TIMESTAMP_BITS;
    if (epoch <= 0n || epoch > MAX_SAFE_INTEGER_BIGINT) {
        return null;
    }
    return Number(epoch);
}
