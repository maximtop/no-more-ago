/**
 * @file Proves the five recorded Bluesky surfaces through the public document controller.
 */

import { readFile } from "node:fs/promises";

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
/* eslint-disable @typescript-eslint/require-await */

import {
    BLUESKY_LOOKUP_STATUS,
    type BlueskyAppView,
    type BlueskyLookupResult,
    type BlueskyPostRecord,
    type BlueskyProfileRecord,
} from "../../../../src/content-script/adapters/bluesky-appview";
import {
    createBlueskyCoordinator,
} from "../../../../src/content-script/adapters/bluesky-coordinator";
import {
    BLUESKY_TARGET_ROLE,
    discoverBlueskyRelativeTargets,
    type BlueskyRelativeTarget,
} from "../../../../src/content-script/adapters/bluesky";
import {
    DocumentTransformationController,
} from "../../../../src/content-script/transformation/document-transformation-controller";
import type {
    DocumentTransformationParticipantFactory,
} from "../../../../src/content-script/transformation/document-transformation-participant";

const FIXTURE_NAMES = [
    "feed.html",
    "profile.html",
    "post.html",
    "thread.html",
    "quoted-post.html",
] as const;
const fixtures = new Map<string, string>();
const QUOTE_URI = "at://did:plc:quoted/app.bsky.feed.post/3quoted" as const;
const QUOTE_INDEXED_AT = "2026-08-30T09:00:00.000Z" as const;
const REPLACEMENT_QUOTE_INDEXED_AT = "2026-08-29T08:00:00.000Z" as const;
const timestamps: ReadonlyMap<string, string> = new Map([
    ["3feedalpha", "2026-08-31T10:01:00.000Z"],
    ["3feedbravo", "2026-08-31T10:02:00.000Z"],
    ["3profilealpha", "2026-08-31T10:03:00.000Z"],
    ["3replyalpha", "2026-08-31T10:04:00.000Z"],
    ["3replybravo", "2026-08-31T10:05:00.000Z"],
    ["3threadroot", "2026-08-31T10:06:00.000Z"],
    ["3threadreplyone", "2026-08-31T10:07:00.000Z"],
    ["3threadreplytwo", "2026-08-31T10:08:00.000Z"],
    ["3quotedouter", "2026-08-31T10:09:00.000Z"],
    ["3quotedreplacement", "2026-08-31T12:30:00.000Z"],
] as const);

/**
 * Manually settled asynchronous fixture work.
 */
interface Deferred<T> {
    /**
     * Promise settled by the test-controlled resolver.
     */
    readonly promise: Promise<T>;

    /**
     * Settles the promise with one typed result.
     */
    readonly resolve: (value: T) => void;
}

/**
 * Creates a manually settled promise for DOM race tests.
 *
 * @returns - Deferred promise and resolver.
 */
function createDeferred<T>(): Deferred<T> {
    let settle: ((value: T) => void) | undefined;
    const promise = new Promise<T>((resolve) => {
        settle = resolve;
    });
    return {
        promise,
        resolve: (value) => {
            if (!settle) {
                throw new Error("Deferred resolver unavailable");
            }
            settle(value);
        },
    };
}

/**
 * Returns a stable fictional DID for one permalink actor.
 *
 * @param actor - Actor requested through the profile method.
 * @returns - Matching fictional DID.
 */
function didForActor(actor: string): string {
    return actor.startsWith("did:")
        ? actor
        : `did:plc:${actor.replace(/[^A-Za-z0-9]/gu, "")}`;
}

/**
 * Extracts the record key from one coordinator-authored AT post URI.
 *
 * @param uri - Exact requested AT post URI.
 * @returns - Final record-key segment.
 */
function recordKeyFromUri(uri: string): string {
    return uri.slice(uri.lastIndexOf("/") + 1);
}

/**
 * Fake dataset shared by every required fixture surface.
 */
class FixtureAppView implements BlueskyAppView {
    /**
     * Profile batches observed by the fake.
     */
    readonly profileCalls: string[][] = [];

    /**
     * Post batches observed by the fake.
     */
    readonly postCalls: string[][] = [];

    /**
     * Creates a fixture dataset.
     *
     * @param includeQuote - Whether the outer quoted-post result contains a valid quote view.
     */
    constructor(private readonly includeQuote = true) {}

    /**
     * Resolves every fixture actor.
     *
     * @param actors - Requested fixture actors.
     * @returns - Matching actor-to-DID mappings.
     */
    async getProfiles(actors: readonly string[]) {
        this.profileCalls.push([...actors]);
        return {
            status: BLUESKY_LOOKUP_STATUS.SUCCESS,
            records: actors.map((actor) => ({ actor, did: didForActor(actor) })),
        } as const;
    }

    /**
     * Resolves every fixture outer post from the deterministic timestamp map.
     *
     * @param uris - Requested fixture AT post URIs.
     * @returns - Matching outer records and optional hydrated quote.
     */
    async getPosts(uris: readonly string[]) {
        this.postCalls.push([...uris]);
        const records: BlueskyPostRecord[] = [];
        for (const uri of uris) {
            const recordKey = recordKeyFromUri(uri);
            const indexedAt = timestamps.get(recordKey);
            if (!indexedAt) {
                continue;
            }
            const quoteIndexedAt = recordKey === "3quotedouter"
                ? QUOTE_INDEXED_AT
                : recordKey === "3quotedreplacement"
                    ? REPLACEMENT_QUOTE_INDEXED_AT
                    : undefined;
            records.push({
                uri,
                indexedAt,
                ...(quoteIndexedAt && this.includeQuote
                    ? { quote: { uri: QUOTE_URI, indexedAt: quoteIndexedAt } }
                    : {}),
            });
        }
        return { status: BLUESKY_LOOKUP_STATUS.SUCCESS, records } as const;
    }
}

/**
 * Page-owned DOM identities and values captured before rendering.
 */
interface DomSnapshot {
    /**
     * Descriptor observed before controller startup.
     */
    readonly descriptor: BlueskyRelativeTarget;

    /**
     * Original direct relative label.
     */
    readonly text: string;

    /**
     * Serialized source attributes in their original order.
     */
    readonly attributes: readonly (readonly [string, string])[];

    /**
     * Existing separator element retained beside the label.
     */
    readonly separator: Element | null;

    /**
     * Existing nearest post card retained around the source.
     */
    readonly card: Element | null;

    /**
     * Probe called through a page-owned event listener.
     */
    readonly listener: ReturnType<typeof vi.fn>;
}

/**
 * Captures page-owned nodes and values that rendering must not replace.
 *
 * @param descriptor - Pre-render source descriptor.
 * @returns - DOM identity and presentation snapshot.
 */
function snapshotDom(descriptor: BlueskyRelativeTarget): DomSnapshot {
    const listener = vi.fn();
    descriptor.source.addEventListener("fixture-probe", listener);
    return {
        descriptor,
        text: descriptor.target.data,
        attributes: [...descriptor.source.attributes].map(({ name, value }) => [name, value]),
        separator: descriptor.source.firstElementChild,
        card: descriptor.source.closest("article"),
        listener,
    };
}

/**
 * Returns expected custom UTC text for one fixture target.
 *
 * @param descriptor - Current fixture target.
 * @returns - Exact deterministic presentation text.
 */
function expectedText(descriptor: BlueskyRelativeTarget): string {
    if (descriptor.role === BLUESKY_TARGET_ROLE.QUOTE) {
        return "2026-08-30 09:00";
    }
    const value = timestamps.get(descriptor.outerIdentity.recordKey);
    if (!value) {
        throw new Error("Missing fixture timestamp");
    }
    return value.slice(0, 16).replace("T", " ");
}

/**
 * Composes the Bluesky participant used by a deterministic controller fixture.
 *
 * @param appView - Fake public dataset.
 * @returns - Generic document-participant factory.
 */
function participantFactoryFor(
    appView: BlueskyAppView,
): DocumentTransformationParticipantFactory {
    return (host) => createBlueskyCoordinator({
        document,
        url: new URL("https://bsky.app/"),
        appView,
        getDiagnosticSink: host.getDiagnosticSink,
        onSourcesChanged: host.onSourcesChanged,
    });
}

/**
 * Creates a fixture controller with deterministic custom UTC presentation.
 *
 * @param appView - Fake public dataset.
 * @returns - Inactive document controller.
 */
function createController(appView: BlueskyAppView): DocumentTransformationController {
    return new DocumentTransformationController({
        url: new URL("https://bsky.app/"),
        root: document,
        locales: ["en-US"],
        display: {
            formatMode: "custom",
            pattern: "yyyy-MM-dd HH:mm",
            timeZone: { mode: "utc" },
        },
        participantFactory: participantFactoryFor(appView),
    });
}

describe("Bluesky fixture surfaces", () => {
    beforeAll(async () => {
        for (const name of FIXTURE_NAMES) {
            fixtures.set(name, await readFile(
                `tests/src/content-script/fixtures/bluesky/${name}`,
                "utf8",
            ));
        }
    });

    beforeEach(() => {
        document.head.innerHTML = '<base href="https://bsky.app/">';
        document.body.innerHTML = "";
    });

    it.each(FIXTURE_NAMES)("renders and restores %s without replacing page DOM", async (name) => {
        document.body.innerHTML = fixtures.get(name) ?? "";
        const snapshots = discoverBlueskyRelativeTargets(document).map(snapshotDom);
        const appView = new FixtureAppView();
        const controller = createController(appView);
        try {
            controller.start();
            await vi.waitFor(() => {
                for (const { descriptor } of snapshots) {
                    expect(descriptor.target.data).toBe(expectedText(descriptor));
                }
            });

            for (const snapshot of snapshots) {
                const { descriptor } = snapshot;
                expect(descriptor.source.isConnected).toBe(true);
                expect(descriptor.source.contains(descriptor.target)).toBe(true);
                expect([...descriptor.source.attributes].map(({ name: key, value }) => {
                    return [key, value];
                })).toEqual(snapshot.attributes);
                expect(descriptor.source.firstElementChild).toBe(snapshot.separator);
                expect(descriptor.source.closest("article")).toBe(snapshot.card);
                descriptor.source.dispatchEvent(new Event("fixture-probe"));
                expect(snapshot.listener).toHaveBeenCalledTimes(1);
            }
            expect(document.querySelector("time[data-no-more-ago-output]")).toBeNull();
        } finally {
            controller.teardown();
        }
        for (const snapshot of snapshots) {
            expect(snapshot.descriptor.target.data).toBe(snapshot.text);
        }
    });

    it("leaves the expanded exact root byte-for-byte unchanged without requests", async () => {
        const template = document.createElement("template");
        template.innerHTML = fixtures.get("post.html") ?? "";
        const exactRoot = template.content.querySelector("#expanded-root");
        if (!exactRoot) {
            throw new Error("Expected expanded exact root fixture");
        }
        document.body.replaceChildren(exactRoot);
        const before = document.body.innerHTML;
        const appView = new FixtureAppView();
        const controller = createController(appView);

        controller.start();
        await Promise.resolve();
        await Promise.resolve();

        expect(document.body.innerHTML).toBe(before);
        expect(document.querySelector("[data-no-more-ago-source]")).toBeNull();
        expect(document.querySelector("[data-no-more-ago-output]")).toBeNull();
        expect(appView.profileCalls).toEqual([]);
        expect(appView.postCalls).toEqual([]);
        controller.teardown();
    });

    it("uses one outer response for distinct outer and quote timestamps", async () => {
        document.body.innerHTML = fixtures.get("quoted-post.html") ?? "";
        const targets = discoverBlueskyRelativeTargets(document);
        const appView = new FixtureAppView();
        const controller = createController(appView);
        controller.start();
        await vi.waitFor(() => {
            expect(targets.map(({ target }) => target.data)).toEqual([
                "2026-08-31 10:09",
                "2026-08-30 09:00",
            ]);
        });

        expect(appView.profileCalls).toHaveLength(1);
        expect(appView.postCalls).toHaveLength(1);
        expect(appView.postCalls.flat()).not.toContain(QUOTE_URI);
        controller.teardown();
    });

    it("re-resolves an outer post and its quote after the permalink changes", async () => {
        document.body.innerHTML = fixtures.get("quoted-post.html") ?? "";
        const outer = document.getElementById("quoted-outer-time");
        const outerTarget = outer?.lastChild;
        const quoteTarget = document.getElementById("quoted-inner-time")?.lastChild;
        if (!outer || !(outerTarget instanceof Text) || !(quoteTarget instanceof Text)) {
            throw new Error("Expected quoted-post labels");
        }
        const appView = new FixtureAppView();
        const controller = createController(appView);
        controller.start();
        await vi.waitFor(() => {
            expect(outerTarget.data).toBe("2026-08-31 10:09");
            expect(quoteTarget.data).toBe("2026-08-30 09:00");
        });

        outer.setAttribute(
            "href",
            "/profile/alice.example/post/3quotedreplacement",
        );

        await vi.waitFor(() => {
            expect(outerTarget.data).toBe("2026-08-31 12:30");
            expect(quoteTarget.data).toBe("2026-08-29 08:00");
        });
        expect(appView.profileCalls).toHaveLength(1);
        expect(appView.postCalls).toHaveLength(2);
        controller.teardown();
    });

    it.each(["blocked", "missing", "malformed", "ambiguous"])(
        "changes only the outer label for an unavailable %s quote",
        async (variant) => {
            document.body.innerHTML = fixtures.get("quoted-post.html") ?? "";
            if (variant === "ambiguous") {
                const quote = document.getElementById("quoted-inner-time");
                quote?.parentElement?.append(quote.cloneNode(true));
            }
            const originalQuote = document.getElementById("quoted-inner-time")?.lastChild;
            const outer = document.getElementById("quoted-outer-time")?.lastChild;
            if (!(originalQuote instanceof Text) || !(outer instanceof Text)) {
                throw new Error("Expected quote fixture labels");
            }
            const appView = new FixtureAppView(false);
            const controller = createController(appView);
            controller.start();
            await vi.waitFor(() => {
                expect(outer.data).toBe("2026-08-31 10:09");
            });

            expect(originalQuote.data).toBe("1d");
            expect(appView.profileCalls).toHaveLength(1);
            expect(appView.postCalls).toHaveLength(1);
            controller.teardown();
        },
    );

    it(
        "renders only the current post after pending identity, target, move, and replacement",
        async () => {
            document.body.innerHTML = '<main><section id="first"></section>'
            + '<section id="second"></section></main>';
            const profileWork: Array<Deferred<BlueskyLookupResult<BlueskyProfileRecord>>> = [];
            const postWork: Array<Deferred<BlueskyLookupResult<BlueskyPostRecord>>> = [];
            const profileCalls: string[][] = [];
            const postCalls: string[][] = [];
            const appView: BlueskyAppView = {
                getProfiles: async (actors) => {
                    profileCalls.push([...actors]);
                    const work = createDeferred<BlueskyLookupResult<BlueskyProfileRecord>>();
                    profileWork.push(work);
                    return work.promise;
                },
                getPosts: async (uris) => {
                    postCalls.push([...uris]);
                    const work = createDeferred<BlueskyLookupResult<BlueskyPostRecord>>();
                    postWork.push(work);
                    return work.promise;
                },
            };
            const controller = createController(appView);
            controller.start();

            const article = document.createElement("article");
            article.innerHTML = `<a id="pending-source"
            href="/profile/first.example/post/3first"
            aria-label="localized" data-tooltip="localized">
            <span aria-hidden="true">· </span>2h</a>`;
            document.getElementById("first")?.append(article);
            await vi.waitFor(() => {
                expect(profileCalls).toHaveLength(1);
            });
            const source = document.getElementById("pending-source");
            const oldTarget = source?.lastChild;
            if (!source || !(oldTarget instanceof Text)) {
                throw new Error("Expected pending source");
            }
            source.setAttribute("href", "/profile/second.example/post/3second");
            const replacementTarget = document.createTextNode("page replacement");
            oldTarget.replaceWith(replacementTarget);
            document.getElementById("second")?.append(article);
            profileWork[0]?.resolve({
                status: BLUESKY_LOOKUP_STATUS.SUCCESS,
                records: [{ actor: "first.example", did: "did:plc:first" }],
            });
            await vi.waitFor(() => {
                expect(profileCalls).toHaveLength(2);
            });
            profileWork[1]?.resolve({
                status: BLUESKY_LOOKUP_STATUS.SUCCESS,
                records: [{ actor: "second.example", did: "did:plc:second" }],
            });
            await vi.waitFor(() => {
                expect(postCalls).toHaveLength(1);
            });

            const currentArticle = document.createElement("article");
            currentArticle.innerHTML = `<a id="current-source"
            href="/profile/current.example/post/3current"
            aria-label="localized" data-tooltip="localized">
            <span aria-hidden="true">· </span>now</a>`;
            article.replaceWith(currentArticle);
            postWork[0]?.resolve({
                status: BLUESKY_LOOKUP_STATUS.SUCCESS,
                records: [{
                    uri: postCalls[0]?.[0] ?? "",
                    indexedAt: "2026-08-31T08:00:00.000Z",
                }],
            });
            await vi.waitFor(() => {
                expect(profileCalls).toHaveLength(3);
            });
            profileWork[2]?.resolve({
                status: BLUESKY_LOOKUP_STATUS.SUCCESS,
                records: [{ actor: "current.example", did: "did:plc:current" }],
            });
            await vi.waitFor(() => {
                expect(postCalls).toHaveLength(2);
            });
            postWork[1]?.resolve({
                status: BLUESKY_LOOKUP_STATUS.SUCCESS,
                records: [{
                    uri: postCalls[1]?.[0] ?? "",
                    indexedAt: "2026-08-31T11:00:00.000Z",
                }],
            });
            const currentTarget = document.getElementById("current-source")?.lastChild;
            if (!(currentTarget instanceof Text)) {
                throw new Error("Expected current target");
            }
            await vi.waitFor(() => {
                expect(currentTarget.data).toBe("2026-08-31 11:00");
            });

            expect(article.isConnected).toBe(false);
            expect(source.isConnected).toBe(false);
            expect(replacementTarget.data).toBe("page replacement");
            expect(oldTarget.data).toBe("2h");
            expect(document.getElementById("pending-source")).toBeNull();
            controller.teardown();
            expect(currentTarget.data).toBe("now");
        },
    );

    it("retargets a replaced quote card while its outer post is pending", async () => {
        document.body.innerHTML = fixtures.get("quoted-post.html") ?? "";
        const posts = createDeferred<BlueskyLookupResult<BlueskyPostRecord>>();
        const postCalls: string[][] = [];
        const appView: BlueskyAppView = {
            getProfiles: async (actors) => ({
                status: BLUESKY_LOOKUP_STATUS.SUCCESS,
                records: actors.map((actor) => ({ actor, did: "did:plc:outer" })),
            }),
            getPosts: async (uris) => {
                postCalls.push([...uris]);
                return posts.promise;
            },
        };
        const controller = createController(appView);
        controller.start();
        await vi.waitFor(() => {
            expect(postCalls).toHaveLength(1);
        });

        const oldCard = document.getElementById("quoted-card");
        const oldTarget = document.getElementById("quoted-inner-time")?.lastChild;
        if (!oldCard || !(oldTarget instanceof Text)) {
            throw new Error("Expected pending quote card");
        }
        const replacementCard = oldCard.cloneNode(true) as Element;
        replacementCard.id = "replacement-quote-card";
        oldCard.replaceWith(replacementCard);
        await Promise.resolve();
        await Promise.resolve();
        posts.resolve({
            status: BLUESKY_LOOKUP_STATUS.SUCCESS,
            records: [{
                uri: postCalls[0]?.[0] ?? "",
                indexedAt: "2026-08-31T10:09:00.000Z",
                quote: { uri: QUOTE_URI, indexedAt: QUOTE_INDEXED_AT },
            }],
        });
        const outerTarget = document.getElementById("quoted-outer-time")?.lastChild;
        const newTarget = replacementCard.querySelector("#quoted-inner-time")?.lastChild;
        if (!(outerTarget instanceof Text) || !(newTarget instanceof Text)) {
            throw new Error("Expected replacement quote labels");
        }
        await vi.waitFor(() => {
            expect(outerTarget.data).toBe("2026-08-31 10:09");
            expect(newTarget.data).toBe("2026-08-30 09:00");
        });

        expect(oldCard.isConnected).toBe(false);
        expect(oldTarget.data).toBe("1d");
        expect(postCalls).toHaveLength(1);
        controller.teardown();
    });

    it(
        "keeps the latest page label as restoration baseline across eligibility and restart",
        async () => {
            document.body.innerHTML = fixtures.get("profile.html") ?? "";
            const appView = new FixtureAppView();
            const controller = createController(appView);
            const source = document.getElementById("profile-time");
            const target = source?.lastChild;
            if (!source || !(target instanceof Text)) {
                throw new Error("Expected profile fixture target");
            }
            controller.start();
            await vi.waitFor(() => {
                expect(target.data).toBe("2026-08-31 10:03");
            });

            target.data = "page refreshed relative";
            await vi.waitFor(() => {
                expect(target.data).toBe("2026-08-31 10:03");
            });
            source.removeAttribute("aria-label");
            await vi.waitFor(() => {
                expect(target.data).toBe("page refreshed relative");
            });
            source.setAttribute("aria-label", "new localized presentation");
            await vi.waitFor(() => {
                expect(target.data).toBe("2026-08-31 10:03");
            });
            expect(document.querySelectorAll("[data-no-more-ago-output]")).toHaveLength(0);

            controller.teardown();
            expect(target.data).toBe("page refreshed relative");
            controller.start();
            await vi.waitFor(() => {
                expect(target.data).toBe("2026-08-31 10:03");
            });
            expect(appView.profileCalls).toHaveLength(3);
            expect(appView.postCalls).toHaveLength(3);
            controller.teardown();
            expect(target.data).toBe("page refreshed relative");
        },
    );

    it("leaves a resolved label unchanged when formatting fails", async () => {
        document.body.innerHTML = fixtures.get("profile.html") ?? "";
        const appView = new FixtureAppView();
        const source = document.getElementById("profile-time");
        const target = source?.lastChild;
        if (!source || !(target instanceof Text)) {
            throw new Error("Expected formatter-failure target");
        }
        const controller = new DocumentTransformationController({
            url: new URL("https://bsky.app/"),
            root: document,
            locales: ["en-US"],
            display: {
                formatMode: "custom",
                pattern: "yyyy ff",
                timeZone: { mode: "utc" },
            },
            participantFactory: participantFactoryFor(appView),
        });
        controller.start();
        await vi.waitFor(() => {
            expect(appView.postCalls).toHaveLength(1);
        });
        await Promise.resolve();

        expect(target.data).toBe("1d");
        expect(source.querySelector("button")).toBeNull();
        expect(document.querySelector("[data-no-more-ago-output]")).toBeNull();
        controller.teardown();
    });
});
