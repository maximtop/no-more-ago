/**
 * @file Contracts shared by timestamp adapters and the document processing pipeline.
 */

/**
 * Validation rules proving that a candidate carries an eligible timestamp value.
 */
export const TIMESTAMP_VALIDATION_RULE = {
    CALENDAR_DATE: "date:calendar",
    CALENDAR_OR_EXPLICIT_ISO_ZONE: "datetime:calendar-or-explicit-zone",
    EXPLICIT_ISO_ZONE: "datetime:iso8601-explicit-zone",
    HTML_GLOBAL: "datetime:html-global",
    UNIX_SECONDS: "datetime:unix-seconds",
} as const;

/**
 * Source kinds recognized by timestamp extraction rules.
 */
export const TIMESTAMP_SOURCE_KIND = {
    RELATIVE_TIME: "relative-time",
    TIME_AGO: "time-ago",
    TIME_UNTIL: "time-until",
    STANDARD_TIME: "time",
    HACKER_NEWS_AGE: "hacker-news-age",
    STACK_EXCHANGE_TIMESTAMP: "stack-exchange-timestamp",
    TELEGRAM_WEB_K_MESSAGE: "telegram-web-k-message",
    YT_FORMATTED_STRING: "yt-formatted-string",
} as const;

/**
 * Source attributes whose page-authored changes can affect adapter eligibility or extraction.
 */
export const TIMESTAMP_SOURCE_ATTRIBUTE = {
    CLASS: "class",
    DATA_TIMESTAMP: "data-timestamp",
    DATETIME: "datetime",
    FORMAT: "format",
    HREF: "href",
    TITLE: "title",
} as const;

/**
 * Presentation strategies selected by trusted timestamp sources.
 */
export const TIMESTAMP_PRESENTATION_KIND = {
    ADJACENT_TIME: "adjacent-time",
    IN_PLACE_TEXT: "in-place-text",
} as const;

/**
 * Shared presentation descriptor used by existing adjacent-output sources.
 */
export const ADJACENT_TIME_PRESENTATION = {
    kind: TIMESTAMP_PRESENTATION_KIND.ADJACENT_TIME,
} as const;

/**
 * Validated presentation strategy carried from adapter extraction to rendering.
 */
export type TimestampPresentation =
    | typeof ADJACENT_TIME_PRESENTATION
    | {
        /**
         * In-place strategy discriminant.
         */
        readonly kind: typeof TIMESTAMP_PRESENTATION_KIND.IN_PLACE_TEXT;

        /**
         * Existing page-owned label node to update. The target must belong to
         * the source document and remain contained by the source.
         */
        readonly target: Text;
    };

/**
 * Visibility handling requested by a timestamp source.
 */
export const TIMESTAMP_VISIBILITY_POLICY = {
    PRESERVE_PAGE_SUPPRESSION: "preserve-page-suppression",
    IGNORE_PAGE_SUPPRESSION: "ignore-page-suppression",
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
 * Source attribute observed for adapter-specific eligibility changes.
 */
export type TimestampSourceAttribute =
    (typeof TIMESTAMP_SOURCE_ATTRIBUTE)[keyof typeof TIMESTAMP_SOURCE_ATTRIBUTE];

/**
 * Visibility handling policy carried by a timestamp candidate.
 */
export type TimestampVisibilityPolicy =
    (typeof TIMESTAMP_VISIBILITY_POLICY)[keyof typeof TIMESTAMP_VISIBILITY_POLICY];

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
     * Unparsed date or date-time value supplied by the trusted source.
     */
    readonly rawDatetime: string;

    /**
     * DOM presentation strategy and existing target selected by the source rule.
     */
    readonly presentation: TimestampPresentation;
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

    /**
     * Visibility policy explicitly selected by the source rule.
     */
    readonly visibilityPolicy: TimestampVisibilityPolicy;
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
     * Attributes that can change whether or how this rule extracts an existing source.
     */
    readonly mutationAttributes: readonly TimestampSourceAttribute[];

    /**
     * Maps an adapter-relevant attribute change back to affected source elements.
     *
     * Rules may use this when eligibility depends on descendant attributes or when
     * the mutation removes the source's current matching shape.
     *
     * @param element - Element whose attribute changed.
     * @param attributeName - Adapter-declared attribute that changed.
     * @param oldValue - Attribute value before the mutation.
     * @returns - Exact source elements that require re-evaluation.
     */
    readonly getMutationSources?: (
        element: Element,
        attributeName: TimestampSourceAttribute,
        oldValue: string | null,
    ) => readonly Element[];

    /**
     * Determines whether the source rule applies to the page URL.
     */
    matches(url: URL): boolean;

    /**
     * Checks whether one element has this rule's source shape before extraction.
     */
    matchesElement(element: Element): boolean;

    /**
     * Finds timestamp elements without mutating the document.
     */
    discover(root: ParentNode): readonly Element[];

    /**
     * Extracts at most one candidate for the exact discovered source.
     *
     * @param element - Discovered source that the candidate must retain by identity.
     * @param url - Current page URL already considered during rule matching, when available.
     * @returns - Candidate for `element`, or null when this source tier is unusable.
     */
    extract(element: Element, url?: URL): TimestampCandidate | null;
}
