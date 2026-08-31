/**
 * @file Verifies the anonymous, bounded, fail-closed Bluesky AppView boundary.
 */

import { describe, expect, it, vi } from "vitest";
/* eslint-disable @typescript-eslint/require-await */

import {
    BLUESKY_BATCH_LIMIT,
    BLUESKY_LOOKUP_STATUS,
    BLUESKY_POST_METHOD,
    BLUESKY_PROFILE_METHOD,
    BLUESKY_PUBLIC_APPVIEW_ORIGIN,
    createBlueskyAppView,
} from "../../../../src/content-script/adapters/bluesky-appview";
import {
    createBlueskyPostUri,
} from "../../../../src/content-script/adapters/bluesky-identity";

const VALID_INDEXED_AT = "2026-08-31T10:15:00.000Z" as const;
const SECOND_INDEXED_AT = "2026-08-30T09:00:00.000Z" as const;

/**
 * Optional transport shape exposed by a fake response.
 */
interface FakeResponseOptions {
    /**
     * Whether the response represents a successful HTTP status.
     */
    readonly ok?: boolean;

    /**
     * Whether fetch reports that a redirect was followed.
     */
    readonly redirected?: boolean;

    /**
     * Whether reading the JSON body rejects.
     */
    readonly jsonFailure?: boolean;

    /**
     * Observable HTTP status supplied for failure-matrix clarity.
     */
    readonly status?: number;
}

/**
 * Creates the observable subset of a fetch response used by the AppView client.
 *
 * @param body - Value returned from the JSON reader.
 * @param options - Optional transport failure shape.
 * @returns - Response-shaped test value.
 */
function fakeResponse(body: unknown, options: FakeResponseOptions = {}): Response {
    return {
        ok: options.ok ?? true,
        redirected: options.redirected ?? false,
        status: options.status ?? (options.ok === false ? 500 : 200),
        json: options.jsonFailure
            ? async () => Promise.reject(new SyntaxError("not JSON"))
            : async () => body,
    } as unknown as Response;
}

/**
 * Creates a fetch double with ordered responses and inspectable calls.
 *
 * @param responses - Responses or errors returned in call order.
 * @returns - Fetch implementation and captured call tuples.
 */
function createFetchDouble(responses: readonly (Response | Error)[]): {
    readonly fetch: typeof fetch;
    readonly calls: Array<Parameters<typeof fetch>>;
} {
    const calls: Array<Parameters<typeof fetch>> = [];
    const implementation = async (...parameters: Parameters<typeof fetch>): Promise<Response> => {
        calls.push(parameters);
        const response = responses[calls.length - 1];
        if (!response) {
            throw new Error("Unexpected fetch call");
        }
        if (response instanceof Error) {
            throw response;
        }
        return response;
    };
    return { fetch: implementation, calls };
}

/**
 * Returns one canonical AT post URI for a fictional DID and record key.
 *
 * @param suffix - Fictional identity suffix.
 * @returns - Canonical AT post URI.
 */
function postUri(suffix: string): string {
    return createBlueskyPostUri(`did:plc:${suffix}`, `3${suffix}`);
}

describe("Bluesky AppView request contract", () => {
    it("uses only fixed, anonymous GET requests and preserves value order", async () => {
        const responses = Array.from(
            { length: 4 },
            (_, index) => fakeResponse(index < 2 ? { profiles: [] } : { posts: [] }),
        );
        const fake = createFetchDouble(responses);
        const appView = createBlueskyAppView(fake.fetch);
        const signal = new AbortController().signal;
        const actors = Array.from({ length: BLUESKY_BATCH_LIMIT }, (_, index) => {
            return `actor-${String(index).padStart(2, "0")}.example`;
        });
        const uris = Array.from({ length: BLUESKY_BATCH_LIMIT }, (_, index) => {
            return postUri(String(index).padStart(2, "0"));
        });

        await appView.getProfiles(["alice.example"], signal);
        await appView.getProfiles(actors, signal);
        await appView.getPosts([postUri("one")], signal);
        await appView.getPosts(uris, signal);

        expect(fake.calls).toHaveLength(4);
        const expectedQueries = [
            [BLUESKY_PROFILE_METHOD, "actors", ["alice.example"]],
            [BLUESKY_PROFILE_METHOD, "actors", actors],
            [BLUESKY_POST_METHOD, "uris", [postUri("one")]],
            [BLUESKY_POST_METHOD, "uris", uris],
        ] as const;
        for (const [index, [method, queryName, values]] of expectedQueries.entries()) {
            const call = fake.calls[index];
            if (!call) {
                throw new Error("Expected fetch call");
            }
            const requestTarget = call[0];
            if (!(requestTarget instanceof URL)) {
                throw new Error("Expected URL fetch target");
            }
            const url = requestTarget;
            expect(url.origin).toBe(BLUESKY_PUBLIC_APPVIEW_ORIGIN);
            expect(url.pathname).toBe(`/xrpc/${method}`);
            expect([...url.searchParams.keys()]).toEqual(values.map(() => queryName));
            expect(url.searchParams.getAll(queryName)).toEqual(values);
            expect(call[1]).toMatchObject({
                method: "GET",
                cache: "no-store",
                credentials: "omit",
                redirect: "error",
                referrerPolicy: "no-referrer",
            });
            expect(call[1]?.signal).toBeInstanceOf(AbortSignal);
        }
    });

    it("rejects empty and oversized direct batches before fetch", async () => {
        const fake = createFetchDouble([]);
        const appView = createBlueskyAppView(fake.fetch);
        const signal = new AbortController().signal;
        const oversized = Array.from({ length: BLUESKY_BATCH_LIMIT + 1 }, (_, index) => {
            return `actor-${String(index)}.example`;
        });

        await expect(appView.getProfiles([], signal)).resolves.toEqual({
            status: BLUESKY_LOOKUP_STATUS.FAILURE,
        });
        await expect(appView.getProfiles(oversized, signal)).resolves.toEqual({
            status: BLUESKY_LOOKUP_STATUS.FAILURE,
        });
        await expect(appView.getPosts([], signal)).resolves.toEqual({
            status: BLUESKY_LOOKUP_STATUS.FAILURE,
        });
        await expect(appView.getPosts(oversized, signal)).resolves.toEqual({
            status: BLUESKY_LOOKUP_STATUS.FAILURE,
        });
        expect(fake.calls).toEqual([]);
    });

    it.each(["transport", "body"])(
        "fails a request whose %s never settles",
        async (mode) => {
            vi.useFakeTimers();
            let observedSignal: AbortSignal | null | undefined;
            const fetchImplementation = (async (
                _input: URL | RequestInfo,
                init?: RequestInit,
            ): Promise<Response> => {
                observedSignal = init?.signal;
                if (mode === "transport") {
                    return new Promise<Response>(() => undefined);
                }
                return {
                    ok: true,
                    redirected: false,
                    json: () => new Promise<unknown>(() => undefined),
                } as Response;
            }) as typeof fetch;
            try {
                const result = createBlueskyAppView(fetchImplementation).getPosts(
                    [postUri("stalled")],
                    new AbortController().signal,
                );

                await vi.runAllTimersAsync();

                await expect(result).resolves.toEqual({
                    status: BLUESKY_LOOKUP_STATUS.FAILURE,
                });
                expect(observedSignal?.aborted).toBe(true);
            } finally {
                vi.useRealTimers();
            }
        },
    );
});

describe("Bluesky AppView response contract", () => {
    it("matches reordered partial profiles and omits foreign or ambiguous records", async () => {
        const oversizedDid = `did:plc:${"a".repeat(2_048)}`;
        const fake = createFetchDouble([fakeResponse({
            profiles: [
                { did: "did:plc:bob", handle: "bob.example", displayName: "ignored" },
                { did: "did:plc:foreign", handle: "foreign.example" },
                { did: "did:plc:alice", handle: "ALICE.EXAMPLE" },
                { did: "did:plc:duplicate-one", handle: "duplicate.example" },
                { did: "did:plc:duplicate-two", handle: "duplicate.example" },
                { did: oversizedDid, handle: "oversized.example" },
                { did: 42, handle: "invalid.example" },
            ],
        })]);
        const result = await createBlueskyAppView(fake.fetch).getProfiles([
            "alice.example",
            "did:plc:bob",
            "missing.example",
            "duplicate.example",
            "oversized.example",
            "invalid.example",
        ], new AbortController().signal);

        expect(result).toEqual({
            status: BLUESKY_LOOKUP_STATUS.SUCCESS,
            records: [
                { actor: "alice.example", did: "did:plc:alice" },
                { actor: "did:plc:bob", did: "did:plc:bob" },
            ],
        });
    });

    it("matches posts by exact URI and accepts only the two supported quote views", async () => {
        const plainUri = postUri("plain");
        const mediaUri = postUri("media");
        const blockedUri = postUri("blocked");
        const plainQuoteUri = postUri("plainquote");
        const mediaQuoteUri = postUri("mediaquote");
        const fake = createFetchDouble([fakeResponse({
            posts: [
                {
                    uri: mediaUri,
                    indexedAt: SECOND_INDEXED_AT,
                    embed: {
                        $type: "app.bsky.embed.recordWithMedia#view",
                        record: {
                            record: { uri: mediaQuoteUri, indexedAt: VALID_INDEXED_AT },
                        },
                    },
                    record: { createdAt: "1999-01-01T00:00:00.000Z" },
                },
                { uri: postUri("foreign"), indexedAt: VALID_INDEXED_AT },
                {
                    uri: plainUri,
                    indexedAt: VALID_INDEXED_AT,
                    embed: {
                        $type: "app.bsky.embed.record#view",
                        record: { uri: plainQuoteUri, indexedAt: SECOND_INDEXED_AT },
                    },
                },
                {
                    uri: blockedUri,
                    indexedAt: VALID_INDEXED_AT,
                    embed: {
                        $type: "app.bsky.embed.record#view",
                        record: { $type: "app.bsky.embed.record#viewBlocked" },
                    },
                },
            ],
        })]);
        const result = await createBlueskyAppView(fake.fetch).getPosts(
            [plainUri, mediaUri, blockedUri, postUri("missing")],
            new AbortController().signal,
        );

        expect(result).toEqual({
            status: BLUESKY_LOOKUP_STATUS.SUCCESS,
            records: [
                {
                    uri: plainUri,
                    indexedAt: VALID_INDEXED_AT,
                    quote: { uri: plainQuoteUri, indexedAt: SECOND_INDEXED_AT },
                },
                {
                    uri: mediaUri,
                    indexedAt: SECOND_INDEXED_AT,
                    quote: { uri: mediaQuoteUri, indexedAt: VALID_INDEXED_AT },
                },
                { uri: blockedUri, indexedAt: VALID_INDEXED_AT },
            ],
        });
    });

    it("omits duplicate, malformed, mismatched, and invalid timestamp records", async () => {
        const duplicateUri = postUri("duplicate");
        const invalidUri = postUri("invalid");
        const validUri = postUri("valid");
        const fake = createFetchDouble([fakeResponse({
            posts: [
                { uri: duplicateUri, indexedAt: VALID_INDEXED_AT },
                { uri: duplicateUri, indexedAt: SECOND_INDEXED_AT },
                { uri: invalidUri, indexedAt: "2026-08-31T10:15:00" },
                { uri: 12, indexedAt: VALID_INDEXED_AT },
                {
                    uri: validUri,
                    indexedAt: VALID_INDEXED_AT,
                    embed: {
                        $type: "app.bsky.embed.record#view",
                        record: { uri: postUri("quote"), indexedAt: "not-a-time" },
                    },
                },
            ],
        })]);
        const result = await createBlueskyAppView(fake.fetch).getPosts(
            [duplicateUri, invalidUri, validUri],
            new AbortController().signal,
        );

        expect(result).toEqual({
            status: BLUESKY_LOOKUP_STATUS.SUCCESS,
            records: [{ uri: validUri, indexedAt: VALID_INDEXED_AT }],
        });
    });

    it.each([
        ["missing envelope field", fakeResponse({})],
        ["malformed envelope field", fakeResponse({ posts: "wrong" })],
        ["429 status", fakeResponse({ posts: [] }, { ok: false, status: 429 })],
        ["500 status", fakeResponse({ posts: [] }, { ok: false, status: 500 })],
        ["redirect", fakeResponse({ posts: [] }, { redirected: true })],
        ["non-JSON body", fakeResponse(null, { jsonFailure: true })],
        ["transport failure", new TypeError("offline")],
        ["abort", new DOMException("aborted", "AbortError")],
    ])("returns failure for %s", async (_description, response) => {
        const fake = createFetchDouble([response]);
        const result = await createBlueskyAppView(fake.fetch).getPosts(
            [postUri("one")],
            new AbortController().signal,
        );
        expect(result).toEqual({ status: BLUESKY_LOOKUP_STATUS.FAILURE });
    });
});
