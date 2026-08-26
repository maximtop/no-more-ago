/**
 * @file Sanitizes diagnostic events before they cross the content/background trust boundary.
 */

import { GITHUB_HOSTNAME } from "../adapters/github-contract";
import { SAFE_EXTENSION_VERSION_PATTERN } from "../core/extension-version";
import { isCanonicalHostname } from "../settings/snapshot";
import {
    DIAGNOSTIC_BROWSER_FAMILIES,
    DIAGNOSTIC_CATEGORIES,
    DIAGNOSTIC_EVENT_INPUT_KEYS,
    DIAGNOSTIC_MAX_COUNT,
    DIAGNOSTIC_MAX_DURATION_MS,
    DIAGNOSTIC_MAX_STACK_FRAMES,
    DIAGNOSTIC_PAGE_CATEGORIES,
    DIAGNOSTIC_REASONS,
    type DiagnosticBrowserFamily,
    type DiagnosticCategory,
    type DiagnosticPageCategory,
} from "./contracts";

export type {
    DiagnosticBrowserFamily,
    DiagnosticCategory,
    DiagnosticPageCategory,
} from "./contracts";

/**
 * Trusted WebExtension sender facts merged into every persisted diagnostic event.
 */
export interface DiagnosticContext {
    /**
     * Canonical page hostname; URLs, ports, and credentials are excluded.
     */
    readonly hostname: string;

    /**
     * Finite page classification that avoids retaining a full path.
     */
    readonly pageCategory: DiagnosticPageCategory;

    /**
     * Whether the event originated from a private browser context.
     */
    readonly incognito: boolean;
}

/**
 * Untrusted-shaped subset of a WebExtension sender inspected before context derivation.
 */
export interface DiagnosticSender {
    /**
     * Trusted sender URL used to derive diagnostic context.
     */
    readonly url?: unknown;

    /**
     * Trusted tab metadata supplied by the WebExtension sender.
     */
    readonly tab?: {
        /**
         * Whether the event originated from a private browser context.
         */
        readonly incognito?: unknown;
    };
}

/**
 * Optional caller-supplied fields that are sanitized before journal persistence.
 */
export interface DiagnosticEventInput {
    /**
     * Finite event category allowed into the diagnostics journal.
     */
    readonly category: DiagnosticCategory;

    /**
     * Bounded event count supplied by the reporting caller.
     */
    readonly count?: unknown;

    /**
     * Bounded duration measurement retained for timing events.
     */
    readonly durationMs?: unknown;

    /**
     * Allow-listed explanation for a skipped or failed operation.
     */
    readonly reason?: unknown;

    /**
     * Short adapter revision accepted only when it matches the diagnostic version policy.
     */
    readonly adapterVersion?: unknown;

    /**
     * Extension version captured when the event is created.
     */
    readonly extensionVersion?: unknown;

    /**
     * Coarse browser family reported without a user-agent string.
     */
    readonly browserFamily?: unknown;

    /**
     * Redacted stack-frame categories rather than raw stack text.
     */
    readonly stack?: unknown;
}

/**
 * Redacted, immutable event representation safe to store and export from the extension.
 */
export interface DiagnosticEvent {
    /**
     * Finite event category allowed into the diagnostics journal.
     */
    readonly category: DiagnosticCategory;

    /**
     * Event creation time in milliseconds since the Unix epoch.
     */
    readonly timestamp: number;

    /**
     * Canonical page hostname; URLs, ports, and credentials are excluded.
     */
    readonly hostname: string;

    /**
     * Finite page classification that avoids retaining a full path.
     */
    readonly pageCategory: DiagnosticPageCategory;

    /**
     * Whether the event originated from a private browser context.
     */
    readonly incognito: boolean;

    /**
     * Bounded event count supplied by the reporting caller.
     */
    readonly count?: number;

    /**
     * Bounded duration measurement retained for timing events.
     */
    readonly durationMs?: number;

    /**
     * Allow-listed explanation for a skipped or failed operation.
     */
    readonly reason?: string;

    /**
     * Validated adapter revision, when the reporting site supplied one.
     */
    readonly adapterVersion?: string;

    /**
     * Extension version captured when the event is created.
     */
    readonly extensionVersion?: string;

    /**
     * Coarse browser family reported without a user-agent string.
     */
    readonly browserFamily?: DiagnosticBrowserFamily;

    /**
     * Redacted stack-frame categories rather than raw stack text.
     */
    readonly stack?: readonly string[];
}

const PAGE_PATHS: readonly [RegExp, DiagnosticPageCategory][] = [
    [/^\/[^/]+\/[^/]+\/issues\/\d+(?:\/|$)/u, "issue"],
    [/^\/[^/]+\/[^/]+\/pull\/\d+(?:\/|$)/u, "pull-request"],
    [/^\/[^/]+\/[^/]+\/actions(?:\/|$)/u, "actions"],
    [/^\/[^/]+\/[^/]+(?:\/|$)/u, "repository"],
    [/^\/settings(?:\/|$)/u, "settings"],
];
const CATEGORY_SET = new Set<string>(DIAGNOSTIC_CATEGORIES);
const PAGE_CATEGORY_SET = new Set<string>(DIAGNOSTIC_PAGE_CATEGORIES);
const BROWSER_FAMILY_SET = new Set<string>(DIAGNOSTIC_BROWSER_FAMILIES);
const REASON_SET = new Set<string>(DIAGNOSTIC_REASONS);
const INPUT_KEY_SET = new Set<string>(DIAGNOSTIC_EVENT_INPUT_KEYS);

/**
 * Accepts a plain object before reading untrusted event fields.
 *
 * @param value - Untrusted event value to inspect.
 * @returns - Whether the value is a non-array object record.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Bounds an untrusted numeric field to a finite non-negative value.
 *
 * @param value - Untrusted numeric field.
 * @param maximum - Largest accepted finite value.
 * @returns - Bounded non-negative number, or undefined when invalid.
 */
function safeNumber(value: unknown, maximum: number): number | undefined {
    return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= maximum
        ? value
        : undefined;
}

/**
 * Accepts a short printable extension version for diagnostic output.
 *
 * @param value - Untrusted extension-version field.
 * @returns - Safe printable version, or undefined when invalid.
 */
function safeVersion(value: unknown): string | undefined {
    return typeof value === "string" && SAFE_EXTENSION_VERSION_PATTERN.test(value)
        ? value
        : undefined;
}

/**
 * Redacts and truncates stack text before it reaches persistent diagnostics.
 *
 * @param value - Untrusted error stack field.
 * @returns - Redacted bounded stack lines, or undefined when unavailable.
 */
function scrubStack(value: unknown): readonly string[] | undefined {
    if (typeof value !== "string") {
        return undefined;
    }
    const frames: string[] = [];
    for (const line of value.split("\n").slice(0, DIAGNOSTIC_MAX_STACK_FRAMES)) {
        // Keep only a stable frame marker and source coordinates; paths, URLs and
        // arbitrary exception messages are intentionally discarded.
        const match = /(?:at\s+)?(?:[^:\s()]+\s+)?(?::(\d+))(?::(\d+))?\s*\)?$/u.exec(line.trim());
        const lineNumber = match?.[1];
        if (lineNumber) {
            const column = match[2];
            frames.push(column ? `frame:${lineNumber}:${column}` : `frame:${lineNumber}`);
        } else if (line.trim()) {
            frames.push("frame");
        }
    }
    return frames.length > 0 ? frames : undefined;
}

/**
 * Maps a page path to a finite category without retaining the original path.
 *
 * @param pathname - Page URL pathname that is never persisted verbatim.
 * @returns - Finite diagnostic page category.
 */
export function pageCategoryFromPath(pathname: string): DiagnosticPageCategory {
    for (const [pattern, category] of PAGE_PATHS) {
        if (pattern.test(pathname)) {
            return category;
        }
    }
    return "other";
}

/**
 * Derive durable context from a trusted WebExtension sender, never page fields.
 *
 * @param sender - Trusted WebExtension message sender metadata.
 * @returns - Durable diagnostic context, or null for an invalid sender.
 */
export function deriveDiagnosticContext(sender: DiagnosticSender): DiagnosticContext | null {
    if (typeof sender.url !== "string") {
        return null;
    }
    let parsed: URL;
    try {
        parsed = new URL(sender.url);
    } catch {
        return null;
    }
    if (
        (parsed.protocol !== "https:" && parsed.protocol !== "http:") ||
        !isCanonicalHostname(parsed.hostname)
    ) {
        return null;
    }
    return {
        hostname: parsed.hostname,
        pageCategory:
            parsed.hostname === GITHUB_HOSTNAME ? pageCategoryFromPath(parsed.pathname) : "other",
        incognito: sender.tab?.incognito === true,
    };
}

/**
 * Validates and redacts event input before it enters the diagnostic journal.
 *
 * @param input - Untrusted diagnostic event payload.
 * @param context - Trusted sender-derived environment metadata.
 * @param now - Trusted event timestamp in milliseconds.
 * @returns - Sanitized bounded event, or null when validation fails.
 */
export function sanitizeDiagnosticEvent(
    input: unknown,
    context: DiagnosticContext,
    now = Date.now(),
): DiagnosticEvent | null {
    if (!isRecord(input) || !isRecord(context)) {
        return null;
    }
    if (
        Object.keys(context).length !== 3 ||
        !Object.hasOwn(context, "hostname") ||
        !Object.hasOwn(context, "pageCategory") ||
        !Object.hasOwn(context, "incognito") ||
        !isCanonicalHostname(context.hostname) ||
        !PAGE_CATEGORY_SET.has(context.pageCategory) ||
        typeof context.incognito !== "boolean"
    ) {
        return null;
    }
    if (
        Object.hasOwn(input, "timestamp") ||
        Object.hasOwn(input, "hostname") ||
        Object.hasOwn(input, "pageCategory") ||
        Object.hasOwn(input, "incognito")
    ) {
        return null;
    }
    if (Object.keys(input).some((key) => !INPUT_KEY_SET.has(key))) {
        return null;
    }
    // A hostile prototype must not be able to smuggle a value into the durable
    // event. Optional fields are either own properties or are rejected.
    if (
        DIAGNOSTIC_EVENT_INPUT_KEYS.some(
            (key) => key in input && !Object.hasOwn(input, key),
        )
    ) {
        return null;
    }
    if (
        !Object.hasOwn(input, "category") ||
        !CATEGORY_SET.has(String(input.category))
    ) {
        return null;
    }
    if (!Number.isSafeInteger(now) || now < 0) {
        return null;
    }
    const event: DiagnosticEvent = {
        category: input.category as DiagnosticCategory,
        timestamp: now,
        hostname: context.hostname,
        pageCategory: context.pageCategory,
        incognito: context.incognito,
    };
    const count = safeNumber(input.count, DIAGNOSTIC_MAX_COUNT);
    const durationMs = safeNumber(input.durationMs, DIAGNOSTIC_MAX_DURATION_MS);
    const reason =
        typeof input.reason === "string" && REASON_SET.has(input.reason)
            ? input.reason
            : undefined;
    const adapterVersion = safeVersion(input.adapterVersion);
    const extensionVersion = safeVersion(input.extensionVersion);
    const browserFamily =
        typeof input.browserFamily === "string" && BROWSER_FAMILY_SET.has(input.browserFamily)
            ? (input.browserFamily as DiagnosticBrowserFamily)
            : undefined;
    const stack = scrubStack(input.stack);
    if (count !== undefined) {
        (event as { count?: number }).count = count;
    }
    if (durationMs !== undefined) {
        (event as { durationMs?: number }).durationMs = durationMs;
    }
    if (reason !== undefined) {
        (event as { reason?: string }).reason = reason;
    }
    if (adapterVersion !== undefined) {
        (event as { adapterVersion?: string }).adapterVersion = adapterVersion;
    }
    if (extensionVersion !== undefined) {
        (event as { extensionVersion?: string }).extensionVersion = extensionVersion;
    }
    if (browserFamily !== undefined) {
        (event as { browserFamily?: DiagnosticBrowserFamily }).browserFamily = browserFamily;
    }
    if (stack !== undefined) {
        (event as { stack?: readonly string[] }).stack = stack;
    }
    return Object.freeze(event);
}

/**
 * Derives trusted sender context and returns a sanitized event, or null for an invalid sender or
 * payload.
 *
 * @param input - Untrusted diagnostic event payload.
 * @param sender - Trusted WebExtension message sender metadata.
 * @param now - Trusted event timestamp in milliseconds.
 * @returns - Sanitized bounded event, or null when sender or payload is invalid.
 */
export function createDiagnosticEvent(
    input: unknown,
    sender: DiagnosticSender,
    now = Date.now(),
): DiagnosticEvent | null {
    const context = deriveDiagnosticContext(sender);
    return context ? sanitizeDiagnosticEvent(input, context, now) : null;
}
