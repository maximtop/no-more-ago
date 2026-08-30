/**
 * @file Contracts shared by timestamp adapters and the document processing pipeline.
 */

/**
 * Validation rules proving that a candidate carries an eligible timestamp value.
 */
export const TIMESTAMP_VALIDATION_RULE = {
    EXPLICIT_ISO_ZONE: "datetime:iso8601-explicit-zone",
    HTML_GLOBAL: "datetime:html-global",
    UNIX_SECONDS: "datetime:unix-seconds",
    DERIVED_UNIX_MILLISECONDS: "instant:derived-unix-milliseconds",
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
    LINKEDIN_TIMESTAMP: "linkedin-timestamp",
} as const;

/**
 * Source attributes whose page-authored changes can affect adapter eligibility or extraction.
 */
export const TIMESTAMP_SOURCE_ATTRIBUTE = {
    CLASS: "class",
    ARIA_HIDDEN: "aria-hidden",
    DATA_TIMESTAMP: "data-timestamp",
    DATETIME: "datetime",
    FORMAT: "format",
    HREF: "href",
    TITLE: "title",
    DATA_ID: "data-id",
    DATA_URN: "data-urn",
    COMPONENT_KEY: "componentkey",
    SDUI_ANCHOR_ID: "data-sdui-anchor-id",
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

        /**
         * Page-authored content before the replaceable timestamp segment.
         */
        readonly textPrefix?: string;

        /**
         * Page-authored content after the replaceable timestamp segment.
         */
        readonly textSuffix?: string;
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
 * Fields shared by page-datetime and derived timestamp candidates.
 */
interface TimestampCandidateBase {
    /**
     * Stable identifier of the rule that accepted the source.
     */
    readonly ruleId: string;

    /**
     * DOM element whose timestamp is being transformed.
     */
    readonly source: Element;

    /**
     * Kind of source recognized by the rule.
     */
    readonly sourceKind: TimestampSourceKind;

    /**
     * DOM presentation and target selected by the rule.
     */
    readonly presentation: TimestampPresentation;

    /**
     * Visibility policy explicitly selected by the rule.
     */
    readonly visibilityPolicy: TimestampVisibilityPolicy;
}

/**
 * Candidate backed by a page-authored datetime string.
 */
export interface PageDatetimeTimestampCandidate extends TimestampCandidateBase {
    /**
     * Unparsed datetime attribute supplied by the source.
     */
    readonly rawDatetime: string;

    /**
     * Page-datetime validation rule.
     */
    readonly validationRule:
        | typeof TIMESTAMP_VALIDATION_RULE.EXPLICIT_ISO_ZONE
        | typeof TIMESTAMP_VALIDATION_RULE.HTML_GLOBAL
        | typeof TIMESTAMP_VALIDATION_RULE.UNIX_SECONDS;
}

/**
 * Candidate backed by a derived Unix-millisecond instant.
 */
export interface DerivedUnixMillisecondsTimestampCandidate
    extends TimestampCandidateBase {
    /**
     * Unrounded Unix epoch milliseconds derived at the adapter boundary.
     */
    readonly epochMilliseconds: number;

    /**
     * Derived values use an existing page-owned text target.
     */
    readonly presentation: Extract<
        TimestampPresentation,
        {
            /**
             * In-place presentation discriminant used for candidate narrowing.
             */
            readonly kind: typeof TIMESTAMP_PRESENTATION_KIND.IN_PLACE_TEXT;
        }
    >;

    /**
     * Derived-instant validation rule.
     */
    readonly validationRule:
        typeof TIMESTAMP_VALIDATION_RULE.DERIVED_UNIX_MILLISECONDS;
}

/**
 * Canonical candidate emitted by a timestamp source rule.
 */
export type TimestampCandidate =
    | PageDatetimeTimestampCandidate
    | DerivedUnixMillisecondsTimestampCandidate;

/**
 * Read-only context supplied while an adapter inspects a page source.
 */
export interface TimestampExtractionContext {
    /**
     * Returns the latest page-authored value for an in-place target.
     */
    readonly readPageText: (target: Text) => string;
}

/**
 * Generic or site-specific source rule for trusted timestamp candidates.
 */
export interface TimestampSourceRule {
    /**
     * Stable source-rule identifier.
     */
    readonly id: string;

    /**
     * Attributes whose page-authored changes affect this rule.
     */
    readonly mutationAttributes: readonly TimestampSourceAttribute[];

    /**
     * Maps an adapter-relevant mutation back to affected source elements.
     *
     * Rules may use this when eligibility depends on descendant attributes, child
     * structure, or a mutation that removes the source's current matching shape.
     *
     * @param element - Mutated element or child-list container.
     * @param attributeName - Adapter-declared attribute that changed, when present.
     * @param oldValue - Attribute value before the mutation.
     * @param context - Read-only page extraction context.
     * @returns - Exact source elements that require re-evaluation.
     */
    readonly getMutationSources?: (
        element: Element,
        attributeName: TimestampSourceAttribute | undefined,
        oldValue: string | null,
        context: TimestampExtractionContext,
    ) => readonly Element[];

    /**
     * Determines whether the rule applies to the page URL.
     */
    matches(url: URL): boolean;

    /**
     * Checks one element's source shape in the current extraction context.
     */
    matchesElement(
        element: Element,
        context: TimestampExtractionContext,
    ): boolean;

    /**
     * Finds source elements without mutating the supplied DOM region.
     */
    discover(
        root: ParentNode,
        context: TimestampExtractionContext,
    ): readonly Element[];

    /**
     * Extracts one candidate, or null when the source is unsuitable.
     */
    extract(
        element: Element,
        context: TimestampExtractionContext,
    ): TimestampCandidate | null;
}
