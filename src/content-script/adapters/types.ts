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
    DERIVED_UNIX_MILLISECONDS: "instant:derived-unix-milliseconds",
} as const;

/**
 * Source kinds recognized by timestamp extraction rules.
 */
export const TIMESTAMP_SOURCE_KIND = {
    BLUESKY_POST: "bluesky-post",
    RELATIVE_TIME: "relative-time",
    TIME_AGO: "time-ago",
    TIME_UNTIL: "time-until",
    STANDARD_TIME: "time",
    HACKER_NEWS_AGE: "hacker-news-age",
    STACK_EXCHANGE_TIMESTAMP: "stack-exchange-timestamp",
    TELEGRAM_WEB_K_MESSAGE: "telegram-web-k-message",
    TIKTOK_PUBLICATION: "tiktok-publication",
    LINKEDIN_TIMESTAMP: "linkedin-timestamp",
    YT_FORMATTED_STRING: "yt-formatted-string",
    FACEBOOK_STORY_TIMESTAMP: "facebook-story-timestamp",
} as const;

/**
 * Source attributes whose page-authored changes can affect adapter eligibility or extraction.
 */
export const TIMESTAMP_SOURCE_ATTRIBUTE = {
    ARIA_LABEL: "aria-label",
    CLASS: "class",
    DATA_TOOLTIP: "data-tooltip",
    DATA_E2E: "data-e2e",
    ARIA_HIDDEN: "aria-hidden",
    DATA_TIMESTAMP: "data-timestamp",
    DATETIME: "datetime",
    FORMAT: "format",
    HREF: "href",
    ID: "id",
    TITLE: "title",
    DATA_ID: "data-id",
    DATA_URN: "data-urn",
    COMPONENT_KEY: "componentkey",
    SDUI_ANCHOR_ID: "data-sdui-anchor-id",
} as const;

/**
 * DOM mutation kinds forwarded to adapter-specific source invalidation.
 */
export const TIMESTAMP_MUTATION_KIND = {
    ATTRIBUTE: "attribute",
    CHARACTER_DATA: "character-data",
    CHILD_LIST: "child-list",
} as const;

/**
 * Presentation strategies selected by trusted timestamp sources.
 */
export const TIMESTAMP_PRESENTATION_KIND = {
    ADJACENT_TIME: "adjacent-time",
    APPENDED_TIME: "appended-time",
    IN_PLACE_TEXT: "in-place-text",
} as const;

/**
 * Shared presentation descriptor used by existing adjacent-output sources.
 */
export const ADJACENT_TIME_PRESENTATION = {
    kind: TIMESTAMP_PRESENTATION_KIND.ADJACENT_TIME,
} as const;

/**
 * Shared presentation descriptor for generated output that preserves its source.
 */
export const APPENDED_TIME_PRESENTATION = {
    kind: TIMESTAMP_PRESENTATION_KIND.APPENDED_TIME,
} as const;

/**
 * Validated presentation strategy carried from adapter extraction to rendering.
 */
export type TimestampPresentation =
    | typeof ADJACENT_TIME_PRESENTATION
    | typeof APPENDED_TIME_PRESENTATION
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
 * DOM mutation kind forwarded to adapter-specific source invalidation.
 */
export type TimestampMutationKind =
    (typeof TIMESTAMP_MUTATION_KIND)[keyof typeof TIMESTAMP_MUTATION_KIND];

/**
 * Visibility handling policy carried by a timestamp candidate.
 */
export type TimestampVisibilityPolicy =
    (typeof TIMESTAMP_VISIBILITY_POLICY)[keyof typeof TIMESTAMP_VISIBILITY_POLICY];

/**
 * Fields shared by validated-string and derived timestamp candidates.
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
 * Candidate backed by an adapter-supplied datetime string.
 */
export interface ValidatedStringTimestampCandidate extends TimestampCandidateBase {
    /**
     * Adapter-supplied timestamp evidence before shared validation and parsing.
     */
    readonly rawDatetime: string;

    /**
     * String-datetime validation rule.
     */
    readonly validationRule:
        | typeof TIMESTAMP_VALIDATION_RULE.CALENDAR_DATE
        | typeof TIMESTAMP_VALIDATION_RULE.CALENDAR_OR_EXPLICIT_ISO_ZONE
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
    | ValidatedStringTimestampCandidate
    | DerivedUnixMillisecondsTimestampCandidate;

/**
 * Read-only context supplied while an adapter inspects a page source.
 */
export interface TimestampExtractionContext {
    /**
     * Current page URL used by rules whose value provenance is route-specific.
     */
    readonly url: URL;

    /**
     * Returns the latest page-authored value for an in-place target.
     */
    readonly readPageText: (target: Text) => string;
}

/**
 * Explicit ownership result for an adapter-specific mutation mapper.
 */
export interface TimestampMutationSourceResult {
    /**
     * Whether the custom mapper fully handled the mutation, including a deliberate no-op.
     */
    readonly handled: boolean;

    /**
     * Exact sources selected by the custom mapper.
     */
    readonly sources: readonly Element[];
}

/**
 * Mutation sources with optional explicit handled/delegate semantics.
 */
export type TimestampMutationSourceSelection =
    | readonly Element[]
    | TimestampMutationSourceResult;

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
     * Whether page-authored character-data changes can create a source for this rule.
     */
    readonly observesCharacterData?: boolean;

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
     * @param mutationKind - Kind of DOM mutation being mapped.
     * @returns - Exact sources, or an explicit handled/delegate result. An empty legacy array
     * delegates to normal ancestor matching.
     */
    readonly getMutationSources?: (
        element: Element,
        attributeName: TimestampSourceAttribute | undefined,
        oldValue: string | null,
        context: TimestampExtractionContext,
        mutationKind: TimestampMutationKind,
    ) => TimestampMutationSourceSelection;

    /**
     * Maps child membership changes back to sources whose eligibility or evidence changed.
     *
     * @param element - Element whose direct child list changed.
     * @param addedNodes - Nodes added by the page-authored mutation.
     * @param removedNodes - Nodes removed by the page-authored mutation.
     * @returns - Exact sources, or an explicit handled/delegate result. An empty legacy array
     * delegates to normal ancestor matching.
     */
    readonly getChildMutationSources?: (
        element: Element,
        addedNodes: readonly Node[],
        removedNodes: readonly Node[],
    ) => TimestampMutationSourceSelection;

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
     * Extracts one candidate for the exact discovered source.
     *
     * @param element - Discovered source that the candidate must retain by identity.
     * @param context - Current route and retained page-owned text capabilities.
     * @returns - Candidate for `element`, or null when this source tier is unusable.
     */
    extract(
        element: Element,
        context: TimestampExtractionContext,
    ): TimestampCandidate | null;
}
