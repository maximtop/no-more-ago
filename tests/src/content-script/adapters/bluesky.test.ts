/**
 * @file Verifies Bluesky URL, DOM, identity, and synchronous source contracts.
 */

import { readFile } from "node:fs/promises";

import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
    BLUESKY_ADAPTER_ID,
    BLUESKY_TARGET_ROLE,
    createBlueskyAdapter,
    discoverBlueskyRelativeTargets,
    matchesBlueskyUrl,
    parseBlueskyPostPermalink,
    type ResolvedBlueskyTarget,
} from "../../../../src/content-script/adapters/bluesky";
import { GENERIC_TIME_RULE_ID } from "../../../../src/content-script/adapters/generic-time";
import { INSTAGRAM_ADAPTER_ID } from "../../../../src/content-script/adapters/instagram";
import { defaultRegistry } from "../../../../src/content-script/adapters/registry";
import {
    TIMESTAMP_PRESENTATION_KIND,
    TIMESTAMP_SOURCE_KIND,
    TIMESTAMP_VALIDATION_RULE,
    TIMESTAMP_VISIBILITY_POLICY,
} from "../../../../src/content-script/adapters/types";

const FIXTURE_NAMES = [
    "feed.html",
    "profile.html",
    "post.html",
    "thread.html",
    "quoted-post.html",
] as const;
const fixtures = new Map<string, string>();

/**
 * Returns one required fixture element.
 *
 * @param id - Element identifier to resolve.
 * @returns - Matching element.
 */
function requireElement(id: string): Element {
    const element = document.getElementById(id);
    if (!element) {
        throw new Error(`Expected fixture element ${id}`);
    }
    return element;
}

describe("Bluesky source contract", () => {
    beforeAll(async () => {
        for (const name of FIXTURE_NAMES) {
            const path = `tests/src/content-script/fixtures/bluesky/${name}`;
            fixtures.set(name, await readFile(path, "utf8"));
        }
    });

    beforeEach(() => {
        document.head.innerHTML = '<base href="https://bsky.app/">';
        document.body.innerHTML = "";
    });

    it.each([
        ["https://bsky.app/", true],
        ["http://bsky.app/profile/alice.example", true],
        ["https://www.bsky.app/", false],
        ["https://sub.bsky.app/", false],
        ["https://bsky.app.example/", false],
        ["https://example.test/bsky.app", false],
        ["file:///profile/alice.example", false],
    ])("matches %s as %s", (value, expected) => {
        expect(matchesBlueskyUrl(new URL(value))).toBe(expected);
    });

    it("parses only canonical public post permalinks", () => {
        document.body.innerHTML = `
            <a id="handle" href="/profile/Alice.Example/post/3alpha"></a>
            <a id="did" href="https://bsky.app/profile/did:plc:AbC123/post/3bravo"></a>`;

        expect(parseBlueskyPostPermalink(requireElement("handle"))).toEqual({
            actor: "alice.example",
            recordKey: "3alpha",
            key: "alice.example\u00003alpha",
        });
        expect(parseBlueskyPostPermalink(requireElement("did"))).toEqual({
            actor: "did:plc:AbC123",
            recordKey: "3bravo",
            key: "did:plc:AbC123\u00003bravo",
        });
    });

    it.each([
        "/profile/alice.example",
        "/profile/alice.example/post/",
        "/profile/alice.example/post/3alpha/extra",
        "/profile/singlelabel/post/3alpha",
        "/profile/-alice.example/post/3alpha",
        "/profile/alice.example/post/not%2Fa%2Fkey",
        "/profile/%E0%A4%A/post/3alpha",
        "https://user@bsky.app/profile/alice.example/post/3alpha",
        "https://bsky.app:444/profile/alice.example/post/3alpha",
        "https://example.test/profile/alice.example/post/3alpha",
    ])("rejects malformed permalink %s", (href) => {
        const anchor = document.createElement("a");
        anchor.setAttribute("href", href);
        document.body.append(anchor);
        expect(parseBlueskyPostPermalink(anchor)).toBeNull();
    });

    it("discovers relative targets on all required fixture shapes", () => {
        const expected = new Map([
            ["feed.html", 3],
            ["profile.html", 1],
            ["post.html", 2],
            ["thread.html", 3],
            ["quoted-post.html", 2],
        ]);

        for (const [name, count] of expected) {
            document.body.innerHTML = fixtures.get(name) ?? "";
            const targets = discoverBlueskyRelativeTargets(document);
            expect(targets, name).toHaveLength(count);
            expect(targets.every(({ source, target }) => source.contains(target)), name)
                .toBe(true);
        }

        document.body.innerHTML = fixtures.get("post.html") ?? "";
        expect(discoverBlueskyRelativeTargets(document)
            .some(({ source }) => source.id === "expanded-root-exact")).toBe(false);
    });

    it("associates one quote with its outer identity without reading presentation text", () => {
        document.body.innerHTML = fixtures.get("quoted-post.html") ?? "";
        const before = discoverBlueskyRelativeTargets(document);
        const quote = before.find(({ role }) => role === BLUESKY_TARGET_ROLE.QUOTE);
        expect(quote?.outerIdentity).toMatchObject({
            actor: "alice.example",
            recordKey: "3quotedouter",
        });
        const quoteSource = requireElement("quoted-inner-time");
        quoteSource.setAttribute("aria-label", "完全に異なる表示");
        quoteSource.setAttribute("data-tooltip", "autre présentation");
        if (quote?.target) {
            quote.target.data = " другой текст";
        }
        const after = discoverBlueskyRelativeTargets(document)
            .find(({ role }) => role === BLUESKY_TARGET_ROLE.QUOTE);
        expect(after?.outerIdentity).toEqual(quote?.outerIdentity);
        expect(after?.fingerprint).toBe(quote?.fingerprint);
        expect(after?.fingerprint).not.toContain("présentation");
        expect(after?.fingerprint).not.toContain("текст");
    });

    it("emits a candidate only for a matching injected resolution", () => {
        document.body.innerHTML = fixtures.get("profile.html") ?? "";
        const descriptor = discoverBlueskyRelativeTargets(document)[0];
        if (!descriptor) {
            throw new Error("Expected Bluesky descriptor");
        }
        const resolutions = new Map<Element, ResolvedBlueskyTarget>();
        const adapter = createBlueskyAdapter((source) => resolutions.get(source));
        expect(adapter.discover(document)).toEqual([]);
        expect(adapter.matchesElement(descriptor.source)).toBe(true);

        resolutions.set(descriptor.source, {
            target: descriptor.target,
            fingerprint: descriptor.fingerprint,
            indexedAt: "2026-08-31T10:15:00.000Z",
        });
        expect(adapter.discover(document)).toEqual([descriptor.source]);
        expect(adapter.extract(descriptor.source)).toEqual({
            ruleId: BLUESKY_ADAPTER_ID,
            source: descriptor.source,
            sourceKind: TIMESTAMP_SOURCE_KIND.BLUESKY_POST,
            rawDatetime: "2026-08-31T10:15:00.000Z",
            presentation: {
                kind: TIMESTAMP_PRESENTATION_KIND.IN_PLACE_TEXT,
                target: descriptor.target,
            },
            validationRule: TIMESTAMP_VALIDATION_RULE.EXPLICIT_ISO_ZONE,
            visibilityPolicy: TIMESTAMP_VISIBILITY_POLICY.IGNORE_PAGE_SUPPRESSION,
        });
    });

    it("composes a document-scoped rule first without losing production rules", () => {
        document.body.innerHTML = fixtures.get("profile.html") ?? "";
        const adapter = createBlueskyAdapter(() => undefined);
        const composed = defaultRegistry.withSpecialized(adapter);
        const ids = composed.matching(new URL("https://bsky.app/")).map(({ id }) => id);
        expect(ids[0]).toBe(BLUESKY_ADAPTER_ID);
        expect(ids.at(-1)).toBe(GENERIC_TIME_RULE_ID);
        expect(defaultRegistry.matching(new URL("https://www.instagram.com/"))
            .map(({ id }) => id)).toContain(INSTAGRAM_ADAPTER_ID);
        expect(composed.withSpecialized(adapter).matching(new URL("https://bsky.app/"))
            .filter(({ id }) => id === BLUESKY_ADAPTER_ID)).toHaveLength(1);
    });
});
