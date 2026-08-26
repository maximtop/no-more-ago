import { isCanonicalHostname } from "../settings/snapshot";

/** Coarse categories are deliberately finite: arbitrary page paths never enter the journal. */
export type DiagnosticCategory = "lifecycle" | "adapter" | "mutation" | "timing" | "settings" | "skip" | "error";
export type DiagnosticPageCategory = "repository" | "issue" | "pull-request" | "actions" | "settings" | "other";
export type DiagnosticBrowserFamily = "chromium" | "firefox" | "other";

export interface DiagnosticContext {
    readonly hostname: string;
    readonly pageCategory: DiagnosticPageCategory;
    readonly incognito: boolean;
}

export interface DiagnosticSender {
    readonly url?: unknown;
    readonly tab?: { readonly incognito?: unknown };
}

export interface DiagnosticEventInput {
    readonly category: DiagnosticCategory;
    readonly count?: unknown;
    readonly durationMs?: unknown;
    readonly reason?: unknown;
    readonly adapterVersion?: unknown;
    readonly extensionVersion?: unknown;
    readonly browserFamily?: unknown;
    readonly stack?: unknown;
}

export interface DiagnosticEvent {
    readonly category: DiagnosticCategory;
    readonly timestamp: number;
    readonly hostname: string;
    readonly pageCategory: DiagnosticPageCategory;
    readonly incognito: boolean;
    readonly count?: number;
    readonly durationMs?: number;
    readonly reason?: string;
    readonly adapterVersion?: string;
    readonly extensionVersion?: string;
    readonly browserFamily?: DiagnosticBrowserFamily;
    readonly stack?: readonly string[];
}

const PAGE_PATHS: readonly [RegExp, DiagnosticPageCategory][] = [
    [/^\/[^/]+\/[^/]+\/issues\/\d+(?:\/|$)/u, "issue"],
    [/^\/[^/]+\/[^/]+\/pull\/\d+(?:\/|$)/u, "pull-request"],
    [/^\/[^/]+\/[^/]+\/actions(?:\/|$)/u, "actions"],
    [/^\/[^/]+\/[^/]+(?:\/|$)/u, "repository"],
    [/^\/settings(?:\/|$)/u, "settings"]
];
const REASONS = new Set(["adapter-matched", "adapter-missing", "candidate-skipped", "invalid-timestamp", "already-owned", "unsupported", "processing-failed", "storage-failed", "settings-updated"]);
const VERSION = /^[0-9A-Za-z][0-9A-Za-z._+-]{0,31}$/u;
const MAX_STACK_FRAMES = 16;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeNumber(value: unknown, maximum: number): number | undefined {
    return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= maximum ? value : undefined;
}

function safeVersion(value: unknown): string | undefined {
    return typeof value === "string" && VERSION.test(value) ? value : undefined;
}

function scrubStack(value: unknown): readonly string[] | undefined {
    if (typeof value !== "string") return undefined;
    const frames: string[] = [];
    for (const line of value.split("\n").slice(0, MAX_STACK_FRAMES)) {
    // Keep only a stable frame marker and source coordinates; paths, URLs and
    // arbitrary exception messages are intentionally discarded.
        const match = /(?:at\s+)?(?:[^:\s()]+\s+)?(?::(\d+))(?::(\d+))?\s*\)?$/u.exec(line.trim());
        const lineNumber = match?.[1];
        if (lineNumber) {
            const column = match[2];
            frames.push(column ? `frame:${lineNumber}:${column}` : `frame:${lineNumber}`);
        } else if (line.trim()) frames.push("frame");
    }
    return frames.length > 0 ? frames : undefined;
}

export function pageCategoryFromPath(pathname: string): DiagnosticPageCategory {
    for (const [pattern, category] of PAGE_PATHS) if (pattern.test(pathname)) return category;
    return "other";
}

/** Derive durable context from a trusted WebExtension sender, never page fields. */
export function deriveDiagnosticContext(sender: DiagnosticSender): DiagnosticContext | null {
    if (typeof sender.url !== "string") return null;
    let parsed: URL;
    try { parsed = new URL(sender.url); } catch { return null; }
    if ((parsed.protocol !== "https:" && parsed.protocol !== "http:") || !isCanonicalHostname(parsed.hostname)) return null;
    return {
        hostname: parsed.hostname,
        pageCategory: parsed.hostname === "github.com" ? pageCategoryFromPath(parsed.pathname) : "other",
        incognito: sender.tab?.incognito === true
    };
}

export function sanitizeDiagnosticEvent(input: unknown, context: DiagnosticContext, now = Date.now()): DiagnosticEvent | null {
    if (!isRecord(input) || !isRecord(context)) return null;
    if (Object.keys(context).length !== 3
    || !Object.hasOwn(context, "hostname")
    || !Object.hasOwn(context, "pageCategory")
    || !Object.hasOwn(context, "incognito")
    || !isCanonicalHostname(context.hostname)
    || !["repository", "issue", "pull-request", "actions", "settings", "other"].includes(context.pageCategory)
    || typeof context.incognito !== "boolean") return null;
    if (Object.hasOwn(input, "timestamp") || Object.hasOwn(input, "hostname") || Object.hasOwn(input, "pageCategory") || Object.hasOwn(input, "incognito")) return null;
    const allowedKeys = ["category", "count", "durationMs", "reason", "adapterVersion", "extensionVersion", "browserFamily", "stack"];
    if (Object.keys(input).some((key) => !allowedKeys.includes(key))) return null;
    // A hostile prototype must not be able to smuggle a value into the durable
    // event. Optional fields are either own properties or are rejected.
    if (allowedKeys.some((key) => key in input && !Object.hasOwn(input, key))) return null;
    if (!Object.hasOwn(input, "category") || !["lifecycle", "adapter", "mutation", "timing", "settings", "skip", "error"].includes(String(input.category))) return null;
    if (!Number.isSafeInteger(now) || now < 0) return null;
    const event: DiagnosticEvent = {
        category: input.category as DiagnosticCategory,
        timestamp: now,
        hostname: context.hostname,
        pageCategory: context.pageCategory,
        incognito: context.incognito
    };
    const count = safeNumber(input.count, 1_000_000);
    const durationMs = safeNumber(input.durationMs, 86_400_000);
    const reason = typeof input.reason === "string" && REASONS.has(input.reason) ? input.reason : undefined;
    const adapterVersion = safeVersion(input.adapterVersion);
    const extensionVersion = safeVersion(input.extensionVersion);
    const browserFamily = input.browserFamily === "chromium" || input.browserFamily === "firefox" || input.browserFamily === "other" ? input.browserFamily : undefined;
    const stack = scrubStack(input.stack);
    if (count !== undefined) (event as { count?: number }).count = count;
    if (durationMs !== undefined) (event as { durationMs?: number }).durationMs = durationMs;
    if (reason !== undefined) (event as { reason?: string }).reason = reason;
    if (adapterVersion !== undefined) (event as { adapterVersion?: string }).adapterVersion = adapterVersion;
    if (extensionVersion !== undefined) (event as { extensionVersion?: string }).extensionVersion = extensionVersion;
    if (browserFamily !== undefined) (event as { browserFamily?: DiagnosticBrowserFamily }).browserFamily = browserFamily;
    if (stack !== undefined) (event as { stack?: readonly string[] }).stack = stack;
    return Object.freeze(event);
}

export function createDiagnosticEvent(input: unknown, sender: DiagnosticSender, now = Date.now()): DiagnosticEvent | null {
    const context = deriveDiagnosticContext(sender);
    return context ? sanitizeDiagnosticEvent(input, context, now) : null;
}
