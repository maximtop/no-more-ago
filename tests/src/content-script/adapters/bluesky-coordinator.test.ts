/**
 * @file Verifies document-local Bluesky batching, caching, and stale-result control.
 */

import { readFile } from "node:fs/promises";

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
/* eslint-disable @typescript-eslint/require-await */

import {
    BLUESKY_BATCH_LIMIT,
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
} from "../../../../src/content-script/adapters/bluesky";
import {
    DIAGNOSTIC_CATEGORY,
    DIAGNOSTIC_REASON,
} from "../../../../src/shared/diagnostics/contracts";
import type {
    DiagnosticEventInput,
} from "../../../../src/shared/diagnostics/events";

const INDEXED_AT = "2026-08-31T10:15:00.000Z" as const;
const QUOTE_INDEXED_AT = "2026-08-30T09:00:00.000Z" as const;
let feedFixture = "";
let quoteFixture = "";

/**
 * Typed profile lookup result used by fake handlers.
 */
type ProfileResult = BlueskyLookupResult<BlueskyProfileRecord>;

/**
 * Typed post lookup result used by fake handlers.
 */
type PostResult = BlueskyLookupResult<BlueskyPostRecord>;

/**
 * Manually settled asynchronous work.
 */
interface Deferred<T> {
    /**
     * Promise exposed to the fake AppView.
     */
    readonly promise: Promise<T>;

    /**
     * Test-owned resolver for the pending result.
     */
    readonly resolve: (value: T) => void;
}

/**
 * Creates a manually settled promise for in-flight lifecycle tests.
 *
 * @returns - Deferred promise and resolver.
 */
function createDeferred<T>(): Deferred<T> {
    let resolvePromise: ((value: T) => void) | undefined;
    const promise = new Promise<T>((resolve) => {
        resolvePromise = resolve;
    });
    return {
        promise,
        resolve: (value) => {
            if (!resolvePromise) {
                throw new Error("Deferred resolver unavailable");
            }
            resolvePromise(value);
        },
    };
}

/**
 * Returns a deterministic fictional DID for one actor.
 *
 * @param actor - Public actor requested by the coordinator.
 * @returns - Matching fictional DID.
 */
function didForActor(actor: string): string {
    return actor.startsWith("did:")
        ? actor
        : `did:plc:${actor.replace(/[^A-Za-z0-9]/gu, "")}`;
}

/**
 * Returns a successful fake profile response in reverse order.
 *
 * @param actors - Requested actors.
 * @returns - Matching public profile records.
 */
function resolveProfiles(actors: readonly string[]): ProfileResult {
    return {
        status: BLUESKY_LOOKUP_STATUS.SUCCESS,
        records: [...actors].reverse().map((actor) => ({ actor, did: didForActor(actor) })),
    };
}

/**
 * Returns a successful fake post response in reverse order.
 *
 * @param uris - Requested AT post URIs.
 * @returns - Matching server-observed timestamps.
 */
function resolvePosts(uris: readonly string[]): PostResult {
    return {
        status: BLUESKY_LOOKUP_STATUS.SUCCESS,
        records: [...uris].reverse().map((uri) => ({ uri, indexedAt: INDEXED_AT })),
    };
}

/**
 * Inspectable fake AppView with overridable asynchronous handlers.
 */
class FakeAppView implements BlueskyAppView {
    /**
     * Profile batches observed in call order.
     */
    readonly profileCalls: string[][] = [];

    /**
     * Post batches observed in call order.
     */
    readonly postCalls: string[][] = [];

    /**
     * Creates an AppView double.
     *
     * @param profileHandler - Optional profile lookup implementation.
     * @param postHandler - Optional post lookup implementation.
     */
    constructor(
        private readonly profileHandler: (
            actors: readonly string[],
            signal: AbortSignal,
        ) => Promise<ProfileResult> = async (actors) => resolveProfiles(actors),
        private readonly postHandler: (
            uris: readonly string[],
            signal: AbortSignal,
        ) => Promise<PostResult> = async (uris) => resolvePosts(uris),
    ) {}

    /**
     * Records and resolves one profile batch.
     *
     * @param actors - Requested actors.
     * @param signal - Lifecycle cancellation signal.
     * @returns - Configured lookup result.
     */
    async getProfiles(actors: readonly string[], signal: AbortSignal): Promise<ProfileResult> {
        this.profileCalls.push([...actors]);
        return this.profileHandler(actors, signal);
    }

    /**
     * Records and resolves one post batch.
     *
     * @param uris - Requested AT post URIs.
     * @param signal - Lifecycle cancellation signal.
     * @returns - Configured lookup result.
     */
    async getPosts(uris: readonly string[], signal: AbortSignal): Promise<PostResult> {
        this.postCalls.push([...uris]);
        return this.postHandler(uris, signal);
    }
}

/**
 * Installs deterministic relative post targets in the current document.
 *
 * @param count - Number of unique post identities to install.
 */
function installTargets(count: number): void {
    document.body.innerHTML = Array.from({ length: count }, (_, index) => {
        const suffix = String(index).padStart(2, "0");
        return `<article><a id="source-${suffix}"
            href="/profile/actor-${suffix}.example/post/3record${suffix}"
            aria-label="localized" data-tooltip="localized">
            <span aria-hidden="true">· </span>2h</a></article>`;
    }).join("");
}

/**
 * Waits until every current Bluesky source exposes a resolution.
 *
 * @param coordinator - Active coordinator whose rule is inspected.
 * @param expected - Expected resolved source count.
 */
async function waitForResolvedSources(
    coordinator: ReturnType<typeof createBlueskyCoordinator>,
    expected: number,
): Promise<void> {
    await vi.waitFor(() => {
        const resolved = discoverBlueskyRelativeTargets(document)
            .filter(({ source }) => coordinator.rule.extract(source) !== null);
        expect(resolved).toHaveLength(expected);
    });
}

describe("Bluesky coordinator", () => {
    beforeAll(async () => {
        feedFixture = await readFile(
            "tests/src/content-script/fixtures/bluesky/feed.html",
            "utf8",
        );
        quoteFixture = await readFile(
            "tests/src/content-script/fixtures/bluesky/quoted-post.html",
            "utf8",
        );
    });

    beforeEach(() => {
        document.head.innerHTML = '<base href="https://bsky.app/">';
        document.body.innerHTML = "";
    });

    it.each([1, BLUESKY_BATCH_LIMIT, BLUESKY_BATCH_LIMIT + 1])(
        "batches and resolves %i unique identities",
        async (count) => {
            installTargets(count);
            const appView = new FakeAppView();
            const changed: Element[][] = [];
            const coordinator = createBlueskyCoordinator({
                document,
                url: new URL("https://bsky.app/"),
                appView,
                getDiagnosticSink: () => undefined,
                onSourcesChanged: (sources) => changed.push([...sources]),
            });

            coordinator.start();
            coordinator.inspect(document);
            await waitForResolvedSources(coordinator, count);

            expect(appView.profileCalls.flat()).toHaveLength(count);
            expect(appView.postCalls.flat()).toHaveLength(count);
            expect(appView.profileCalls.every((batch) => {
                return batch.length <= BLUESKY_BATCH_LIMIT;
            })).toBe(true);
            expect(appView.postCalls.every((batch) => {
                return batch.length <= BLUESKY_BATCH_LIMIT;
            })).toBe(true);
            expect(appView.profileCalls)
                .toHaveLength(Math.ceil(count / BLUESKY_BATCH_LIMIT));
            expect(appView.postCalls)
                .toHaveLength(Math.ceil(count / BLUESKY_BATCH_LIMIT));
            expect(new Set(changed.flat())).toHaveLength(count);
        },
    );

    it("runs at most one public batch at a time", async () => {
        installTargets(BLUESKY_BATCH_LIMIT + 1);
        let activeProfiles = 0;
        let activePosts = 0;
        let maximumProfiles = 0;
        let maximumPosts = 0;
        const appView = new FakeAppView(
            async (actors) => {
                activeProfiles += 1;
                maximumProfiles = Math.max(maximumProfiles, activeProfiles);
                await Promise.resolve();
                activeProfiles -= 1;
                return resolveProfiles(actors);
            },
            async (uris) => {
                activePosts += 1;
                maximumPosts = Math.max(maximumPosts, activePosts);
                await Promise.resolve();
                activePosts -= 1;
                return resolvePosts(uris);
            },
        );
        const coordinator = createBlueskyCoordinator({
            document,
            url: new URL("https://bsky.app/"),
            appView,
            getDiagnosticSink: () => undefined,
            onSourcesChanged: () => undefined,
        });

        coordinator.start();
        coordinator.inspect(document);
        await waitForResolvedSources(coordinator, BLUESKY_BATCH_LIMIT + 1);

        expect(maximumProfiles).toBe(1);
        expect(maximumPosts).toBe(1);
    });

    it("uses a permalink DID without a profile lookup", async () => {
        document.body.innerHTML = `<article><a
            href="/profile/did:plc:directactor/post/3direct"
            aria-label="localized" data-tooltip="localized">
            <span aria-hidden="true">· </span>2h</a></article>`;
        const appView = new FakeAppView();
        const coordinator = createBlueskyCoordinator({
            document,
            url: new URL("https://bsky.app/"),
            appView,
            getDiagnosticSink: () => undefined,
            onSourcesChanged: () => undefined,
        });

        coordinator.start();
        coordinator.inspect(document);
        await waitForResolvedSources(coordinator, 1);

        expect(appView.profileCalls).toEqual([]);
        expect(appView.postCalls).toEqual([
            ["at://did:plc:directactor/app.bsky.feed.post/3direct"],
        ]);
    });

    it("deduplicates fixture identities and reuses successful document caches", async () => {
        document.body.innerHTML = feedFixture;
        const appView = new FakeAppView();
        const coordinator = createBlueskyCoordinator({
            document,
            url: new URL("https://bsky.app/"),
            appView,
            getDiagnosticSink: () => undefined,
            onSourcesChanged: () => undefined,
        });
        coordinator.start();
        coordinator.inspect(document);
        await waitForResolvedSources(coordinator, 3);

        expect(appView.profileCalls).toHaveLength(1);
        expect(appView.profileCalls[0]).toHaveLength(1);
        expect(appView.postCalls).toHaveLength(1);
        expect(appView.postCalls[0]).toHaveLength(2);

        const firstCard = document.getElementById("feed-first");
        if (!firstCard) {
            throw new Error("Expected feed fixture card");
        }
        const clone = firstCard.cloneNode(true) as Element;
        clone.removeAttribute("id");
        document.body.append(clone);
        coordinator.inspect(clone);
        await waitForResolvedSources(coordinator, 4);

        expect(appView.profileCalls).toHaveLength(1);
        expect(appView.postCalls).toHaveLength(1);
    });

    it("evicts lookup state after the final source for an identity detaches", async () => {
        installTargets(1);
        const appView = new FakeAppView();
        const coordinator = createBlueskyCoordinator({
            document,
            url: new URL("https://bsky.app/"),
            appView,
            getDiagnosticSink: () => undefined,
            onSourcesChanged: () => undefined,
        });
        coordinator.start();
        coordinator.inspect(document);
        await waitForResolvedSources(coordinator, 1);

        const article = document.querySelector("article");
        if (!article) {
            throw new Error("Expected resolved article");
        }
        const replacement = article.cloneNode(true) as Element;
        article.remove();
        coordinator.release(article);
        document.body.append(replacement);
        coordinator.inspect(replacement);
        await waitForResolvedSources(coordinator, 1);

        expect(appView.profileCalls).toHaveLength(2);
        expect(appView.postCalls).toHaveLength(2);
    });

    it("hydrates an outer and quote target from one outer PostView", async () => {
        document.body.innerHTML = quoteFixture;
        const quoteUri = "at://did:plc:quoted/app.bsky.feed.post/3quote";
        const appView = new FakeAppView(
            async (actors) => resolveProfiles(actors),
            async (uris) => ({
                status: BLUESKY_LOOKUP_STATUS.SUCCESS,
                records: uris.map((uri) => ({
                    uri,
                    indexedAt: INDEXED_AT,
                    quote: { uri: quoteUri, indexedAt: QUOTE_INDEXED_AT },
                })),
            }),
        );
        const coordinator = createBlueskyCoordinator({
            document,
            url: new URL("https://bsky.app/"),
            appView,
            getDiagnosticSink: () => undefined,
            onSourcesChanged: () => undefined,
        });
        coordinator.start();
        coordinator.inspect(document);
        await waitForResolvedSources(coordinator, 2);

        const targets = discoverBlueskyRelativeTargets(document);
        const outer = targets.find(({ role }) => role === BLUESKY_TARGET_ROLE.POST);
        const quote = targets.find(({ role }) => role === BLUESKY_TARGET_ROLE.QUOTE);
        expect(outer && coordinator.rule.extract(outer.source)?.rawDatetime).toBe(INDEXED_AT);
        expect(quote && coordinator.rule.extract(quote.source)?.rawDatetime)
            .toBe(QUOTE_INDEXED_AT);
        expect(appView.profileCalls).toHaveLength(1);
        expect(appView.postCalls).toHaveLength(1);
        expect(appView.postCalls[0]).not.toContain(quoteUri);
    });

    it("drains a new identity discovered while another profile batch is in flight", async () => {
        installTargets(1);
        const firstProfiles = createDeferred<ProfileResult>();
        let profileInvocation = 0;
        const appView = new FakeAppView(async (actors) => {
            profileInvocation += 1;
            return profileInvocation === 1
                ? firstProfiles.promise
                : resolveProfiles(actors);
        });
        const coordinator = createBlueskyCoordinator({
            document,
            url: new URL("https://bsky.app/"),
            appView,
            getDiagnosticSink: () => undefined,
            onSourcesChanged: () => undefined,
        });
        coordinator.start();
        coordinator.inspect(document);
        await vi.waitFor(() => {
            expect(appView.profileCalls).toHaveLength(1);
        });

        const second = document.createElement("article");
        second.innerHTML = `<a href="/profile/second.example/post/3second"
            aria-label="localized" data-tooltip="localized">
            <span aria-hidden="true">· </span>4h</a>`;
        document.body.append(second);
        coordinator.inspect(second);
        firstProfiles.resolve(resolveProfiles(appView.profileCalls[0] ?? []));

        await waitForResolvedSources(coordinator, 2);
        expect(appView.profileCalls).toHaveLength(2);
    });

    it("revalidates identity and target before publishing an in-flight result", async () => {
        installTargets(1);
        const postResult = createDeferred<PostResult>();
        const appView = new FakeAppView(
            async (actors) => resolveProfiles(actors),
            async () => postResult.promise,
        );
        const changed: Element[][] = [];
        const coordinator = createBlueskyCoordinator({
            document,
            url: new URL("https://bsky.app/"),
            appView,
            getDiagnosticSink: () => undefined,
            onSourcesChanged: (sources) => changed.push([...sources]),
        });
        coordinator.start();
        coordinator.inspect(document);
        await vi.waitFor(() => {
            expect(appView.postCalls).toHaveLength(1);
        });

        const descriptor = discoverBlueskyRelativeTargets(document)[0];
        if (!descriptor) {
            throw new Error("Expected pending descriptor");
        }
        const oldTarget = descriptor.target;
        const replacement = document.createTextNode("new relative value");
        oldTarget.replaceWith(replacement);
        coordinator.inspectSources([descriptor.source]);
        postResult.resolve(resolvePosts(appView.postCalls[0] ?? []));

        await waitForResolvedSources(coordinator, 1);
        const candidate = coordinator.rule.extract(descriptor.source);
        expect(candidate?.presentation).toMatchObject({ target: replacement });
        expect(oldTarget.isConnected).toBe(false);
        expect(new Set(changed.flat())).toEqual(new Set([descriptor.source]));
    });

    it("makes stopped and detached in-flight work inert", async () => {
        installTargets(1);
        const profiles = createDeferred<ProfileResult>();
        const appView = new FakeAppView(async () => profiles.promise);
        const changed: Element[][] = [];
        const coordinator = createBlueskyCoordinator({
            document,
            url: new URL("https://bsky.app/"),
            appView,
            getDiagnosticSink: () => undefined,
            onSourcesChanged: (sources) => changed.push([...sources]),
        });
        coordinator.start();
        coordinator.inspect(document);
        await vi.waitFor(() => {
            expect(appView.profileCalls).toHaveLength(1);
        });

        const article = document.querySelector("article");
        if (!article) {
            throw new Error("Expected pending article");
        }
        article.remove();
        coordinator.release(article);
        coordinator.stop();
        profiles.resolve(resolveProfiles(appView.profileCalls[0] ?? []));
        await Promise.resolve();
        await Promise.resolve();

        expect(appView.postCalls).toEqual([]);
        expect(changed).toEqual([]);
    });

    it("does not retry failed identities after irrelevant or presentation mutations", async () => {
        installTargets(1);
        const diagnostics: DiagnosticEventInput[] = [];
        const appView = new FakeAppView(async () => ({
            status: BLUESKY_LOOKUP_STATUS.FAILURE,
        }));
        const coordinator = createBlueskyCoordinator({
            document,
            url: new URL("https://bsky.app/"),
            appView,
            getDiagnosticSink: () => (event) => diagnostics.push(event),
            onSourcesChanged: () => undefined,
        });
        coordinator.start();
        coordinator.inspect(document);
        await vi.waitFor(() => {
            expect(appView.profileCalls).toHaveLength(1);
        });
        await vi.waitFor(() => {
            expect(diagnostics).toHaveLength(1);
        });

        const descriptor = discoverBlueskyRelativeTargets(document)[0];
        if (!descriptor) {
            throw new Error("Expected failed descriptor");
        }
        descriptor.target.data = "different presentation";
        coordinator.inspectSources([descriptor.source]);
        const irrelevant = document.createElement("div");
        document.body.append(irrelevant);
        coordinator.inspect(irrelevant);
        await Promise.resolve();
        await Promise.resolve();

        expect(appView.profileCalls).toHaveLength(1);
        expect(appView.postCalls).toEqual([]);
        expect(diagnostics).toEqual([{
            category: DIAGNOSTIC_CATEGORY.ERROR,
            reason: DIAGNOSTIC_REASON.PROCESSING_FAILED,
            count: 1,
        }]);

        descriptor.source.setAttribute(
            "href",
            "/profile/genuinely-new.example/post/3newidentity",
        );
        coordinator.inspectSources([descriptor.source]);
        await vi.waitFor(() => {
            expect(appView.profileCalls).toHaveLength(2);
        });
        await vi.waitFor(() => {
            expect(diagnostics).toHaveLength(2);
        });
        expect(appView.profileCalls[1]).toEqual(["genuinely-new.example"]);
    });

    it.each(["unresolved actor", "absent post"])(
        "leaves the label page-owned for a successful partial %s",
        async (mode) => {
            installTargets(1);
            const diagnostics: DiagnosticEventInput[] = [];
            const appView = new FakeAppView(
                async (actors) => mode === "unresolved actor"
                    ? { status: BLUESKY_LOOKUP_STATUS.SUCCESS, records: [] }
                    : resolveProfiles(actors),
                async () => ({ status: BLUESKY_LOOKUP_STATUS.SUCCESS, records: [] }),
            );
            const coordinator = createBlueskyCoordinator({
                document,
                url: new URL("https://bsky.app/"),
                appView,
                getDiagnosticSink: () => (event) => diagnostics.push(event),
                onSourcesChanged: () => undefined,
            });
            coordinator.start();
            coordinator.inspect(document);
            await vi.waitFor(() => {
                expect(diagnostics).toHaveLength(1);
            });

            const descriptor = discoverBlueskyRelativeTargets(document)[0];
            if (!descriptor) {
                throw new Error("Expected partial descriptor");
            }
            expect(coordinator.rule.extract(descriptor.source)).toBeNull();
            expect(descriptor.target.data).toBe("2h");
            expect(diagnostics).toEqual([{
                category: DIAGNOSTIC_CATEGORY.SKIP,
                reason: DIAGNOSTIC_REASON.CANDIDATE_SKIPPED,
                count: 1,
            }]);
            expect(appView.profileCalls).toHaveLength(1);
            expect(appView.postCalls).toHaveLength(mode === "absent post" ? 1 : 0);
        },
    );

    it("keeps diagnostics opt-in, sanitized, and unable to affect behavior", async () => {
        installTargets(1);
        const noSinkProvider = vi.fn(() => undefined);
        const changed: Element[][] = [];
        const failed = new FakeAppView(async () => ({
            status: BLUESKY_LOOKUP_STATUS.FAILURE,
        }));
        const withoutSink = createBlueskyCoordinator({
            document,
            url: new URL("https://bsky.app/private/path?secret=query"),
            appView: failed,
            getDiagnosticSink: noSinkProvider,
            onSourcesChanged: (sources) => changed.push([...sources]),
        });
        withoutSink.start();
        withoutSink.inspect(document);
        await vi.waitFor(() => {
            expect(failed.profileCalls).toHaveLength(1);
        });
        await vi.waitFor(() => {
            expect(noSinkProvider).toHaveBeenCalled();
        });
        expect(changed).toEqual([]);
        withoutSink.stop();

        const events: DiagnosticEventInput[] = [];
        const partial = new FakeAppView(async () => ({
            status: BLUESKY_LOOKUP_STATUS.SUCCESS,
            records: [],
        }));
        const withSink = createBlueskyCoordinator({
            document,
            url: new URL("https://bsky.app/private/path?secret=query"),
            appView: partial,
            getDiagnosticSink: () => (event) => events.push(event),
            onSourcesChanged: () => undefined,
        });
        withSink.start();
        withSink.inspect(document);
        await vi.waitFor(() => {
            expect(events).toHaveLength(1);
        });
        expect(Object.keys(events[0] ?? {}).sort()).toEqual(["category", "count", "reason"]);
        const serialized = JSON.stringify(events);
        for (const secret of [
            "actor-00.example",
            "did:plc:actor00example",
            "3record00",
            "at://",
            INDEXED_AT,
            "2h",
            "/private/path",
            "secret=query",
        ]) {
            expect(serialized).not.toContain(secret);
        }
        withSink.stop();

        const throwing = new FakeAppView(async () => ({
            status: BLUESKY_LOOKUP_STATUS.SUCCESS,
            records: [],
        }));
        const throwingSink = createBlueskyCoordinator({
            document,
            url: new URL("https://bsky.app/"),
            appView: throwing,
            getDiagnosticSink: () => () => {
                throw new Error("diagnostic sink unavailable");
            },
            onSourcesChanged: () => undefined,
        });
        throwingSink.start();
        throwingSink.inspect(document);
        await vi.waitFor(() => {
            expect(throwing.profileCalls).toHaveLength(1);
        });
        await Promise.resolve();
        const descriptor = discoverBlueskyRelativeTargets(document)[0];
        expect(descriptor?.target.data).toBe("2h");
        expect(descriptor && throwingSink.rule.extract(descriptor.source)).toBeNull();
    });
});
