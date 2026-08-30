/**
 * @file Verifies the captured legacy YouTube Search shape remains an offline no-op.
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

const SEARCH_URL = new URL(
    "https://www.youtube.com/results?search_query=fixture",
);
const SEARCH_FIXTURE_PATH =
    "tests/src/content-script/fixtures/youtube/search-legacy-relative-only.html";
const SEARCH_LOADED_DATA_SELECTOR =
    'script[type="application/json"]#search-loaded-data';
const SEARCH_CARD_SELECTOR = "ytd-video-renderer";
const SEARCH_WATCH_LINK_SELECTOR = 'a#video-title[href*="/watch?v="]';
const SEARCH_METADATA_SELECTOR = "#metadata-line";
const SEARCH_PUBLICATION_CLASS_NAMES = [
    "inline-metadata-item",
    "ytd-video-meta-block",
] as const;
const EXPECTED_MAIN_RESULTS = new Map([
    ["testVID0001", "3 days ago"],
    ["testVID0002", "2 weeks ago"],
    ["testVID0003", "4 months ago"],
    ["testVID0004", "1 year ago"],
    ["testVID0005", "5 years ago"],
    ["testVID0006", "8 hours ago"],
]);
const EXPECTED_LOADED_KEYS = [
    "contents",
    "gridShelfViewModel",
    "itemSectionRenderer",
    "primaryContents",
    "publishedTimeText",
    "sectionListRenderer",
    "shelfRenderer",
    "simpleText",
    "twoColumnSearchResultsRenderer",
    "videoId",
    "videoRenderer",
] as const;
const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/u;
const STRICT_CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/u;
const EXPLICITLY_ZONED_INSTANT =
    /^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:?\d{2})$/u;
const PUBLICATION_OR_DATE_PATH = /publish|upload|date/iu;
const OFFLINE_FETCH_ERROR =
    "Network access is forbidden in YouTube Search fixtures";
const forbiddenFetch = vi.fn<typeof fetch>(() => {
    throw new Error(OFFLINE_FETCH_ERROR);
});

/**
 * Direct records retained from the evidenced Search item boundary.
 */
interface DirectSearchItems {

    /**
     * Direct legacy main-result records.
     */
    readonly mainRecords: readonly Record<string, unknown>[];

    /**
     * Direct grid-shelf outer records.
     */
    readonly gridShelves: readonly Record<string, unknown>[];

    /**
     * Direct shelf outer records.
     */
    readonly shelves: readonly Record<string, unknown>[];
}

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
 * Requires exactly one current fixture element.
 *
 * @param selector - Selector for the required element.
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
 * Requires the first rendered main-result card.
 *
 * @returns - First fixture card.
 */
function requireFirstSearchCard(): Element {
    const card = document.querySelector(SEARCH_CARD_SELECTOR);
    if (card === null) {
        throw new Error("Expected first Search card");
    }
    return card;
}

/**
 * Parses the one inert Search loaded-data subset.
 *
 * @returns - Parsed fixture root.
 */
function readLoadedData(): Record<string, unknown> {
    const script = requireFixtureElement(SEARCH_LOADED_DATA_SELECTOR);
    return requireRecord(JSON.parse(script.textContent), "loaded data root");
}

/**
 * Writes a synthetic mutation back to the inert Search data node.
 *
 * @param loadedData - Mutated loaded-data root.
 */
function writeLoadedData(loadedData: Record<string, unknown>): void {
    requireFixtureElement(SEARCH_LOADED_DATA_SELECTOR).textContent =
        JSON.stringify(loadedData);
}

/**
 * Traverses only the evidenced direct Search item boundary.
 *
 * @param loadedData - Parsed fixture root.
 * @returns - Direct main and mixed outer records.
 */
function readDirectSearchItems(
    loadedData: Record<string, unknown> = readLoadedData(),
): DirectSearchItems {
    const contents = requireRecord(loadedData.contents, "contents");
    const search = requireRecord(
        contents.twoColumnSearchResultsRenderer,
        "twoColumnSearchResultsRenderer",
    );
    const primary = requireRecord(search.primaryContents, "primaryContents");
    const sections = requireRecord(
        primary.sectionListRenderer,
        "sectionListRenderer",
    );
    const sectionValues = requireArray(sections.contents, "sectionListRenderer.contents");
    const directItems = sectionValues.flatMap((sectionValue, sectionIndex) => {
        const section = requireRecord(
            sectionValue,
            `sectionListRenderer.contents[${String(sectionIndex)}]`,
        );
        const itemSection = requireRecord(
            section.itemSectionRenderer,
            "itemSectionRenderer",
        );
        return requireArray(itemSection.contents, "itemSectionRenderer.contents");
    });
    const mainRecords: Record<string, unknown>[] = [];
    const gridShelves: Record<string, unknown>[] = [];
    const shelves: Record<string, unknown>[] = [];

    for (const [itemIndex, itemValue] of directItems.entries()) {
        const item = requireRecord(itemValue, `direct item ${String(itemIndex)}`);
        if (Object.hasOwn(item, "videoRenderer")) {
            mainRecords.push(requireRecord(item.videoRenderer, "videoRenderer"));
        }
        if (Object.hasOwn(item, "gridShelfViewModel")) {
            gridShelves.push(requireRecord(item.gridShelfViewModel, "gridShelfViewModel"));
        }
        if (Object.hasOwn(item, "shelfRenderer")) {
            shelves.push(requireRecord(item.shelfRenderer, "shelfRenderer"));
        }
    }

    return { mainRecords, gridShelves, shelves };
}

/**
 * Requires one direct main record by fixture index.
 *
 * @param records - Direct main records.
 * @param index - Requested fixture index.
 * @returns - Existing record at that index.
 */
function requireMainRecord(
    records: readonly Record<string, unknown>[],
    index: number,
): Record<string, unknown> {
    const record = records[index];
    if (!record) {
        throw new Error(`Expected main record ${String(index)}`);
    }
    return record;
}

/**
 * Reads one strict minimal main record.
 *
 * @param record - Untrusted direct main record.
 * @returns - Valid identity and label pair, or null for an invalid shape.
 */
function parseMainRecord(
    record: Record<string, unknown>,
): readonly [string, string] | null {
    if (Object.keys(record).sort().join(",") !== "publishedTimeText,videoId") {
        return null;
    }
    const videoId = record.videoId;
    if (typeof videoId !== "string" || !VIDEO_ID_PATTERN.test(videoId)) {
        return null;
    }
    let publication: Record<string, unknown>;
    try {
        publication = requireRecord(record.publishedTimeText, "publishedTimeText");
    } catch {
        return null;
    }
    if (
        Object.keys(publication).join(",") !== "simpleText"
        || typeof publication.simpleText !== "string"
        || publication.simpleText.length === 0
    ) {
        return null;
    }
    return [videoId, publication.simpleText];
}

/**
 * Reads the sole validated watch identity from one card link.
 *
 * @param link - Candidate relative watch link.
 * @returns - Sole 11-character identity, or null for an invalid link.
 */
function readWatchIdentity(link: Element): string | null {
    const href = link.getAttribute("href");
    if (href === null || !href.startsWith("/watch?v=")) {
        return null;
    }
    const url = new URL(href, SEARCH_URL);
    const videoIds = url.searchParams.getAll("v");
    const videoId = videoIds[0];
    if (
        url.pathname !== "/watch"
        || url.searchParams.size !== 1
        || videoIds.length !== 1
        || videoId === undefined
        || !VIDEO_ID_PATTERN.test(videoId)
    ) {
        return null;
    }
    return videoId;
}

/**
 * Reads the exact direct publication span from one Search card.
 *
 * @param card - Rendered main-result card.
 * @returns - Direct publication span, or null for an invalid relationship.
 */
function readPublicationSpan(card: Element): HTMLSpanElement | null {
    const metadataNodes = card.querySelectorAll(SEARCH_METADATA_SELECTOR);
    if (metadataNodes.length !== 1 || !metadataNodes[0]) {
        return null;
    }
    const children = Array.from(metadataNodes[0].children);
    const first = children[0];
    const second = children[1];
    if (
        children.length !== 2
        || !(first instanceof HTMLSpanElement)
        || !(second instanceof HTMLSpanElement)
        || first.textContent !== ""
        || SEARCH_PUBLICATION_CLASS_NAMES.some(
            (className) => !second.classList.contains(className),
        )
    ) {
        return null;
    }
    return second;
}

/**
 * Joins rendered cards to direct loaded records by identity and exact label.
 *
 * @returns - Complete relationship map, or null for ambiguity or invalidity.
 */
function collectMainRelationships(): ReadonlyMap<string, string> | null {
    try {
        const { mainRecords, gridShelves, shelves } = readDirectSearchItems();
        if (
            mainRecords.length !== EXPECTED_MAIN_RESULTS.size
            || gridShelves.length !== 2
            || shelves.length !== 1
        ) {
            return null;
        }
        const parsedRecords = mainRecords.map((record) => parseMainRecord(record));
        if (parsedRecords.some((record) => record === null)) {
            return null;
        }
        const records = parsedRecords.filter(
            (record): record is readonly [string, string] => record !== null,
        );
        if (new Set(records.map(([videoId]) => videoId)).size !== records.length) {
            return null;
        }
        const cards = Array.from(document.querySelectorAll(SEARCH_CARD_SELECTOR));
        if (cards.length !== records.length) {
            return null;
        }
        const relationships = new Map<string, string>();
        for (const card of cards) {
            const links = card.querySelectorAll(SEARCH_WATCH_LINK_SELECTOR);
            if (links.length !== 1 || !links[0]) {
                return null;
            }
            const videoId = readWatchIdentity(links[0]);
            const publication = readPublicationSpan(card);
            if (videoId === null || publication === null || relationships.has(videoId)) {
                return null;
            }
            const matches = records.filter(([recordId]) => recordId === videoId);
            if (
                matches.length !== 1
                || !matches[0]
                || publication.textContent !== matches[0][1]
            ) {
                return null;
            }
            relationships.set(videoId, publication.textContent);
        }
        return relationships.size === records.length ? relationships : null;
    } catch {
        return null;
    }
}

/**
 * Recursively collects every object key in parsed loaded data.
 *
 * @param value - Parsed value or subtree.
 * @returns - Complete key list including repeated keys.
 */
function collectLoadedKeys(value: unknown): readonly string[] {
    if (Array.isArray(value)) {
        return value.flatMap((item) => collectLoadedKeys(item));
    }
    if (typeof value !== "object" || value === null) {
        return [];
    }
    return Object.entries(value as Record<string, unknown>).flatMap(([key, nested]) => [
        key,
        ...collectLoadedKeys(nested),
    ]);
}

/**
 * Recursively collects every scalar string in parsed loaded data.
 *
 * @param value - Parsed value or subtree.
 * @returns - Complete loaded scalar-string list.
 */
function collectLoadedStrings(value: unknown): readonly string[] {
    if (typeof value === "string") {
        return [value];
    }
    if (Array.isArray(value)) {
        return value.flatMap((item) => collectLoadedStrings(item));
    }
    if (typeof value !== "object" || value === null) {
        return [];
    }
    return Object.values(value as Record<string, unknown>).flatMap((nested) =>
        collectLoadedStrings(nested));
}

/**
 * Recursively records the path of every loaded scalar string.
 *
 * @param value - Parsed value or subtree.
 * @param path - Current structural path.
 * @returns - String path/value pairs.
 */
function collectLoadedStringPaths(
    value: unknown,
    path = "$",
): readonly (readonly [string, string])[] {
    if (typeof value === "string") {
        return [[path, value]];
    }
    if (Array.isArray(value)) {
        return value.flatMap((item, index) =>
            collectLoadedStringPaths(item, `${path}[${String(index)}]`));
    }
    if (typeof value !== "object" || value === null) {
        return [];
    }
    return Object.entries(value as Record<string, unknown>).flatMap(([key, nested]) =>
        collectLoadedStringPaths(nested, `${path}.${key}`));
}

/**
 * Reads every visible non-empty text node outside inert scripts.
 *
 * @returns - Trimmed visible fixture text values.
 */
function collectVisibleTextValues(): readonly string[] {
    const values: string[] = [];
    const walker = document.createTreeWalker(
        document.body,
        window.NodeFilter.SHOW_TEXT,
    );
    let node = walker.nextNode();
    while (node !== null) {
        const parent = node.parentElement;
        const value = node.textContent?.trim() ?? "";
        if (value !== "" && parent?.closest("script, style") === null) {
            values.push(value);
        }
        node = walker.nextNode();
    }
    return values;
}

/**
 * Mutates parsed loaded data and persists the changed inert JSON.
 *
 * @param mutate - Mutation applied to direct Search items.
 */
function mutateLoadedData(mutate: (items: DirectSearchItems) => void): void {
    const loadedData = readLoadedData();
    mutate(readDirectSearchItems(loadedData));
    writeLoadedData(loadedData);
}

/**
 * Replaces the first loaded and visible publication values together.
 *
 * @param value - Synthetic publication text.
 */
function setFirstPublicationText(value: string): void {
    mutateLoadedData(({ mainRecords }) => {
        requireMainRecord(mainRecords, 0).publishedTimeText = { simpleText: value };
    });
    const publication = readPublicationSpan(requireFirstSearchCard());
    if (publication === null) {
        throw new Error("Expected first publication span");
    }
    publication.textContent = value;
}

describe("offline legacy YouTube Search qualification", () => {
    let fixture = "";

    beforeAll(async () => {
        fixture = await readFile(SEARCH_FIXTURE_PATH, "utf8");
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

    it("retains exactly the admitted direct main and empty mixed outer shapes", () => {
        const { mainRecords, gridShelves, shelves } = readDirectSearchItems();

        expect(mainRecords).toHaveLength(6);
        expect(gridShelves).toHaveLength(2);
        expect(shelves).toHaveLength(1);
        expect(gridShelves.map((record) => Object.keys(record))).toEqual([[], []]);
        expect(shelves.map((record) => Object.keys(record))).toEqual([[]]);
        expect(mainRecords.map((record) => Object.keys(record).sort())).toEqual(
            Array.from(
                { length: 6 },
                () => ["publishedTimeText", "videoId"],
            ),
        );
        expect(mainRecords.map((record) =>
            Object.keys(requireRecord(record.publishedTimeText, "publishedTimeText"))))
            .toEqual(Array.from({ length: 6 }, () => ["simpleText"]));
    });

    it("joins each card identity and label to exactly one direct main record", () => {
        expect([...collectMainRelationships()?.entries() ?? []]).toEqual(
            [...EXPECTED_MAIN_RESULTS.entries()],
        );
    });

    it("retains only the structural and scalar privacy allowlists", () => {
        const loadedData = readLoadedData();
        const expectedStrings = [
            ...EXPECTED_MAIN_RESULTS.keys(),
            ...EXPECTED_MAIN_RESULTS.values(),
        ].sort();

        expect([...new Set(collectLoadedKeys(loadedData))].sort())
            .toEqual([...EXPECTED_LOADED_KEYS].sort());
        expect([...collectLoadedStrings(loadedData)].sort()).toEqual(expectedStrings);
        expect(Array.from(
            document.querySelectorAll(SEARCH_WATCH_LINK_SELECTOR),
            (link) => readWatchIdentity(link),
        ).sort()).toEqual([...EXPECTED_MAIN_RESULTS.keys()].sort());
        expect([...collectVisibleTextValues()].sort())
            .toEqual([...EXPECTED_MAIN_RESULTS.values()].sort());
    });

    it("contains only empty placeholders and one empty DOM shelf around main labels", () => {
        const metadata = Array.from(document.querySelectorAll(SEARCH_METADATA_SELECTOR));
        const shelves = document.querySelectorAll("ytd-shelf-renderer");

        expect(metadata).toHaveLength(6);
        expect(metadata.map((node) => node.children[0]?.textContent)).toEqual(
            Array.from({ length: 6 }, () => ""),
        );
        expect(shelves).toHaveLength(1);
        expect(shelves[0]?.children).toHaveLength(0);
        expect(shelves[0]?.textContent).toBe("");
        expect(shelves[0]?.querySelector(SEARCH_CARD_SELECTOR)).toBeNull();
        expect(shelves[0]?.querySelector(SEARCH_WATCH_LINK_SELECTOR)).toBeNull();
        expect(document.body.children).toHaveLength(7);
        expect(Array.from(document.body.children, (element) => element.localName))
            .toEqual([
                ...Array.from({ length: 6 }, () => SEARCH_CARD_SELECTOR),
                "ytd-shelf-renderer",
            ]);
        expect(document.querySelector("img, picture, source, audio, video, time"))
            .toBeNull();
    });

    it("contains no copied sensitive content, external source, or executable data", () => {
        const inertScript = requireFixtureElement(SEARCH_LOADED_DATA_SELECTOR);
        const fixtureLowerCase = fixture.toLowerCase();
        const hrefs = Array.from(document.querySelectorAll("[href]"), (element) =>
            element.getAttribute("href"));

        expect(document.scripts).toHaveLength(1);
        expect(inertScript.getAttribute("type")).toBe("application/json");
        expect(document.querySelector('script:not([type="application/json"])')).toBeNull();
        expect(document.title).toBe("");
        expect(document.querySelector("title, [title], [aria-label], [src], [srcset], [poster]"))
            .toBeNull();
        expect(hrefs).toEqual(Array.from(
            EXPECTED_MAIN_RESULTS.keys(),
            (videoId) => `/watch?v=${videoId}`,
        ));
        expect(fixture).not.toMatch(/https?:\/\//iu);
        expect(fixture).not.toContain("search_query");
        expect(fixtureLowerCase).not.toMatch(
            /creator|thumbnail|tracking|visitor|continuation|cookie|token|authorization/u,
        );
        expect(fixtureLowerCase).not.toMatch(/header|account/u);
        expect(Array.from(document.querySelectorAll("a"), (link) => link.textContent))
            .toEqual(Array.from({ length: 6 }, () => ""));
    });

    it("contains no approved absolute value or other publication/date string path", () => {
        const stringPaths = collectLoadedStringPaths(readLoadedData());
        const publicationPaths = stringPaths.filter(([path]) =>
            PUBLICATION_OR_DATE_PATH.test(path));

        expect(stringPaths.filter(([, value]) => STRICT_CALENDAR_DATE.test(value)))
            .toEqual([]);
        expect(stringPaths.filter(([, value]) => EXPLICITLY_ZONED_INSTANT.test(value)))
            .toEqual([]);
        expect(publicationPaths).toHaveLength(6);
        expect(publicationPaths.every(([path, value]) =>
            path.endsWith(".videoRenderer.publishedTimeText.simpleText")
            && [...EXPECTED_MAIN_RESULTS.values()].includes(value))).toBe(true);
    });

    it.each([
        {
            name: "duplicate DOM identity",
            mutate: () => {
                document.querySelectorAll(SEARCH_WATCH_LINK_SELECTOR)[1]
                    ?.setAttribute("href", "/watch?v=testVID0001");
            },
        },
        {
            name: "missing DOM identity",
            mutate: () => {
                document.querySelector(SEARCH_WATCH_LINK_SELECTOR)
                    ?.removeAttribute("href");
            },
        },
        {
            name: "duplicate loaded identity",
            mutate: () => {
                mutateLoadedData(({ mainRecords }) => {
                    requireMainRecord(mainRecords, 1).videoId = "testVID0001";
                });
            },
        },
        {
            name: "missing loaded identity",
            mutate: () => {
                mutateLoadedData(({ mainRecords }) => {
                    delete requireMainRecord(mainRecords, 0).videoId;
                });
            },
        },
        {
            name: "missing visible publication span",
            mutate: () => {
                readPublicationSpan(requireFirstSearchCard())?.remove();
            },
        },
        {
            name: "extra visible publication span",
            mutate: () => {
                const publication = readPublicationSpan(requireFirstSearchCard());
                publication?.after(publication.cloneNode(true));
            },
        },
        {
            name: "non-direct publication span",
            mutate: () => {
                const publication = readPublicationSpan(requireFirstSearchCard());
                if (publication) {
                    const wrapper = document.createElement("div");
                    publication.replaceWith(wrapper);
                    wrapper.append(publication);
                }
            },
        },
        {
            name: "missing publication class token",
            mutate: () => {
                readPublicationSpan(requireFirstSearchCard())
                    ?.classList.remove(SEARCH_PUBLICATION_CLASS_NAMES[0]);
            },
        },
        {
            name: "mismatched visible label",
            mutate: () => {
                const publication = readPublicationSpan(requireFirstSearchCard());
                if (publication) {
                    publication.textContent = "9 days ago";
                }
            },
        },
        {
            name: "malformed publishedTimeText",
            mutate: () => {
                mutateLoadedData(({ mainRecords }) => {
                    requireMainRecord(mainRecords, 0).publishedTimeText = "3 days ago";
                });
            },
        },
        {
            name: "extra publishedTimeText key",
            mutate: () => {
                mutateLoadedData(({ mainRecords }) => {
                    const record = requireMainRecord(mainRecords, 0);
                    const publication = requireRecord(
                        record.publishedTimeText,
                        "publishedTimeText",
                    );
                    publication.extra = "unapproved";
                });
            },
        },
    ])("rejects a $name relationship", ({ mutate }) => {
        mutate();
        expect(collectMainRelationships()).toBeNull();
    });

    it("never promotes a recursively nested mixed-shape identity to a main record", () => {
        mutateLoadedData(({ gridShelves }) => {
            requireMainRecord(gridShelves, 0).nested = {
                videoRenderer: {
                    videoId: "testVID0006",
                    publishedTimeText: { simpleText: "8 hours ago" },
                },
            };
        });

        expect(readDirectSearchItems().mainRecords).toHaveLength(6);
        expect(collectMainRelationships()).not.toBeNull();
    });

    it("matches only the generic timestamp rule on canonical Search", () => {
        expect(defaultRegistry.matching(SEARCH_URL).map((rule) => rule.id))
            .toEqual([GENERIC_TIME_RULE_ID]);
    });

    it("leaves the representative relative-only mixed document byte-equivalent", () => {
        const originalMarkup = document.documentElement.outerHTML;
        const originalLabels = Array.from(
            document.querySelectorAll(SEARCH_PUBLICATION_CLASS_NAMES.map(
                (className) => `.${className}`,
            ).join("")),
            (label) => label.textContent,
        );
        const originalMixedData = readDirectSearchItems();

        expect(processDocument({ url: SEARCH_URL, root: document })).toEqual([]);
        expect(document.documentElement.outerHTML).toBe(originalMarkup);
        expect(Array.from(
            document.querySelectorAll(SEARCH_PUBLICATION_CLASS_NAMES.map(
                (className) => `.${className}`,
            ).join("")),
            (label) => label.textContent,
        )).toEqual(originalLabels);
        expect(readDirectSearchItems()).toEqual(originalMixedData);
        expect(document.querySelector(`[${OWNED_SOURCE_ATTRIBUTE}]`)).toBeNull();
        expect(document.querySelector(`[${OWNED_OUTPUT_ATTRIBUTE}]`)).toBeNull();
    });

    it.each([
        {
            name: "missing loaded publication value",
            mutate: () => {
                mutateLoadedData(({ mainRecords }) => {
                    delete requireMainRecord(mainRecords, 0).publishedTimeText;
                });
            },
        },
        {
            name: "malformed loaded publication value",
            mutate: () => {
                mutateLoadedData(({ mainRecords }) => {
                    requireMainRecord(mainRecords, 0).publishedTimeText = {};
                });
            },
        },
        {
            name: "relative-only loaded publication value",
            mutate: () => {
                setFirstPublicationText("9 minutes ago");
            },
        },
        {
            name: "synthetic unapproved absolute-looking simpleText",
            mutate: () => {
                setFirstPublicationText("2026-08-29");
            },
        },
        {
            name: "mismatched DOM identity",
            mutate: () => {
                document.querySelector(SEARCH_WATCH_LINK_SELECTOR)
                    ?.setAttribute("href", "/watch?v=testVID0002");
            },
        },
        {
            name: "synthetic date-looking DOM attributes",
            mutate: () => {
                const publication = readPublicationSpan(requireFirstSearchCard());
                publication?.setAttribute("data-published-at", "2026-08-29");
                publication?.setAttribute("aria-label", "2026-08-29T10:15:00Z");
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
        {
            name: "synthetic values inside every empty mixed outer shape",
            mutate: () => {
                mutateLoadedData(({ gridShelves, shelves }) => {
                    for (const outer of [...gridShelves, ...shelves]) {
                        outer.publishDate = "2026-08-29";
                        outer.nested = {
                            videoRenderer: {
                                videoId: "testVID0006",
                                publishedTimeText: { simpleText: "2026-08-29" },
                            },
                        };
                    }
                });
            },
        },
    ])("ignores a $name", ({ mutate }) => {
        mutate();
        const mutatedMarkup = document.documentElement.outerHTML;

        expect(processDocument({ url: SEARCH_URL, root: document })).toEqual([]);
        expect(document.documentElement.outerHTML).toBe(mutatedMarkup);
        expect(document.querySelector(`[${OWNED_SOURCE_ATTRIBUTE}]`)).toBeNull();
        expect(document.querySelector(`[${OWNED_OUTPUT_ATTRIBUTE}]`)).toBeNull();
    });
});
