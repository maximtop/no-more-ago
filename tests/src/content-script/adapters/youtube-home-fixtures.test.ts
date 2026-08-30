/**
 * @file Verifies the captured modern YouTube Home shape remains an offline no-op.
 */

import { readFile } from "node:fs/promises";

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { GENERIC_TIME_RULE_ID } from
    "../../../../src/content-script/adapters/generic-time";
import { defaultRegistry } from "../../../../src/content-script/adapters/registry";
import {
    OWNED_OUTPUT_ATTRIBUTE,
    OWNED_SOURCE_ATTRIBUTE,
} from "../../../../src/content-script/ownership-markers";
import { processDocument } from
    "../../../../src/content-script/transformation/process-document";
import { restoreExactTimes } from
    "../../../../src/content-script/transformation/render-exact-time";

const HOME_URL = new URL("https://www.youtube.com/");
const HOME_LOADED_DATA_SELECTOR = "script#home-loaded-data";
const HOME_CARD_SELECTOR = "ytd-rich-item-renderer";
const HOME_LOCKUP_SELECTOR = "yt-lockup-view-model";
const HOME_WATCH_LINK_SELECTOR = 'a[href*="/watch?v="]';
const HOME_LABEL_SELECTOR = ".ytContentMetadataViewModelMetadataTextLastPart";
const EXPECTED_CARDS = new Map([
    ["testVID0001", "1 hour ago"],
    ["testVID0002", "2 days ago"],
    ["testVID0003", "3 weeks ago"],
    ["testVID0004", "4 months ago"],
    ["testVID0005", "5 years ago"],
    ["testVID0006", "6 minutes ago"],
]);
const STRICT_CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/u;
const EXPLICITLY_ZONED_INSTANT =
    /^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:?\d{2})$/u;
const ABSOLUTE_FIELD_NAME = /publish|upload|date|time/iu;
const OFFLINE_FETCH_ERROR = "Network access is forbidden in YouTube Home fixtures";
const forbiddenFetch = vi.fn<typeof fetch>(() => {
    throw new Error(OFFLINE_FETCH_ERROR);
});

/**
 * Requires one untrusted fixture value to be an object record.
 *
 * @param value - Parsed fixture value.
 * @param context - Stable structural context for a test failure.
 * @returns - Narrowed object record.
 */
function requireRecord(
    value: unknown,
    context: string,
): Record<string, unknown> {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new Error(`Expected object record at ${context}`);
    }
    return value as Record<string, unknown>;
}

/**
 * Requires one untrusted fixture value to be an array.
 *
 * @param value - Parsed fixture value.
 * @param context - Stable structural context for a test failure.
 * @returns - Narrowed array value.
 */
function requireArray(value: unknown, context: string): readonly unknown[] {
    if (!Array.isArray(value)) {
        throw new Error(`Expected array at ${context}`);
    }
    return value;
}

/**
 * Requires one element from the current fixture document.
 *
 * @param selector - Selector for the required fixture element.
 * @returns - Unique matching element.
 */
function requireFixtureElement(selector: string): Element {
    const elements = document.querySelectorAll(selector);
    if (elements.length !== 1 || !elements[0]) {
        throw new Error(`Expected one fixture element for ${selector}`);
    }
    return elements[0];
}

/**
 * Parses the inert loaded-data subset from the current fixture.
 *
 * @returns - Parsed root record.
 */
function readLoadedData(): Record<string, unknown> {
    const script = requireFixtureElement(HOME_LOADED_DATA_SELECTOR);
    return requireRecord(JSON.parse(script.textContent), "loaded data root");
}

/**
 * Writes one synthetic mutation back to the inert loaded-data fixture node.
 *
 * @param loadedData - Mutated loaded-data root.
 */
function writeLoadedData(loadedData: Record<string, unknown>): void {
    requireFixtureElement(HOME_LOADED_DATA_SELECTOR).textContent =
        JSON.stringify(loadedData);
}

/**
 * Traverses the captured loaded-data path and returns every lockup record.
 *
 * @param loadedData - Parsed loaded-data root.
 * @returns - Lockup records at the evidenced modern Home path.
 */
function readLoadedLockups(
    loadedData: Record<string, unknown> = readLoadedData(),
): readonly Record<string, unknown>[] {
    const contents = requireRecord(loadedData.contents, "contents");
    const browse = requireRecord(
        contents.twoColumnBrowseResultsRenderer,
        "twoColumnBrowseResultsRenderer",
    );
    const tabs = requireArray(browse.tabs, "tabs");
    return tabs.flatMap((tabValue, tabIndex) => {
        const tab = requireRecord(tabValue, `tabs[${String(tabIndex)}]`);
        const renderer = requireRecord(tab.tabRenderer, "tabRenderer");
        const tabContent = requireRecord(renderer.content, "tabRenderer.content");
        const grid = requireRecord(tabContent.richGridRenderer, "richGridRenderer");
        const items = requireArray(grid.contents, "richGridRenderer.contents");
        return items.map((itemValue, itemIndex) => {
            const item = requireRecord(itemValue, `contents[${String(itemIndex)}]`);
            const richItem = requireRecord(item.richItemRenderer, "richItemRenderer");
            const richContent = requireRecord(
                richItem.content,
                "richItemRenderer.content",
            );
            return requireRecord(richContent.lockupViewModel, "lockupViewModel");
        });
    });
}

/**
 * Reads every content/accessibility-label pair from one loaded lockup.
 *
 * @param lockup - Loaded lockup record.
 * @returns - Label pairs or null when any retained label shape is incomplete.
 */
function readLoadedLabels(
    lockup: Record<string, unknown>,
): readonly (readonly [string, string])[] | null {
    const metadata = requireRecord(lockup.metadata, "lockup metadata");
    const metadataView = requireRecord(
        metadata.lockupMetadataViewModel,
        "lockupMetadataViewModel",
    );
    const nestedMetadata = requireRecord(metadataView.metadata, "metadata");
    const contentMetadata = requireRecord(
        nestedMetadata.contentMetadataViewModel,
        "contentMetadataViewModel",
    );
    const rows = requireArray(contentMetadata.metadataRows, "metadataRows");
    const labels: [string, string][] = [];
    for (const rowValue of rows) {
        const row = requireRecord(rowValue, "metadata row");
        for (const partValue of requireArray(row.metadataParts, "metadataParts")) {
            const part = requireRecord(partValue, "metadata part");
            const text = requireRecord(part.text, "metadata text");
            const accessibility = requireRecord(text.accessibility, "accessibility");
            const accessibilityData = requireRecord(
                accessibility.accessibilityData,
                "accessibilityData",
            );
            if (
                typeof text.content !== "string"
                || typeof accessibilityData.label !== "string"
            ) {
                return null;
            }
            labels.push([text.content, accessibilityData.label]);
        }
    }
    return labels;
}

/**
 * Joins every rendered card to one loaded record through its watch identity.
 *
 * @returns - Exact identity-to-label map, or null for ambiguous or incomplete joins.
 */
function collectCardRelationships(): ReadonlyMap<string, string> | null {
    const cards = Array.from(document.querySelectorAll(HOME_CARD_SELECTOR));
    const records = readLoadedLockups();
    const relationships = new Map<string, string>();
    for (const card of cards) {
        const lockups = card.querySelectorAll(HOME_LOCKUP_SELECTOR);
        if (lockups.length !== 1 || !lockups[0]) {
            return null;
        }
        const links = lockups[0].querySelectorAll(HOME_WATCH_LINK_SELECTOR);
        const labels = lockups[0].querySelectorAll(HOME_LABEL_SELECTOR);
        if (links.length !== 1 || !links[0] || labels.length !== 1 || !labels[0]) {
            return null;
        }
        const href = links[0].getAttribute("href");
        if (href === null) {
            return null;
        }
        const videoIds = new URL(href, HOME_URL).searchParams.getAll("v");
        const videoId = videoIds[0];
        if (videoIds.length !== 1 || videoId === undefined || relationships.has(videoId)) {
            return null;
        }
        const recordMatches = records.filter((record) => record.contentId === videoId);
        if (recordMatches.length !== 1 || !recordMatches[0]) {
            return null;
        }
        const loadedLabels = readLoadedLabels(recordMatches[0]);
        const visibleLabel = labels[0].textContent;
        if (
            loadedLabels?.length !== 1
            || !loadedLabels[0]
            || visibleLabel !== loadedLabels[0][0]
            || visibleLabel !== loadedLabels[0][1]
        ) {
            return null;
        }
        relationships.set(videoId, visibleLabel);
    }
    return relationships;
}

/**
 * Recursively enumerates loaded-data entries for absolute-value inspection.
 *
 * @param value - Parsed value or subtree.
 * @returns - Nested key/value entries.
 */
function collectEntries(value: unknown): readonly (readonly [string, unknown])[] {
    if (Array.isArray(value)) {
        return value.flatMap((item) => collectEntries(item));
    }
    if (typeof value !== "object" || value === null) {
        return [];
    }
    return Object.entries(value as Record<string, unknown>).flatMap(([key, nested]) => [
        [key, nested] as const,
        ...collectEntries(nested),
    ]);
}

/**
 * Detects a value shaped like either approved publication semantic.
 *
 * @param value - Candidate loaded-data value.
 * @returns - Whether the value resembles a strict date or explicitly zoned instant.
 */
function resemblesApprovedAbsoluteValue(value: unknown): boolean {
    return typeof value === "string"
        && (STRICT_CALENDAR_DATE.test(value) || EXPLICITLY_ZONED_INSTANT.test(value));
}

describe("offline modern YouTube Home qualification", () => {
    let fixture = "";

    beforeAll(async () => {
        fixture = await readFile(
            "tests/src/content-script/fixtures/youtube/home-modern-relative-only.html",
            "utf8",
        );
    });

    beforeEach(() => {
        forbiddenFetch.mockClear();
        vi.stubGlobal("fetch", forbiddenFetch);
        document.documentElement.innerHTML = fixture;
    });

    afterEach(() => {
        const fetchCallCount = forbiddenFetch.mock.calls.length;
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
        restoreExactTimes(document);
        document.documentElement.innerHTML = "<head></head><body></body>";
        expect(fetchCallCount).toBe(0);
    });

    it("contains exactly six rendered cards and six loaded video records", () => {
        const cards = document.querySelectorAll(HOME_CARD_SELECTOR);
        const lockups = document.querySelectorAll(HOME_LOCKUP_SELECTOR);
        const records = readLoadedLockups();

        expect(cards).toHaveLength(6);
        expect(lockups).toHaveLength(6);
        expect(records).toHaveLength(6);
        expect(records.map((record) => record.contentType)).toEqual(
            Array.from({ length: 6 }, () => "LOCKUP_CONTENT_TYPE_VIDEO"),
        );
    });

    it("joins every card identity and label to exactly one loaded record", () => {
        expect([...collectCardRelationships()?.entries() ?? []]).toEqual(
            [...EXPECTED_CARDS.entries()],
        );
    });

    it.each([
        {
            name: "duplicate DOM identity",
            mutate: () => {
                const links = document.querySelectorAll(HOME_WATCH_LINK_SELECTOR);
                links[1]?.setAttribute("href", "/watch?v=testVID0001");
            },
        },
        {
            name: "missing DOM identity",
            mutate: () => {
                document.querySelector(HOME_WATCH_LINK_SELECTOR)?.removeAttribute("href");
            },
        },
        {
            name: "duplicate loaded identity",
            mutate: () => {
                const loadedData = readLoadedData();
                const records = readLoadedLockups(loadedData);
                if (records[1]) {
                    records[1].contentId = "testVID0001";
                }
                writeLoadedData(loadedData);
            },
        },
        {
            name: "missing loaded identity",
            mutate: () => {
                const loadedData = readLoadedData();
                const records = readLoadedLockups(loadedData);
                if (records[0]) {
                    delete records[0].contentId;
                }
                writeLoadedData(loadedData);
            },
        },
        {
            name: "duplicate visible label",
            mutate: () => {
                const label = document.querySelector(HOME_LABEL_SELECTOR);
                label?.after(label.cloneNode(true));
            },
        },
        {
            name: "missing visible label",
            mutate: () => {
                document.querySelector(HOME_LABEL_SELECTOR)?.remove();
            },
        },
    ])("rejects a $name relationship", ({ mutate }) => {
        mutate();
        expect(collectCardRelationships()).toBeNull();
    });

    it("contains no approved absolute publication value", () => {
        const entries = collectEntries(readLoadedData());
        expect(entries.filter(([, value]) => resemblesApprovedAbsoluteValue(value)))
            .toEqual([]);
        expect(entries.filter(([key, value]) =>
            ABSOLUTE_FIELD_NAME.test(key) && resemblesApprovedAbsoluteValue(value)))
            .toEqual([]);
    });

    it("matches only the generic timestamp rule on canonical Home", () => {
        expect(defaultRegistry.matching(HOME_URL).map((rule) => rule.id))
            .toEqual([GENERIC_TIME_RULE_ID]);
    });

    it("leaves the representative relative-only document byte-equivalent", () => {
        const originalMarkup = document.documentElement.outerHTML;
        const originalLabels = Array.from(
            document.querySelectorAll(HOME_LABEL_SELECTOR),
            (label) => label.textContent,
        );

        expect(processDocument({ url: HOME_URL, root: document })).toEqual([]);
        expect(document.documentElement.outerHTML).toBe(originalMarkup);
        expect(Array.from(
            document.querySelectorAll(HOME_LABEL_SELECTOR),
            (label) => label.textContent,
        )).toEqual(originalLabels);
        expect(document.querySelector(`[${OWNED_SOURCE_ATTRIBUTE}]`)).toBeNull();
        expect(document.querySelector(`[${OWNED_OUTPUT_ATTRIBUTE}]`)).toBeNull();
    });

    it.each([
        {
            name: "synthetic unapproved data-published-at value",
            mutate: () => {
                document.querySelector(HOME_LABEL_SELECTOR)
                    ?.setAttribute("data-published-at", "2026-08-29T10:15:00Z");
            },
        },
        {
            name: "synthetic unapproved absolute-looking ARIA label",
            mutate: () => {
                document.querySelector(HOME_LABEL_SELECTOR)
                    ?.setAttribute("aria-label", "2026-08-29");
            },
        },
        ...["publishDate", "uploadDate", "datePublished"].map((key) => ({
            name: `synthetic unapproved loaded ${key} value`,
            mutate: () => {
                const loadedData = readLoadedData();
                const record = readLoadedLockups(loadedData)[0];
                if (record) {
                    record[key] = "2026-08-29";
                }
                writeLoadedData(loadedData);
            },
        })),
        {
            name: "synthetic unapproved replicateAsTimestamp overlay boolean",
            mutate: () => {
                const loadedData = readLoadedData();
                const record = readLoadedLockups(loadedData)[0];
                if (record) {
                    record.overlay = { replicateAsTimestamp: true };
                }
                writeLoadedData(loadedData);
            },
        },
        {
            name: "synthetic mismatched DOM watch identity",
            mutate: () => {
                document.querySelector(HOME_WATCH_LINK_SELECTOR)
                    ?.setAttribute("href", "/watch?v=testVID0002");
            },
        },
        {
            name: "synthetic watch-only player assignment",
            mutate: () => {
                const script = document.createElement("script");
                document.head.append(script);
                script.textContent = `var ytInitialPlayerResponse = ${JSON.stringify({
                    videoDetails: { videoId: "testVID0001" },
                    microformat: {
                        playerMicroformatRenderer: {
                            externalVideoId: "testVID0001",
                            publishDate: "2026-08-29",
                        },
                    },
                })};`;
            },
        },
        {
            name: "synthetic watch-only datePublished metadata",
            mutate: () => {
                const metadata = document.createElement("meta");
                metadata.setAttribute("itemprop", "datePublished");
                metadata.setAttribute("content", "2026-08-29");
                document.head.append(metadata);
            },
        },
    ])("ignores a $name", ({ mutate }) => {
        mutate();
        const mutatedMarkup = document.documentElement.outerHTML;

        expect(processDocument({ url: HOME_URL, root: document })).toEqual([]);
        expect(document.documentElement.outerHTML).toBe(mutatedMarkup);
        expect(document.querySelector(`[${OWNED_SOURCE_ATTRIBUTE}]`)).toBeNull();
        expect(document.querySelector(`[${OWNED_OUTPUT_ATTRIBUTE}]`)).toBeNull();
    });
});
