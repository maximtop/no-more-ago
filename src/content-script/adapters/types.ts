/**
 * @file Contracts shared by timestamp adapters and the document processing pipeline.
 */

/**
 * Validation rules proving that a candidate carries an eligible timestamp value.
 */
export const TIMESTAMP_VALIDATION_RULE = {
    EXPLICIT_ISO_ZONE: "datetime:iso8601-explicit-zone",
    HTML_GLOBAL: "datetime:html-global",
} as const;

/**
 * Source kinds recognized by timestamp extraction rules.
 */
export const TIMESTAMP_SOURCE_KIND = {
    RELATIVE_TIME: "relative-time",
    TIME_AGO: "time-ago",
    TIME_UNTIL: "time-until",
    STANDARD_TIME: "time",
} as const;

/**
 * Validation rule carried by a timestamp candidate.
 */
export type TimestampValidationRule =
    (typeof TIMESTAMP_VALIDATION_RULE)[keyof typeof TIMESTAMP_VALIDATION_RULE];

/**
 * Source kind carried by a timestamp candidate.
 */
export type TimestampSourceKind =
    (typeof TIMESTAMP_SOURCE_KIND)[keyof typeof TIMESTAMP_SOURCE_KIND];

/**
 * DOM element whose timestamp is being transformed.
 */
interface TimestampCandidateSource {
    /**
     * DOM element whose timestamp is being transformed.
     */
    readonly source: Element;

    /**
     * Kind of source element recognized by the source rule.
     */
    readonly sourceKind: TimestampSourceKind;

    /**
     * Unparsed datetime attribute supplied by the trusted source.
     */
    readonly rawDatetime: string;
}

/**
 * Canonical timestamp candidate emitted by a source rule.
 */
export interface TimestampCandidate extends TimestampCandidateSource {
    /**
     * Identifier of the source rule that accepted the timestamp source.
     */
    readonly ruleId: string;

    /**
     * Rule proving that the raw datetime value is eligible.
     */
    readonly validationRule: TimestampValidationRule;
}

/**
 * Generic or site-specific source rule for discovering trusted timestamp candidates.
 */
export interface TimestampSourceRule {
    /**
     * Stable source-rule identifier used in diagnostics and processing.
     */
    readonly id: string;

    /**
     * Determines whether the source rule applies to the page URL.
     */
    matches(url: URL): boolean;

    /**
     * Finds timestamp elements without mutating the document.
     */
    discover(root: ParentNode): readonly Element[];

    /**
     * Returns a trusted candidate or null when the element is unsuitable.
     */
    extract(element: Element): TimestampCandidate | null;
}
