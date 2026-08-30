/**
 * @file Resolves trusted TikTok publication timestamps from embedded state and post IDs.
 */

import { isHtmlElement } from "./html-element";

/**
 * Exact ID of the supported TikTok hydration script.
 */
export const TIKTOK_HYDRATION_SCRIPT_ID = "__UNIVERSAL_DATA_FOR_REHYDRATION__" as const;

/**
 * Exact selector of the supported TikTok hydration script.
 */
export const TIKTOK_HYDRATION_SELECTOR =
    `script#${TIKTOK_HYDRATION_SCRIPT_ID}[type="application/json"]` as const;

const POST_ID_PATTERN = /^[1-9]\d{18}$/u;
const UNIX_SECONDS_PATTERN = /^[1-9]\d{9}$/u;
const MINIMUM_TIMESTAMP_MS = Date.parse("2016-01-01T00:00:00Z");
const FUTURE_TOLERANCE_MS = 86_400_000;
const MAXIMUM_HYDRATION_TEXT_LENGTH = 5_000_000;
const MAXIMUM_HYDRATION_NODE_COUNT = 100_000;

/**
 * Cached index tied to one exact hydration script snapshot.
 */
interface HydrationCacheEntry {
    /**
     * Exact parsed script element.
     */
    readonly script: HTMLScriptElement;

    /**
     * Script text used to detect page-authored replacement.
     */
    readonly text: string;

    /**
     * Raw createTime by post ID; null marks conflicting duplicate records.
     */
    readonly createTimeByPostId: ReadonlyMap<string, string | null>;
}

const hydrationCache = new WeakMap<Document, HydrationCacheEntry>();
const EMPTY_INDEX: ReadonlyMap<string, string | null> = new Map();

/**
 * Narrows page-derived JSON objects without accepting primitives.
 *
 * @param value - Parsed JSON value.
 * @returns - Whether the value is a non-array record.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Checks the one exact script whose JSON may supply TikTok publication evidence.
 *
 * @param element - Candidate page element.
 * @returns - Whether the element is the supported hydration script.
 */
export function isTikTokHydrationScript(element: Element): element is HTMLScriptElement {
    return isHtmlElement(element)
        && element.localName === "script"
        && element.id === TIKTOK_HYDRATION_SCRIPT_ID
        && element.getAttribute("type") === "application/json";
}

/**
 * Indexes scalar id/createTime pairs found in the confirmed hydration script.
 *
 * @param value - Parsed hydration JSON root.
 * @returns - Create-time values keyed by exact string post IDs.
 */
function indexHydration(value: unknown): ReadonlyMap<string, string | null> {
    const index = new Map<string, string | null>();
    const pending: unknown[] = [value];
    let scheduledNodes = 1;
    while (pending.length > 0) {
        const current = pending.pop();
        if (Array.isArray(current)) {
            for (const child of current as readonly unknown[]) {
                scheduledNodes += 1;
                if (scheduledNodes > MAXIMUM_HYDRATION_NODE_COUNT) {
                    return EMPTY_INDEX;
                }
                pending.push(child);
            }
            continue;
        }
        if (!isRecord(current)) {
            continue;
        }
        const id = current.id;
        const createTime = current.createTime;
        if (typeof id === "string" && typeof createTime === "string") {
            const existing = index.get(id);
            if (existing === undefined) {
                index.set(id, createTime);
            } else if (existing !== createTime) {
                index.set(id, null);
            }
        }
        for (const child of Object.values(current)) {
            scheduledNodes += 1;
            if (scheduledNodes > MAXIMUM_HYDRATION_NODE_COUNT) {
                return EMPTY_INDEX;
            }
            pending.push(child);
        }
    }
    return index;
}

/**
 * Reads or rebuilds the index for the one supported hydration script.
 *
 * @param document - TikTok document containing embedded state.
 * @returns - Cached or newly parsed create-time index.
 */
function readHydrationIndex(
    document: Document,
): ReadonlyMap<string, string | null> {
    const scripts = document.querySelectorAll<HTMLScriptElement>(TIKTOK_HYDRATION_SELECTOR);
    if (scripts.length !== 1) {
        return EMPTY_INDEX;
    }
    const script = scripts[0];
    if (!script) {
        return EMPTY_INDEX;
    }
    const text = script.textContent;
    const cached = hydrationCache.get(document);
    if (cached?.script === script && cached.text === text) {
        return cached.createTimeByPostId;
    }
    let createTimeByPostId = EMPTY_INDEX;
    try {
        if (text.length <= MAXIMUM_HYDRATION_TEXT_LENGTH) {
            const parsed = JSON.parse(text) as unknown;
            createTimeByPostId = indexHydration(parsed);
        }
    } catch {
        /* malformed page data remains empty until the exact script snapshot changes */
    }
    hydrationCache.set(document, { script, text, createTimeByPostId });
    return createTimeByPostId;
}

/**
 * Converts strict plausible Unix seconds to canonical UTC datetime text.
 *
 * @param value - Raw ten-digit Unix-seconds value.
 * @param nowMs - Current browser time used for the future bound.
 * @returns - ISO UTC datetime, or null outside the accepted domain.
 */
function canonicalizeUnixSeconds(value: string, nowMs: number): string | null {
    if (!UNIX_SECONDS_PATTERN.test(value)) {
        return null;
    }
    const milliseconds = Number(value) * 1_000;
    if (
        !Number.isSafeInteger(milliseconds)
        || milliseconds < MINIMUM_TIMESTAMP_MS
        || milliseconds > nowMs + FUTURE_TOLERANCE_MS
    ) {
        return null;
    }
    return new Date(milliseconds).toISOString();
}

/**
 * Decodes the high 32 bits of one strict TikTok post ID.
 *
 * @param postId - Strict decimal post ID.
 * @returns - Unix seconds encoded in the high bits, or null for invalid shape.
 */
function decodePostIdSeconds(postId: string): string | null {
    if (!POST_ID_PATTERN.test(postId)) {
        return null;
    }
    return (BigInt(postId) >> 32n).toString();
}

/**
 * Resolves one TikTok publication to a canonical trusted datetime.
 *
 * A matching plausible createTime wins. Missing, malformed, stale, conflicting,
 * or implausible hydration falls back to the current post ID.
 *
 * @param document - Current TikTok document.
 * @param postId - Current publication's strict decimal ID.
 * @param nowMs - Current browser time used for plausibility validation.
 * @returns - Canonical ISO UTC datetime, or null when neither source is valid.
 */
export function resolveTikTokPublicationDatetime(
    document: Document,
    postId: string,
    nowMs = Date.now(),
): string | null {
    if (!POST_ID_PATTERN.test(postId)) {
        return null;
    }
    const createTime = readHydrationIndex(document).get(postId);
    if (typeof createTime === "string") {
        const embedded = canonicalizeUnixSeconds(createTime, nowMs);
        if (embedded) {
            return embedded;
        }
    }
    const decoded = decodePostIdSeconds(postId);
    return decoded ? canonicalizeUnixSeconds(decoded, nowMs) : null;
}
