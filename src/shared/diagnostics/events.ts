/**
 * @file Normalizes diagnostic events at the content/background boundary.
 */

import * as v from "valibot";
import { GITHUB_HOSTNAME } from "../adapters/github-contract";
import { SAFE_EXTENSION_VERSION_PATTERN } from "../extension-version";
import { isCanonicalHostname } from "../settings/snapshot";
import {
    DIAGNOSTIC_BROWSER_FAMILIES,
    DIAGNOSTIC_CATEGORIES,
    DIAGNOSTIC_MAX_COUNT,
    DIAGNOSTIC_MAX_DURATION_MS,
    DIAGNOSTIC_MAX_STACK_FRAMES,
    DIAGNOSTIC_PAGE_CATEGORIES,
    DIAGNOSTIC_REASONS,
    DIAGNOSTIC_STACK_FRAME_PATTERN,
    type DiagnosticPageCategory,
} from "./contracts";

export type {
    DiagnosticBrowserFamily,
    DiagnosticCategory,
    DiagnosticPageCategory,
} from "./contracts";

const contextSchema = v.strictObject({
    hostname: v.pipe(v.string(), v.check(isCanonicalHostname)),
    pageCategory: v.picklist(DIAGNOSTIC_PAGE_CATEGORIES),
    incognito: v.boolean(),
});

const eventInputSchema = v.strictObject({
    category: v.picklist(DIAGNOSTIC_CATEGORIES),
    count: v.exactOptional(v.unknown()),
    durationMs: v.exactOptional(v.unknown()),
    reason: v.exactOptional(v.unknown()),
    adapterVersion: v.exactOptional(v.unknown()),
    extensionVersion: v.exactOptional(v.unknown()),
    browserFamily: v.exactOptional(v.unknown()),
    stack: v.exactOptional(v.unknown()),
});

/**
 * Canonical persisted diagnostic event schema.
 */
export const diagnosticEventSchema = v.strictObject({
    category: v.picklist(DIAGNOSTIC_CATEGORIES),
    timestamp: v.pipe(v.number(), v.safeInteger(), v.minValue(0)),
    hostname: v.pipe(v.string(), v.check(isCanonicalHostname)),
    pageCategory: v.picklist(DIAGNOSTIC_PAGE_CATEGORIES),
    incognito: v.boolean(),
    count: v.exactOptional(v.pipe(v.number(), v.minValue(0), v.maxValue(DIAGNOSTIC_MAX_COUNT))),
    durationMs: v.exactOptional(
        v.pipe(v.number(), v.minValue(0), v.maxValue(DIAGNOSTIC_MAX_DURATION_MS)),
    ),
    reason: v.exactOptional(v.picklist(DIAGNOSTIC_REASONS)),
    adapterVersion: v.exactOptional(v.pipe(v.string(), v.regex(SAFE_EXTENSION_VERSION_PATTERN))),
    extensionVersion: v.exactOptional(
        v.pipe(v.string(), v.regex(SAFE_EXTENSION_VERSION_PATTERN)),
    ),
    browserFamily: v.exactOptional(v.picklist(DIAGNOSTIC_BROWSER_FAMILIES)),
    stack: v.exactOptional(
        v.pipe(
            v.array(v.pipe(v.string(), v.regex(DIAGNOSTIC_STACK_FRAME_PATTERN))),
            v.maxLength(DIAGNOSTIC_MAX_STACK_FRAMES),
        ),
    ),
});

/**
 * Trusted sender-derived diagnostic context.
 */
export type DiagnosticContext = v.InferOutput<typeof contextSchema>;

/**
 * Caller-supplied event fields accepted before normalization.
 */
export type DiagnosticEventInput = v.InferInput<typeof eventInputSchema>;

/**
 * Canonical persisted diagnostic event.
 */
export type DiagnosticEvent = v.InferOutput<typeof diagnosticEventSchema>;

/**
 * WebExtension sender fields used to derive diagnostic context.
 */
export interface DiagnosticSender {
    /**
     * Sender URL supplied by the extension runtime.
     */
    readonly url?: unknown;

    /**
     * Sender tab metadata supplied by the extension runtime.
     */
    readonly tab?: {
        /**
         * Private-window flag supplied by the browser.
         */
        readonly incognito?: unknown;
    };
}

const PAGE_PATHS: readonly [RegExp, DiagnosticPageCategory][] = [
    [/^\/[^/]+\/[^/]+\/issues\/\d+(?:\/|$)/u, "issue"],
    [/^\/[^/]+\/[^/]+\/pull\/\d+(?:\/|$)/u, "pull-request"],
    [/^\/[^/]+\/[^/]+\/actions(?:\/|$)/u, "actions"],
    [/^\/[^/]+\/[^/]+(?:\/|$)/u, "repository"],
    [/^\/settings(?:\/|$)/u, "settings"],
];

/**
 * Maps a page path to a finite category without retaining the path.
 *
 * @param pathname - Page URL pathname.
 * @returns - Finite diagnostic page category.
 */
export function pageCategoryFromPath(pathname: string): DiagnosticPageCategory {
    return PAGE_PATHS.find(([pattern]) => pattern.test(pathname))?.[1] ?? "other";
}

/**
 * Derives diagnostic context from WebExtension sender metadata.
 *
 * @param sender - Runtime message sender.
 * @returns - Sanitized context, or null for an unsupported sender URL.
 */
export function deriveDiagnosticContext(sender: DiagnosticSender): DiagnosticContext | null {
    if (typeof sender.url !== "string") {
        return null;
    }
    try {
        const url = new URL(sender.url);
        if (
            (url.protocol !== "http:" && url.protocol !== "https:")
            || !isCanonicalHostname(url.hostname)
        ) {
            return null;
        }
        return {
            hostname: url.hostname,
            pageCategory:
                url.hostname === GITHUB_HOSTNAME ? pageCategoryFromPath(url.pathname) : "other",
            incognito: sender.tab?.incognito === true,
        };
    } catch {
        return null;
    }
}

/**
 * Returns a bounded finite number when the optional diagnostic value is valid.
 *
 * @param value - Optional numeric value.
 * @param maximum - Largest accepted value.
 * @returns - Accepted number, or undefined.
 */
function boundedNumber(value: unknown, maximum: number): number | undefined {
    return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= maximum
        ? value
        : undefined;
}

/**
 * Returns a validated extension version when available.
 *
 * @param value - Optional version value.
 * @returns - Accepted version, or undefined.
 */
function safeVersion(value: unknown): string | undefined {
    return typeof value === "string" && SAFE_EXTENSION_VERSION_PATTERN.test(value)
        ? value
        : undefined;
}

/**
 * Redacts raw stack text to bounded source-coordinate markers.
 *
 * @param value - Raw stack value.
 * @returns - Redacted stack markers, or undefined.
 */
function scrubStack(value: unknown): string[] | undefined {
    if (typeof value !== "string") {
        return undefined;
    }
    const frames = value
        .split("\n")
        .slice(0, DIAGNOSTIC_MAX_STACK_FRAMES)
        .filter((line) => line.trim() !== "")
        .map((line) => {
            const match = /(?::(\d+))(?::(\d+))?\s*\)?$/u.exec(line.trim());
            return match?.[1]
                ? `frame:${match[1]}${match[2] ? `:${match[2]}` : ""}`
                : "frame";
        });
    return frames.length > 0 ? frames : undefined;
}

/**
 * Normalizes one diagnostic event before it reaches storage.
 *
 * @param input - Untrusted diagnostic fields.
 * @param context - Sender-derived diagnostic context.
 * @param now - Event timestamp.
 * @returns - Canonical diagnostic event, or null when required fields are invalid.
 */
export function sanitizeDiagnosticEvent(
    input: unknown,
    context: DiagnosticContext,
    now = Date.now(),
): DiagnosticEvent | null {
    const parsedInput = v.safeParse(eventInputSchema, input);
    const parsedContext = v.safeParse(contextSchema, context);
    if (!parsedInput.success || !parsedContext.success || !Number.isSafeInteger(now) || now < 0) {
        return null;
    }
    const value = parsedInput.output;
    const count = boundedNumber(value.count, DIAGNOSTIC_MAX_COUNT);
    const durationMs = boundedNumber(value.durationMs, DIAGNOSTIC_MAX_DURATION_MS);
    const reason = DIAGNOSTIC_REASONS.find((candidate) => candidate === value.reason);
    const browserFamily = DIAGNOSTIC_BROWSER_FAMILIES.find(
        (candidate) => candidate === value.browserFamily,
    );
    const adapterVersion = safeVersion(value.adapterVersion);
    const extensionVersion = safeVersion(value.extensionVersion);
    const stack = scrubStack(value.stack);
    const event: DiagnosticEvent = {
        category: value.category,
        timestamp: now,
        ...parsedContext.output,
        ...(count === undefined ? {} : { count }),
        ...(durationMs === undefined ? {} : { durationMs }),
        ...(reason === undefined ? {} : { reason }),
        ...(adapterVersion === undefined ? {} : { adapterVersion }),
        ...(extensionVersion === undefined ? {} : { extensionVersion }),
        ...(browserFamily === undefined ? {} : { browserFamily }),
        ...(stack === undefined ? {} : { stack }),
    };
    return event;
}

/**
 * Derives sender context and normalizes one diagnostic event.
 *
 * @param input - Untrusted diagnostic fields.
 * @param sender - Runtime message sender.
 * @param now - Event timestamp.
 * @returns - Canonical diagnostic event, or null.
 */
export function createDiagnosticEvent(
    input: unknown,
    sender: DiagnosticSender,
    now = Date.now(),
): DiagnosticEvent | null {
    const context = deriveDiagnosticContext(sender);
    return context ? sanitizeDiagnosticEvent(input, context, now) : null;
}
