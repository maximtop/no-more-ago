export const EXPLICIT_ZONED_DATETIME_RULE =
    "datetime:iso8601-explicit-zone" as const;

export type TimestampSourceKind = "relative-time" | "time-ago" | "time-until";

export interface TimestampCandidate {
    readonly adapterId: string;
    readonly source: Element;
    readonly sourceKind: TimestampSourceKind;
    readonly rawDatetime: string;
    readonly timestampRule: typeof EXPLICIT_ZONED_DATETIME_RULE;
}

export interface SiteAdapter {
    readonly id: string;
    matches(url: URL): boolean;
    discover(root: ParentNode): readonly Element[];
    extract(element: Element): TimestampCandidate | null;
}
