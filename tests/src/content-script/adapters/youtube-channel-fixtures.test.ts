/**
 * @file Verifies the captured YouTube Channel Videos shape remains an offline no-op.
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

/**
 * Evidenced loaded publication-row variants.
 */
type ChannelPublicationRow = 0 | 1;

/**
 * Expected sanitized relationship for one Channel fixture card.
 */
interface ExpectedChannelCard {

    /**
     * Synthetic relative label shared by DOM and loaded data.
     */
    readonly label: string;

    /**
     * Evidenced metadata-row variant for this identity.
     */
    readonly publicationRow: ChannelPublicationRow;
}

/**
 * Direct entries retained from the evidenced selected-tab grid boundary.
 */
interface DirectChannelItems {

    /**
     * Direct modern lockup records.
     */
    readonly lockups: readonly Record<string, unknown>[];

    /**
     * Direct continuation outer records.
     */
    readonly continuations: readonly Record<string, unknown>[];
}

/**
 * Validated loaded fixture relationship.
 */
interface LoadedChannelCard {

    /**
     * Sanitized video identity.
     */
    readonly alias: string;

    /**
     * Synthetic relative publication label.
     */
    readonly label: string;

    /**
     * Evidenced metadata-row variant.
     */
    readonly publicationRow: ChannelPublicationRow;
}

const CHANNEL_VIDEOS_URL = new URL(
    "https://www.youtube.com/@fixture-channel/videos",
);
const HOME_URL = new URL("https://www.youtube.com/");
const SEARCH_URL = new URL(
    "https://www.youtube.com/results?search_query=fixture",
);
const CHANNEL_FIXTURE_PATH =
    "tests/src/content-script/fixtures/youtube/" +
    "channel-videos-modern-relative-only.html";
const HOME_FIXTURE_PATH =
    "tests/src/content-script/fixtures/youtube/home-modern-relative-only.html";
const SEARCH_FIXTURE_PATH =
    "tests/src/content-script/fixtures/youtube/search-legacy-relative-only.html";
const CHANNEL_LOADED_DATA_SELECTOR =
    'script[type="application/json"]#channel-videos-loaded-data';
const CHANNEL_CARD_SELECTOR = "yt-lockup-view-model";
const FIXTURE_IDENTITY_CARRIER_SELECTOR = 'a[href*="/watch?v="]';
const PUBLICATION_PARENT_CLASS = "ytContentMetadataViewModelMetadataRow";
const PUBLICATION_NODE_CLASS_NAMES = [
    "ytAttributedStringHost",
    "ytAttributedStringLinkInheritColor",
    "ytAttributedStringWhiteSpacePreWrap",
    "ytContentMetadataViewModelMetadataText",
    "ytContentMetadataViewModelMetadataTextLastPart",
] as const;
const PUBLICATION_NODE_SELECTOR =
    ".ytContentMetadataViewModelMetadataTextLastPart";
const CONTENT_TYPE_VIDEO = "LOCKUP_CONTENT_TYPE_VIDEO";
const EXPECTED_CARDS = new Map<string, ExpectedChannelCard>([
    ["chanVID0001", { label: "4 hours ago", publicationRow: 0 }],
    ["chanVID0002", { label: "2 days ago", publicationRow: 0 }],
    ["chanVID0003", { label: "3 weeks ago", publicationRow: 0 }],
    ["chanVID0004", { label: "5 months ago", publicationRow: 1 }],
    ["chanVID0005", { label: "1 year ago", publicationRow: 1 }],
    ["chanVID0006", { label: "6 years ago", publicationRow: 1 }],
]);
const EXPECTED_LOADED_KEYS = [
    "content",
    "contentId",
    "contentMetadataViewModel",
    "contentType",
    "contents",
    "continuationItemRenderer",
    "lockupMetadataViewModel",
    "lockupViewModel",
    "metadata",
    "metadataParts",
    "metadataRows",
    "richGridRenderer",
    "richItemRenderer",
    "tabRenderer",
    "tabs",
    "text",
    "twoColumnBrowseResultsRenderer",
] as const;
const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/u;
const RELATIVE_LABEL_PATTERN =
    /^\d+ (?:hour|hours|day|days|week|weeks|month|months|year|years) ago$/u;
const STRICT_CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/u;
const EXPLICITLY_ZONED_INSTANT =
    /^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:?\d{2})$/u;
const DATE_OR_TIME_PATH = /publish|upload|date|time/iu;
const OFFLINE_FETCH_ERROR =
    "Network access is forbidden in YouTube Channel fixtures";
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
 * Requires the first rendered Channel fixture card.
 *
 * @returns - First fixture card.
 */
function requireFirstChannelCard(): Element {
    const card = document.querySelector(CHANNEL_CARD_SELECTOR);
    if (card === null) {
        throw new Error("Expected first Channel fixture card");
    }
    return card;
}

/**
 * Parses the one inert Channel loaded-data subset.
 *
 * @returns - Parsed fixture root.
 */
function readLoadedData(): Record<string, unknown> {
    const script = requireFixtureElement(CHANNEL_LOADED_DATA_SELECTOR);
    return requireRecord(JSON.parse(script.textContent), "loaded data root");
}

/**
 * Writes a synthetic mutation back to the inert Channel data node.
 *
 * @param loadedData - Mutated loaded-data root.
 */
function writeLoadedData(loadedData: Record<string, unknown>): void {
    requireFixtureElement(CHANNEL_LOADED_DATA_SELECTOR).textContent =
        JSON.stringify(loadedData);
}

/**
 * Traverses only the captured selected-tab grid boundary.
 *
 * @param loadedData - Parsed fixture root.
 * @returns - Direct lockup and continuation outer records.
 */
function readDirectChannelItems(
    loadedData: Record<string, unknown> = readLoadedData(),
): DirectChannelItems {
    const contents = requireRecord(loadedData.contents, "contents");
    const browse = requireRecord(
        contents.twoColumnBrowseResultsRenderer,
        "twoColumnBrowseResultsRenderer",
    );
    const tabs = requireArray(browse.tabs, "tabs");
    const lockups: Record<string, unknown>[] = [];
    const continuations: Record<string, unknown>[] = [];

    for (const [tabIndex, tabValue] of tabs.entries()) {
        const tab = requireRecord(tabValue, `tabs[${String(tabIndex)}]`);
        const renderer = requireRecord(tab.tabRenderer, "tabRenderer");
        const tabContent = requireRecord(renderer.content, "tabRenderer.content");
        const grid = requireRecord(tabContent.richGridRenderer, "richGridRenderer");
        const items = requireArray(grid.contents, "richGridRenderer.contents");
        for (const [itemIndex, itemValue] of items.entries()) {
            const item = requireRecord(itemValue, `grid item ${String(itemIndex)}`);
            if (Object.hasOwn(item, "richItemRenderer")) {
                const richItem = requireRecord(
                    item.richItemRenderer,
                    "richItemRenderer",
                );
                const richContent = requireRecord(
                    richItem.content,
                    "richItemRenderer.content",
                );
                lockups.push(requireRecord(
                    richContent.lockupViewModel,
                    "lockupViewModel",
                ));
            }
            if (Object.hasOwn(item, "continuationItemRenderer")) {
                continuations.push(requireRecord(
                    item.continuationItemRenderer,
                    "continuationItemRenderer",
                ));
            }
        }
    }

    return { lockups, continuations };
}

/**
 * Requires one record from a fixture collection by index.
 *
 * @param records - Parsed fixture records.
 * @param index - Requested index.
 * @returns - Existing record at the index.
 */
function requireRecordAt(
    records: readonly Record<string, unknown>[],
    index: number,
): Record<string, unknown> {
    const record = records[index];
    if (!record) {
        throw new Error(`Expected fixture record ${String(index)}`);
    }
    return record;
}

/**
 * Traverses the minimum captured metadata wrapper for one loaded lockup.
 *
 * @param lockup - Parsed direct lockup.
 * @returns - Content metadata record containing metadata rows.
 */
function readContentMetadata(
    lockup: Record<string, unknown>,
): Record<string, unknown> {
    const metadata = requireRecord(lockup.metadata, "lockup metadata");
    const lockupMetadata = requireRecord(
        metadata.lockupMetadataViewModel,
        "lockupMetadataViewModel",
    );
    const nestedMetadata = requireRecord(lockupMetadata.metadata, "metadata");
    return requireRecord(
        nestedMetadata.contentMetadataViewModel,
        "contentMetadataViewModel",
    );
}

/**
 * Reads retained metadata rows from one direct lockup.
 *
 * @param lockup - Parsed direct lockup.
 * @returns - Parsed row records.
 */
function readMetadataRows(
    lockup: Record<string, unknown>,
): readonly Record<string, unknown>[] {
    return requireArray(
        readContentMetadata(lockup).metadataRows,
        "metadataRows",
    ).map((row, index) => requireRecord(row, `metadataRows[${String(index)}]`));
}

/**
 * Reads metadata parts at one retained row.
 *
 * @param lockup - Parsed direct lockup.
 * @param rowIndex - Retained row index.
 * @returns - Parsed metadata-part records.
 */
function readMetadataParts(
    lockup: Record<string, unknown>,
    rowIndex: number,
): readonly Record<string, unknown>[] {
    const row = readMetadataRows(lockup)[rowIndex];
    if (!row) {
        throw new Error(`Expected metadata row ${String(rowIndex)}`);
    }
    return requireArray(row.metadataParts, "metadataParts").map((part, index) =>
        requireRecord(part, `metadataParts[${String(index)}]`));
}

/**
 * Requires the publication text object at one retained row.
 *
 * @param lockup - Parsed direct lockup.
 * @param rowIndex - Retained publication row.
 * @returns - Mutable one-key publication text record.
 */
function requirePublicationText(
    lockup: Record<string, unknown>,
    rowIndex: number,
): Record<string, unknown> {
    const part = readMetadataParts(lockup, rowIndex)[1];
    if (!part) {
        throw new Error("Expected publication metadata part");
    }
    return requireRecord(part.text, "publication text");
}

/**
 * Collects all loaded metadata-part string values from one lockup.
 *
 * @param lockup - Parsed direct lockup.
 * @returns - Retained metadata-part string values.
 */
function collectLoadedPartContents(
    lockup: Record<string, unknown>,
): readonly string[] {
    const values: string[] = [];
    for (const row of readMetadataRows(lockup)) {
        if (!Object.hasOwn(row, "metadataParts")) {
            continue;
        }
        const parts = requireArray(row.metadataParts, "metadataParts");
        for (const partValue of parts) {
            const part = requireRecord(partValue, "metadata part");
            if (!Object.hasOwn(part, "text")) {
                continue;
            }
            const text = requireRecord(part.text, "metadata text");
            if (typeof text.content === "string") {
                values.push(text.content);
            }
        }
    }
    return values;
}

/**
 * Validates one direct lockup against its identity-bound row variant.
 *
 * @param lockup - Untrusted direct lockup.
 * @returns - Loaded fixture relationship, or null for an invalid shape.
 */
function parseLoadedChannelCard(
    lockup: Record<string, unknown>,
): LoadedChannelCard | null {
    try {
        if (
            Object.keys(lockup).sort().join(",") !==
                "contentId,contentType,metadata"
            || lockup.contentType !== CONTENT_TYPE_VIDEO
            || typeof lockup.contentId !== "string"
            || !VIDEO_ID_PATTERN.test(lockup.contentId)
        ) {
            return null;
        }
        const expected = EXPECTED_CARDS.get(lockup.contentId);
        if (expected === undefined) {
            return null;
        }
        const contentMetadata = readContentMetadata(lockup);
        const rows = readMetadataRows(lockup);
        if (
            Object.keys(contentMetadata).join(",") !== "metadataRows"
            || rows.length !== expected.publicationRow + 1
        ) {
            return null;
        }
        for (const [rowIndex, row] of rows.entries()) {
            if (rowIndex !== expected.publicationRow && Object.keys(row).length !== 0) {
                return null;
            }
        }
        const publicationRow = rows[expected.publicationRow];
        if (
            !publicationRow
            || Object.keys(publicationRow).join(",") !== "metadataParts"
        ) {
            return null;
        }
        const parts = readMetadataParts(lockup, expected.publicationRow);
        const placeholder = parts[0];
        const publicationPart = parts[1];
        if (
            parts.length !== 2
            || !placeholder
            || Object.keys(placeholder).length !== 0
            || !publicationPart
            || Object.keys(publicationPart).join(",") !== "text"
        ) {
            return null;
        }
        const text = requireRecord(publicationPart.text, "publication text");
        if (
            Object.keys(text).join(",") !== "content"
            || typeof text.content !== "string"
            || !RELATIVE_LABEL_PATTERN.test(text.content)
        ) {
            return null;
        }
        const allPartContents = collectLoadedPartContents(lockup);
        if (allPartContents.length !== 1 || allPartContents[0] !== text.content) {
            return null;
        }
        return {
            alias: lockup.contentId,
            label: text.content,
            publicationRow: expected.publicationRow,
        };
    } catch {
        return null;
    }
}

/**
 * Reads the sanitized identity carrier used only to encode fixture equality.
 *
 * This is not an asserted production Channel selector.
 *
 * @param card - Rendered fixture card.
 * @returns - Sole fixture alias, or null for an invalid carrier.
 */
function readFixtureEncodedAlias(card: Element): string | null {
    const anchors = card.querySelectorAll("a");
    const carrier = anchors[0];
    if (
        anchors.length !== 1
        || !carrier
        || !carrier.matches(FIXTURE_IDENTITY_CARRIER_SELECTOR)
    ) {
        return null;
    }
    const href = carrier.getAttribute("href");
    if (href === null || !href.startsWith("/watch?v=")) {
        return null;
    }
    const url = new URL(href, CHANNEL_VIDEOS_URL);
    const aliases = url.searchParams.getAll("v");
    const alias = aliases[0];
    if (
        url.pathname !== "/watch"
        || url.searchParams.size !== 1
        || aliases.length !== 1
        || alias === undefined
        || !VIDEO_ID_PATTERN.test(alias)
        || href !== `/watch?v=${alias}`
    ) {
        return null;
    }
    return alias;
}

/**
 * Reads the exact captured publication-node relationship from one card.
 *
 * @param card - Rendered fixture card.
 * @returns - Unique direct publication span, or null for an invalid shape.
 */
function readVisiblePublication(card: Element): HTMLSpanElement | null {
    const parents = card.querySelectorAll(`.${PUBLICATION_PARENT_CLASS}`);
    const nodes = card.querySelectorAll(PUBLICATION_NODE_SELECTOR);
    const parent = parents[0];
    const node = nodes[0];
    if (
        parents.length !== 1
        || !parent
        || nodes.length !== 1
        || !(node instanceof HTMLSpanElement)
        || node.parentElement !== parent
        || parent.children.length !== 1
        || node.classList.length !== PUBLICATION_NODE_CLASS_NAMES.length
        || PUBLICATION_NODE_CLASS_NAMES.some(
            (className) => !node.classList.contains(className),
        )
        || node.textContent === ""
    ) {
        return null;
    }
    return node;
}

/**
 * Joins fixture-encoded DOM relationships to direct loaded records by identity.
 *
 * @returns - Complete relationship map, or null for ambiguity or invalidity.
 */
function collectFixtureEncodedRelationships():
ReadonlyMap<string, ExpectedChannelCard> | null {
    try {
        const { lockups, continuations } = readDirectChannelItems();
        if (
            lockups.length !== EXPECTED_CARDS.size
            || continuations.length !== 1
            || Object.keys(requireRecordAt(continuations, 0)).length !== 0
        ) {
            return null;
        }
        const loadedCards = lockups.map((lockup) => parseLoadedChannelCard(lockup));
        if (loadedCards.some((card) => card === null)) {
            return null;
        }
        const parsedLoadedCards = loadedCards.filter(
            (card): card is LoadedChannelCard => card !== null,
        );
        if (
            new Set(parsedLoadedCards.map(({ alias }) => alias)).size !==
                parsedLoadedCards.length
        ) {
            return null;
        }
        const cards = Array.from(document.querySelectorAll(CHANNEL_CARD_SELECTOR));
        if (cards.length !== parsedLoadedCards.length) {
            return null;
        }
        const relationships = new Map<string, ExpectedChannelCard>();
        for (const card of cards) {
            const alias = readFixtureEncodedAlias(card);
            const visiblePublication = readVisiblePublication(card);
            if (
                alias === null
                || visiblePublication === null
                || relationships.has(alias)
            ) {
                return null;
            }
            const loadedMatches = parsedLoadedCards.filter(
                (loadedCard) => loadedCard.alias === alias,
            );
            const loadedCard = loadedMatches[0];
            const expected = EXPECTED_CARDS.get(alias);
            if (
                loadedMatches.length !== 1
                || loadedCard === undefined
                || expected === undefined
                || visiblePublication.textContent !== loadedCard.label
                || visiblePublication.textContent !== expected.label
                || loadedCard.publicationRow !== expected.publicationRow
            ) {
                return null;
            }
            relationships.set(alias, {
                label: visiblePublication.textContent,
                publicationRow: loadedCard.publicationRow,
            });
        }
        return relationships.size === parsedLoadedCards.length
            ? relationships
            : null;
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
 * @param mutate - Mutation applied to direct Channel items.
 */
function mutateLoadedData(mutate: (items: DirectChannelItems) => void): void {
    const loadedData = readLoadedData();
    mutate(readDirectChannelItems(loadedData));
    writeLoadedData(loadedData);
}

/**
 * Replaces the first loaded and visible publication values together.
 *
 * @param value - Synthetic publication text.
 */
function setFirstPublicationText(value: string): void {
    mutateLoadedData(({ lockups }) => {
        requirePublicationText(requireRecordAt(lockups, 0), 0).content = value;
    });
    const publication = readVisiblePublication(requireFirstChannelCard());
    if (publication === null) {
        throw new Error("Expected first visible Channel publication");
    }
    publication.textContent = value;
}

/**
 * Moves the first row-zero publication into row one.
 */
function moveFirstPublicationToRowOne(): void {
    mutateLoadedData(({ lockups }) => {
        const lockup = requireRecordAt(lockups, 0);
        const publicationRow = readMetadataRows(lockup)[0];
        if (!publicationRow) {
            throw new Error("Expected first publication row");
        }
        readContentMetadata(lockup).metadataRows = [{}, publicationRow];
    });
}

/**
 * Appends one synthetic publication part to the first loaded row.
 *
 * @param value - Synthetic extra relative value.
 */
function appendFirstPublicationPart(value: string): void {
    mutateLoadedData(({ lockups }) => {
        const lockup = requireRecordAt(lockups, 0);
        const row = readMetadataRows(lockup)[0];
        if (!row) {
            throw new Error("Expected first publication row");
        }
        row.metadataParts = [
            ...requireArray(row.metadataParts, "metadataParts"),
            { text: { content: value } },
        ];
    });
}

describe("offline modern YouTube Channel Videos qualification", () => {
    let channelFixture = "";
    let homeFixture = "";
    let searchFixture = "";

    beforeAll(async () => {
        [channelFixture, homeFixture, searchFixture] = await Promise.all([
            readFile(CHANNEL_FIXTURE_PATH, "utf8"),
            readFile(HOME_FIXTURE_PATH, "utf8"),
            readFile(SEARCH_FIXTURE_PATH, "utf8"),
        ]);
    });

    beforeEach(() => {
        forbiddenFetch.mockClear();
        vi.stubGlobal("fetch", forbiddenFetch);
        document.documentElement.innerHTML = channelFixture;
    });

    afterEach(() => {
        const fetchCallCount = forbiddenFetch.mock.calls.length;
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
        restoreExactTimes(document);
        document.documentElement.innerHTML = "<head></head><body></body>";
        expect(fetchCallCount).toBe(0);
    });

    it("retains exactly six direct lockups and one empty continuation outer", () => {
        const { lockups, continuations } = readDirectChannelItems();

        expect(lockups).toHaveLength(6);
        expect(continuations).toHaveLength(1);
        expect(Object.keys(requireRecordAt(continuations, 0))).toEqual([]);
        expect(lockups.map((lockup) => Object.keys(lockup).sort())).toEqual(
            Array.from(
                { length: 6 },
                () => ["contentId", "contentType", "metadata"],
            ),
        );
        expect(lockups.map((lockup) => lockup.contentType)).toEqual(
            Array.from({ length: 6 }, () => CONTENT_TYPE_VIDEO),
        );
    });

    it("validates each identity-bound row variant instead of one global row", () => {
        const loadedCards = readDirectChannelItems().lockups.map((lockup) =>
            parseLoadedChannelCard(lockup));

        expect(loadedCards).toEqual(Array.from(
            EXPECTED_CARDS.entries(),
            ([alias, expected]) => ({ alias, ...expected }),
        ));
        expect(loadedCards.filter((card) => card?.publicationRow === 0)).toHaveLength(3);
        expect(loadedCards.filter((card) => card?.publicationRow === 1)).toHaveLength(3);
    });

    it("joins fixture-encoded aliases without asserting a production selector", () => {
        expect([...collectFixtureEncodedRelationships()?.entries() ?? []]).toEqual(
            [...EXPECTED_CARDS.entries()],
        );
    });

    it("retains only the structural and scalar privacy allowlists", () => {
        const loadedData = readLoadedData();
        const loadedStrings = collectLoadedStrings(loadedData);
        const expectedUniqueStrings = [
            CONTENT_TYPE_VIDEO,
            ...EXPECTED_CARDS.keys(),
            ...Array.from(EXPECTED_CARDS.values(), ({ label }) => label),
        ].sort();

        expect([...new Set(collectLoadedKeys(loadedData))].sort())
            .toEqual([...EXPECTED_LOADED_KEYS].sort());
        expect(loadedStrings).toHaveLength(18);
        expect([...new Set(loadedStrings)].sort()).toEqual(expectedUniqueStrings);
        expect(loadedStrings.filter((value) => value === CONTENT_TYPE_VIDEO))
            .toHaveLength(6);
        expect(Array.from(
            document.querySelectorAll(CHANNEL_CARD_SELECTOR),
            (card) => readFixtureEncodedAlias(card),
        )).toEqual([...EXPECTED_CARDS.keys()]);
        expect([...collectVisibleTextValues()].sort()).toEqual(
            Array.from(EXPECTED_CARDS.values(), ({ label }) => label).sort(),
        );
    });

    it("retains only empty structural placeholders around each publication", () => {
        for (const lockup of readDirectChannelItems().lockups) {
            const alias = lockup.contentId;
            const expected = typeof alias === "string"
                ? EXPECTED_CARDS.get(alias)
                : undefined;
            if (expected === undefined) {
                throw new Error("Expected known fixture alias");
            }
            const rows = readMetadataRows(lockup);
            expect(rows).toHaveLength(expected.publicationRow + 1);
            for (let rowIndex = 0; rowIndex < expected.publicationRow; rowIndex += 1) {
                expect(Object.keys(requireRecordAt(rows, rowIndex))).toEqual([]);
            }
            const parts = readMetadataParts(lockup, expected.publicationRow);
            expect(parts).toHaveLength(2);
            expect(Object.keys(requireRecordAt(parts, 0))).toEqual([]);
            expect(Object.keys(requirePublicationText(
                lockup,
                expected.publicationRow,
            ))).toEqual(["content"]);
        }
    });

    it("contains one empty DOM continuation and no additional result content", () => {
        const continuation = document.querySelectorAll(
            "ytd-continuation-item-renderer",
        );

        expect(document.querySelectorAll(CHANNEL_CARD_SELECTOR)).toHaveLength(6);
        expect(continuation).toHaveLength(1);
        expect(continuation[0]?.children).toHaveLength(0);
        expect(continuation[0]?.textContent).toBe("");
        expect(document.body.children).toHaveLength(7);
        expect(Array.from(document.body.children, (element) => element.localName))
            .toEqual([
                ...Array.from({ length: 6 }, () => CHANNEL_CARD_SELECTOR),
                "ytd-continuation-item-renderer",
            ]);
        expect(document.querySelector("img, picture, source, audio, video, time"))
            .toBeNull();
    });

    it("contains no copied private content, external source, or executable data", () => {
        const inertScript = requireFixtureElement(CHANNEL_LOADED_DATA_SELECTOR);
        const fixtureLowerCase = channelFixture.toLowerCase();
        const hrefs = Array.from(document.querySelectorAll("[href]"), (element) =>
            element.getAttribute("href"));

        expect(document.scripts).toHaveLength(1);
        expect(inertScript.getAttribute("type")).toBe("application/json");
        expect(document.querySelector('script:not([type="application/json"])')).toBeNull();
        expect(document.title).toBe("");
        expect(document.querySelector("title, [title], [aria-label], [src], [srcset]"))
            .toBeNull();
        expect(hrefs).toEqual(Array.from(
            EXPECTED_CARDS.keys(),
            (alias) => `/watch?v=${alias}`,
        ));
        expect(channelFixture).not.toMatch(/https?:\/\//iu);
        expect(channelFixture).not.toContain("@");
        expect(fixtureLowerCase).not.toMatch(
            /creator|avatar|thumbnail|tracking|visitor|cookie|token|storage|account/u,
        );
        expect(fixtureLowerCase).not.toMatch(
            /viewcounttext|continuationendpoint|replicateastimestamp/u,
        );
        expect(fixtureLowerCase).not.toMatch(/["']trigger["']\s*:/u);
        expect(Array.from(document.querySelectorAll("a"), (anchor) =>
            anchor.textContent)).toEqual(Array.from({ length: 6 }, () => ""));
    });

    it("contains no approved absolute or other date/time-like loaded candidate", () => {
        const stringPaths = collectLoadedStringPaths(readLoadedData());
        const relativeValues = Array.from(EXPECTED_CARDS.values(), ({ label }) => label);

        expect(stringPaths.filter(([, value]) => STRICT_CALENDAR_DATE.test(value)))
            .toEqual([]);
        expect(stringPaths.filter(([, value]) => EXPLICITLY_ZONED_INSTANT.test(value)))
            .toEqual([]);
        expect(stringPaths.filter(([path]) => DATE_OR_TIME_PATH.test(path))).toEqual([]);
        expect(stringPaths.filter(([, value]) => RELATIVE_LABEL_PATTERN.test(value)))
            .toHaveLength(6);
        expect(stringPaths.filter(([, value]) => RELATIVE_LABEL_PATTERN.test(value))
            .every(([path, value]) =>
                path.endsWith(".metadataParts[1].text.content")
                && relativeValues.includes(value))).toBe(true);
    });

    it.each([
        {
            name: "missing DOM identity carrier",
            mutate: () => {
                requireFirstChannelCard().querySelector("a")?.remove();
            },
        },
        {
            name: "duplicate DOM identity carrier",
            mutate: () => {
                const carrier = requireFirstChannelCard().querySelector("a");
                carrier?.after(carrier.cloneNode(true));
            },
        },
        {
            name: "missing loaded contentId",
            mutate: () => {
                mutateLoadedData(({ lockups }) => {
                    delete requireRecordAt(lockups, 0).contentId;
                });
            },
        },
        {
            name: "duplicate loaded contentId",
            mutate: () => {
                mutateLoadedData(({ lockups }) => {
                    requireRecordAt(lockups, 1).contentId = "chanVID0001";
                });
            },
        },
        {
            name: "short loaded contentId",
            mutate: () => {
                mutateLoadedData(({ lockups }) => {
                    requireRecordAt(lockups, 0).contentId = "invalid";
                });
            },
        },
        {
            name: "invalid-character loaded contentId",
            mutate: () => {
                mutateLoadedData(({ lockups }) => {
                    requireRecordAt(lockups, 0).contentId = "chanVID000!";
                });
            },
        },
        {
            name: "missing visible publication node",
            mutate: () => {
                readVisiblePublication(requireFirstChannelCard())?.remove();
            },
        },
        {
            name: "duplicate visible publication node",
            mutate: () => {
                const publication = readVisiblePublication(requireFirstChannelCard());
                publication?.after(publication.cloneNode(true));
            },
        },
        {
            name: "wrong visible publication tag",
            mutate: () => {
                const publication = readVisiblePublication(requireFirstChannelCard());
                if (publication) {
                    const replacement = document.createElement("div");
                    replacement.className = publication.className;
                    replacement.textContent = publication.textContent;
                    publication.replaceWith(replacement);
                }
            },
        },
        {
            name: "wrong visible publication parent",
            mutate: () => {
                requireFirstChannelCard().querySelector(
                    `.${PUBLICATION_PARENT_CLASS}`,
                )?.classList.remove(PUBLICATION_PARENT_CLASS);
            },
        },
        {
            name: "incomplete visible publication class set",
            mutate: () => {
                readVisiblePublication(requireFirstChannelCard())
                    ?.classList.remove(PUBLICATION_NODE_CLASS_NAMES[0]);
            },
        },
        {
            name: "missing loaded text content",
            mutate: () => {
                mutateLoadedData(({ lockups }) => {
                    delete requirePublicationText(
                        requireRecordAt(lockups, 0),
                        0,
                    ).content;
                });
            },
        },
        {
            name: "additional loaded text key",
            mutate: () => {
                mutateLoadedData(({ lockups }) => {
                    requirePublicationText(
                        requireRecordAt(lockups, 0),
                        0,
                    ).extra = "unapproved";
                });
            },
        },
        {
            name: "row-zero publication moved to row one",
            mutate: moveFirstPublicationToRowOne,
        },
        {
            name: "row-one publication moved to row zero",
            mutate: () => {
                mutateLoadedData(({ lockups }) => {
                    const lockup = requireRecordAt(lockups, 3);
                    const publicationRow = readMetadataRows(lockup)[1];
                    if (!publicationRow) {
                        throw new Error("Expected row-one publication");
                    }
                    readContentMetadata(lockup).metadataRows = [publicationRow];
                });
            },
        },
        {
            name: "multiple relative publication parts",
            mutate: () => {
                appendFirstPublicationPart("9 days ago");
            },
        },
        {
            name: "multiple exact label matches",
            mutate: () => {
                appendFirstPublicationPart("4 hours ago");
            },
        },
        {
            name: "DOM and loaded identity mismatch",
            mutate: () => {
                requireFirstChannelCard().querySelector("a")
                    ?.setAttribute("href", "/watch?v=chanVID0002");
            },
        },
        {
            name: "DOM and loaded label mismatch",
            mutate: () => {
                const publication = readVisiblePublication(requireFirstChannelCard());
                if (publication) {
                    publication.textContent = "9 days ago";
                }
            },
        },
        {
            name: "non-empty continuation outer",
            mutate: () => {
                mutateLoadedData(({ continuations }) => {
                    requireRecordAt(continuations, 0).trigger = "synthetic";
                });
            },
        },
    ])("rejects a $name fixture relationship", ({ mutate }) => {
        mutate();
        expect(collectFixtureEncodedRelationships()).toBeNull();
    });

    it("never promotes a nested continuation lockup to a direct video record", () => {
        mutateLoadedData(({ continuations }) => {
            requireRecordAt(continuations, 0).nested = {
                richItemRenderer: {
                    content: {
                        lockupViewModel: {
                            contentId: "chanVID0006",
                        },
                    },
                },
            };
        });

        expect(readDirectChannelItems().lockups).toHaveLength(6);
        expect(collectFixtureEncodedRelationships()).toBeNull();
    });

    it("matches only the generic timestamp rule on canonical Channel Videos", () => {
        expect(defaultRegistry.matching(CHANNEL_VIDEOS_URL).map((rule) => rule.id))
            .toEqual([GENERIC_TIME_RULE_ID]);
    });

    it("leaves the representative Channel document byte-equivalent", () => {
        const originalMarkup = document.documentElement.outerHTML;
        const originalLabels = Array.from(
            document.querySelectorAll(PUBLICATION_NODE_SELECTOR),
            (node) => node.textContent,
        );
        const originalContinuation = document.querySelector(
            "ytd-continuation-item-renderer",
        )?.outerHTML;

        expect(processDocument({ url: CHANNEL_VIDEOS_URL, root: document }))
            .toEqual([]);
        expect(document.documentElement.outerHTML).toBe(originalMarkup);
        expect(Array.from(
            document.querySelectorAll(PUBLICATION_NODE_SELECTOR),
            (node) => node.textContent,
        )).toEqual(originalLabels);
        expect(document.querySelector("ytd-continuation-item-renderer")?.outerHTML)
            .toBe(originalContinuation);
        expect(document.querySelector(`[${OWNED_SOURCE_ATTRIBUTE}]`)).toBeNull();
        expect(document.querySelector(`[${OWNED_OUTPUT_ATTRIBUTE}]`)).toBeNull();
    });

    it.each([
        {
            name: "missing loaded publication value",
            mutate: () => {
                mutateLoadedData(({ lockups }) => {
                    const parts = readMetadataParts(requireRecordAt(lockups, 0), 0);
                    delete requireRecordAt(parts, 1).text;
                });
            },
        },
        {
            name: "malformed loaded publication value",
            mutate: () => {
                mutateLoadedData(({ lockups }) => {
                    requireRecordAt(
                        readMetadataParts(requireRecordAt(lockups, 0), 0),
                        1,
                    ).text = { content: 42 };
                });
            },
        },
        {
            name: "relative-only loaded publication value",
            mutate: () => {
                setFirstPublicationText("9 days ago");
            },
        },
        {
            name: "synthetic unapproved strict-date text content",
            mutate: () => {
                setFirstPublicationText("2026-08-30");
            },
        },
        {
            name: "synthetic unapproved zoned-ISO text content",
            mutate: () => {
                setFirstPublicationText("2026-08-30T10:15:00Z");
            },
        },
        {
            name: "publication moved between captured rows",
            mutate: moveFirstPublicationToRowOne,
        },
        {
            name: "duplicate matching loaded publication parts",
            mutate: () => {
                appendFirstPublicationPart("4 hours ago");
            },
        },
        {
            name: "loaded and DOM identity mismatch",
            mutate: () => {
                requireFirstChannelCard().querySelector("a")
                    ?.setAttribute("href", "/watch?v=chanVID0002");
            },
        },
        {
            name: "loaded and DOM label mismatch",
            mutate: () => {
                const publication = readVisiblePublication(requireFirstChannelCard());
                if (publication) {
                    publication.textContent = "9 days ago";
                }
            },
        },
        {
            name: "synthetic date-looking DOM attributes",
            mutate: () => {
                const publication = readVisiblePublication(requireFirstChannelCard());
                publication?.setAttribute("data-published-at", "2026-08-30");
                publication?.setAttribute("aria-label", "2026-08-30T10:15:00Z");
            },
        },
        {
            name: "synthetic watch-only player assignment",
            mutate: () => {
                const script = document.createElement("script");
                document.head.append(script);
                script.textContent = `var ytInitialPlayerResponse = ${JSON.stringify({
                    videoDetails: { videoId: "chanVID0001" },
                    microformat: {
                        playerMicroformatRenderer: {
                            externalVideoId: "chanVID0001",
                            publishDate: "2026-08-30",
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
                metadata.setAttribute("content", "2026-08-30");
                document.head.append(metadata);
            },
        },
        {
            name: "synthetic replicateAsTimestamp overlay boolean",
            mutate: () => {
                mutateLoadedData(({ lockups }) => {
                    requireRecordAt(lockups, 0).inlinePlaybackBadgeData = {
                        replicateAsTimestamp: true,
                    };
                });
            },
        },
        {
            name: "synthetic continuation endpoint trigger and nested values",
            mutate: () => {
                mutateLoadedData(({ continuations }) => {
                    const continuation = requireRecordAt(continuations, 0);
                    continuation.continuationEndpoint = {
                        publishDate: "2026-08-30",
                    };
                    continuation.trigger = "2026-08-30T10:15:00Z";
                    continuation.nested = { datePublished: "2026-08-30" };
                });
            },
        },
    ])("ignores a $name", ({ mutate }) => {
        mutate();
        const mutatedMarkup = document.documentElement.outerHTML;

        expect(processDocument({ url: CHANNEL_VIDEOS_URL, root: document }))
            .toEqual([]);
        expect(document.documentElement.outerHTML).toBe(mutatedMarkup);
        expect(document.querySelector(`[${OWNED_SOURCE_ATTRIBUTE}]`)).toBeNull();
        expect(document.querySelector(`[${OWNED_OUTPUT_ATTRIBUTE}]`)).toBeNull();
    });

    it("requires a later HITL fallback decision without approving fallback", () => {
        const capturedFixtures = [
            {
                fixture: homeFixture,
                route: HOME_URL,
                surface: "home/captured-modern-lockup",
            },
            {
                fixture: searchFixture,
                route: SEARCH_URL,
                surface: "search/captured-legacy-main",
            },
            {
                fixture: channelFixture,
                route: CHANNEL_VIDEOS_URL,
                surface: "channel-videos/captured-modern-grid-lockup",
            },
        ] as const;

        for (const captured of capturedFixtures) {
            document.documentElement.innerHTML = captured.fixture;
            const originalMarkup = document.documentElement.outerHTML;

            expect(processDocument({ url: captured.route, root: document })).toEqual([]);
            expect(document.documentElement.outerHTML).toBe(originalMarkup);
        }

        const qualifications = {
            "home/captured-modern-lockup": "unsupported-local",
            "search/captured-legacy-main": "unsupported-local",
            "channel-videos/captured-modern-grid-lockup": "unsupported-local",
            locallyDeliveredSurface: null,
            fallbackDecision: "fallback-required",
            decisionOwner: "9-HITL",
        } as const;

        expect(qualifications).toEqual({
            "home/captured-modern-lockup": "unsupported-local",
            "search/captured-legacy-main": "unsupported-local",
            "channel-videos/captured-modern-grid-lockup": "unsupported-local",
            locallyDeliveredSurface: null,
            fallbackDecision: "fallback-required",
            decisionOwner: "9-HITL",
        });
        expect(qualifications.locallyDeliveredSurface).toBeNull();
        expect(qualifications.fallbackDecision).toBe("fallback-required");
        expect(qualifications.decisionOwner).toBe("9-HITL");
    });
});
