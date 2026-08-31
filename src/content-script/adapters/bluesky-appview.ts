/**
 * @file Anonymous, fixed-origin boundary for public Bluesky AppView lookups.
 */

import * as v from "valibot";

import {
    parseExplicitZoneDatetime,
} from "../transformation/resolve-trusted-timestamp";

const DID_PATTERN = /^did:[a-z0-9]+:[A-Za-z0-9._:%-]+$/u;
const HANDLE_LABEL_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/u;
const AT_POST_URI_PATTERN =
    /^at:\/\/did:[a-z0-9]+:[A-Za-z0-9._:%-]+\/app\.bsky\.feed\.post\/[A-Za-z0-9._~:-]+$/u;
const requiredStringSchema = v.pipe(v.string(), v.nonEmpty());
const profileEnvelopeSchema = v.object({ profiles: v.array(v.unknown()) });
const profileSchema = v.object({
    did: requiredStringSchema,
    handle: requiredStringSchema,
});
const postEnvelopeSchema = v.object({ posts: v.array(v.unknown()) });
const postSchema = v.object({
    uri: requiredStringSchema,
    indexedAt: requiredStringSchema,
    embed: v.optional(v.unknown()),
});
const quoteRecordSchema = v.object({
    uri: requiredStringSchema,
    indexedAt: requiredStringSchema,
});
const plainQuoteSchema = v.object({
    $type: v.literal("app.bsky.embed.record#view"),
    record: quoteRecordSchema,
});
const mediaQuoteSchema = v.object({
    $type: v.literal("app.bsky.embed.recordWithMedia#view"),
    record: v.object({ record: quoteRecordSchema }),
});

/**
 * Fixed public origin used for every anonymous Bluesky lookup.
 */
export const BLUESKY_PUBLIC_APPVIEW_ORIGIN = "https://public.api.bsky.app" as const;

/**
 * XRPC method used to resolve public actors to DIDs.
 */
export const BLUESKY_PROFILE_METHOD = "app.bsky.actor.getProfiles" as const;

/**
 * XRPC method used to resolve public post views.
 */
export const BLUESKY_POST_METHOD = "app.bsky.feed.getPosts" as const;

/**
 * Maximum number of repeated values accepted by either public batch method.
 */
export const BLUESKY_BATCH_LIMIT = 25 as const;

/**
 * Outcomes exposed by the fail-closed AppView boundary.
 */
export const BLUESKY_LOOKUP_STATUS = {
    SUCCESS: "success",
    FAILURE: "failure",
} as const;

/**
 * Unambiguous actor-to-DID mapping returned for one requested actor.
 */
export interface BlueskyProfileRecord {
    /**
     * Requested public actor value.
     */
    readonly actor: string;

    /**
     * Matching public DID returned by AppView.
     */
    readonly did: string;
}

/**
 * Validated timestamp record for one public post view.
 */
export interface BlueskyQuoteRecord {
    /**
     * Exact AT post URI supplied by AppView.
     */
    readonly uri: string;

    /**
     * Validated server-observed timestamp supplied by AppView.
     */
    readonly indexedAt: string;
}

/**
 * Validated outer post record with optional one-level quote enrichment.
 */
export interface BlueskyPostRecord extends BlueskyQuoteRecord {
    /**
     * Supported quoted view already hydrated with the outer post.
     */
    readonly quote?: BlueskyQuoteRecord;
}

/**
 * Typed success or expected failure returned by a public lookup.
 */
export type BlueskyLookupResult<T> =
    | {
        /**
         * Successful response discriminant.
         */
        readonly status: typeof BLUESKY_LOOKUP_STATUS.SUCCESS;

        /**
         * Valid, unambiguous records found in requested-value order.
         */
        readonly records: readonly T[];
    }
    | {
        /**
         * Expected transport or response failure discriminant.
         */
        readonly status: typeof BLUESKY_LOOKUP_STATUS.FAILURE;
    };

/**
 * Narrow capability used by document-local Bluesky coordination.
 */
export interface BlueskyAppView {
    /**
     * Resolves public handles or DIDs to canonical DIDs.
     *
     * @param actors - One bounded batch of public actors.
     * @param signal - Document-lifecycle cancellation signal.
     * @returns - Valid mappings or a typed request failure.
     */
    getProfiles(
        actors: readonly string[],
        signal: AbortSignal,
    ): Promise<BlueskyLookupResult<BlueskyProfileRecord>>;

    /**
     * Resolves exact public AT post URIs to server-observed timestamps.
     *
     * @param uris - One bounded batch of AT post URIs.
     * @param signal - Document-lifecycle cancellation signal.
     * @returns - Valid post records or a typed request failure.
     */
    getPosts(
        uris: readonly string[],
        signal: AbortSignal,
    ): Promise<BlueskyLookupResult<BlueskyPostRecord>>;
}

/**
 * Returns the shared failure result without exposing transport details.
 *
 * @returns - Typed AppView failure.
 */
function lookupFailure(): { readonly status: typeof BLUESKY_LOOKUP_STATUS.FAILURE } {
    return { status: BLUESKY_LOOKUP_STATUS.FAILURE };
}

/**
 * Checks the direct-call batch boundary before performing fetch.
 *
 * @param values - Repeated query values supplied by the coordinator.
 * @returns - Whether the batch is non-empty, bounded, and contains no empty value.
 */
function isValidBatch(values: readonly string[]): boolean {
    return values.length > 0
        && values.length <= BLUESKY_BATCH_LIMIT
        && values.every((value) => value.length > 0);
}

/**
 * Performs one fixed-origin anonymous public AppView request.
 *
 * @param fetchImplementation - Fetch capability owned by the content runtime.
 * @param method - Fixed XRPC method.
 * @param queryName - Fixed repeated query parameter name.
 * @param values - Bounded public identity values.
 * @param signal - Document-lifecycle cancellation signal.
 * @returns - Parsed JSON body, or null for every expected request failure.
 */
async function requestJson(
    fetchImplementation: typeof fetch,
    method: typeof BLUESKY_PROFILE_METHOD | typeof BLUESKY_POST_METHOD,
    queryName: "actors" | "uris",
    values: readonly string[],
    signal: AbortSignal,
): Promise<unknown> {
    if (!isValidBatch(values)) {
        return null;
    }
    const url = new URL(`/xrpc/${method}`, BLUESKY_PUBLIC_APPVIEW_ORIGIN);
    for (const value of values) {
        url.searchParams.append(queryName, value);
    }
    try {
        const response = await fetchImplementation(url, {
            method: "GET",
            credentials: "omit",
            redirect: "error",
            referrerPolicy: "no-referrer",
            signal,
        });
        if (!response.ok || response.redirected) {
            return null;
        }
        return await response.json() as unknown;
    } catch {
        return null;
    }
}

/**
 * Normalizes a valid DNS-style handle returned by AppView.
 *
 * @param value - Untrusted handle value.
 * @returns - Lowercase handle, or null when invalid.
 */
function normalizeHandle(value: string): string | null {
    if (value.length > 253 || !value.includes(".")) {
        return null;
    }
    const labels = value.split(".");
    if (labels.some(
        (label) => label.length === 0
            || label.length > 63
            || !HANDLE_LABEL_PATTERN.test(label),
    )) {
        return null;
    }
    return value.toLowerCase();
}

/**
 * Parses and matches unambiguous profile mappings in request order.
 *
 * @param body - Untrusted AppView JSON body.
 * @param actors - Requested public actor values.
 * @returns - Successful records, or null when the top-level body is malformed.
 */
function parseProfiles(
    body: unknown,
    actors: readonly string[],
): readonly BlueskyProfileRecord[] | null {
    const envelope = v.safeParse(profileEnvelopeSchema, body);
    if (!envelope.success) {
        return null;
    }
    const profiles = envelope.output.profiles.flatMap((value) => {
        const parsed = v.safeParse(profileSchema, value);
        return parsed.success
            && DID_PATTERN.test(parsed.output.did)
            && normalizeHandle(parsed.output.handle) !== null
            ? [parsed.output]
            : [];
    });
    const records: BlueskyProfileRecord[] = [];
    for (const actor of actors) {
        const normalizedActor = actor.startsWith("did:") ? null : normalizeHandle(actor);
        const matches = profiles.filter((profile) => {
            return profile.did === actor
                || (
                    normalizedActor !== null
                    && normalizeHandle(profile.handle) === normalizedActor
                );
        });
        if (matches.length === 1) {
            const match = matches[0];
            if (match) {
                records.push({ actor, did: match.did });
            }
        }
    }
    return records;
}

/**
 * Parses one supported quote view without invalidating its outer post.
 *
 * @param value - Untrusted post embed value.
 * @returns - Valid quote timestamp record, or undefined when unsupported.
 */
function parseQuote(value: unknown): BlueskyQuoteRecord | undefined {
    const plain = v.safeParse(plainQuoteSchema, value);
    const media = plain.success ? null : v.safeParse(mediaQuoteSchema, value);
    const record = plain.success
        ? plain.output.record
        : media?.success
            ? media.output.record.record
            : null;
    if (
        !record
        || !AT_POST_URI_PATTERN.test(record.uri)
        || !parseExplicitZoneDatetime(record.indexedAt)
    ) {
        return undefined;
    }
    return { uri: record.uri, indexedAt: record.indexedAt };
}

/**
 * Parses and matches unambiguous post mappings in request order.
 *
 * @param body - Untrusted AppView JSON body.
 * @param uris - Requested exact AT post URIs.
 * @returns - Successful records, or null when the top-level body is malformed.
 */
function parsePosts(
    body: unknown,
    uris: readonly string[],
): readonly BlueskyPostRecord[] | null {
    const envelope = v.safeParse(postEnvelopeSchema, body);
    if (!envelope.success) {
        return null;
    }
    const posts = envelope.output.posts.flatMap((value) => {
        const parsed = v.safeParse(postSchema, value);
        return parsed.success ? [parsed.output] : [];
    });
    const records: BlueskyPostRecord[] = [];
    for (const uri of uris) {
        const matches = posts.filter((post) => post.uri === uri);
        const match = matches.length === 1 ? matches[0] : undefined;
        if (!match || !parseExplicitZoneDatetime(match.indexedAt)) {
            continue;
        }
        const quote = parseQuote(match.embed);
        records.push({
            uri: match.uri,
            indexedAt: match.indexedAt,
            ...(quote ? { quote } : {}),
        });
    }
    return records;
}

/**
 * Creates the sole production boundary for anonymous public Bluesky lookups.
 *
 * @param fetchImplementation - Fetch capability, injectable for offline tests.
 * @returns - Fixed-origin AppView lookup capability.
 */
export function createBlueskyAppView(
    fetchImplementation: typeof fetch = globalThis.fetch,
): BlueskyAppView {
    return {
        getProfiles: async (actors, signal) => {
            const body = await requestJson(
                fetchImplementation,
                BLUESKY_PROFILE_METHOD,
                "actors",
                actors,
                signal,
            );
            if (body === null) {
                return lookupFailure();
            }
            const records = parseProfiles(body, actors);
            return records
                ? { status: BLUESKY_LOOKUP_STATUS.SUCCESS, records }
                : lookupFailure();
        },
        getPosts: async (uris, signal) => {
            const body = await requestJson(
                fetchImplementation,
                BLUESKY_POST_METHOD,
                "uris",
                uris,
                signal,
            );
            if (body === null) {
                return lookupFailure();
            }
            const records = parsePosts(body, uris);
            return records
                ? { status: BLUESKY_LOOKUP_STATUS.SUCCESS, records }
                : lookupFailure();
        },
    };
}
