/**
 * @file Contracts shared by timestamp adapters and the document processing pipeline.
 */

/**
 * Marker required before a raw adapter attribute may be parsed as an absolute instant.
 */
export const EXPLICIT_ZONED_DATETIME_RULE =
    "datetime:iso8601-explicit-zone" as const;

/**
 * Element names the GitHub adapter recognizes as relative-time widgets.
 */
export type TimestampSourceKind = "relative-time" | "time-ago" | "time-until";

/**
 * Trusted adapter output passed to timestamp validation; page markup itself is never trusted here.
 */
export interface TimestampCandidate {

    /**
     * Identifier of the adapter that accepted the timestamp source.
     */
    readonly adapterId: string;

    /**
     * DOM element whose timestamp is being transformed.
     */
    readonly source: Element;

    /**
     * Tag name used to select the adapter extraction rule.
     */
    readonly sourceKind: TimestampSourceKind;

    /**
     * Unparsed datetime attribute supplied by the trusted adapter.
     */
    readonly rawDatetime: string;

    /**
     * Rule proving that the adapter supplied an explicit zone.
     */
    readonly timestampRule: typeof EXPLICIT_ZONED_DATETIME_RULE;
}

/**
 * Site-specific discovery and extraction boundary; adapters identify candidates but never render them.
 */
export interface SiteAdapter {

    /**
     * Stable adapter identifier used in diagnostics and activation state.
     */
    readonly id: string;

    /**
     * Determines whether the adapter owns the page URL.
     */
    matches(url: URL): boolean;

    /**
     * Finds candidate timestamp elements without mutating the document.
     */
    discover(root: ParentNode): readonly Element[];

    /**
     * Returns a trusted candidate or null when the element is unsuitable.
     */
    extract(element: Element): TimestampCandidate | null;
}
