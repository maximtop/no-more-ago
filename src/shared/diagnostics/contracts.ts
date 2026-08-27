/**
 * @file Canonical diagnostic field names, finite values, validation patterns, and limits.
 */

/**
 * Event categories accepted across the content, background, journal, and export boundaries.
 */
export const DIAGNOSTIC_CATEGORIES = [
    "lifecycle",
    "adapter",
    "mutation",
    "timing",
    "settings",
    "skip",
    "error",
] as const;

/**
 * Finite diagnostic event category.
 */
export type DiagnosticCategory = (typeof DIAGNOSTIC_CATEGORIES)[number];

/**
 * Page groups retained without recording complete paths.
 */
export const DIAGNOSTIC_PAGE_CATEGORIES = [
    "repository",
    "issue",
    "pull-request",
    "actions",
    "settings",
    "other",
] as const;

/**
 * Finite diagnostic page category.
 */
export type DiagnosticPageCategory = (typeof DIAGNOSTIC_PAGE_CATEGORIES)[number];

/**
 * Coarse browser families permitted in diagnostics.
 */
export const DIAGNOSTIC_BROWSER_FAMILIES = ["chromium", "firefox", "other"] as const;

/**
 * Coarse browser family that avoids recording a user agent.
 */
export type DiagnosticBrowserFamily = (typeof DIAGNOSTIC_BROWSER_FAMILIES)[number];

/**
 * Allow-listed explanations that diagnostic producers may persist.
 */
export const DIAGNOSTIC_REASONS = [
    "adapter-matched",
    "adapter-missing",
    "candidate-skipped",
    "invalid-timestamp",
    "already-owned",
    "unsupported",
    "processing-failed",
    "storage-failed",
    "settings-updated",
] as const;

/**
 * Optional event fields accepted from content-runtime messages.
 */
export const DIAGNOSTIC_EVENT_OPTIONAL_KEYS = [
    "count",
    "durationMs",
    "reason",
    "adapterVersion",
    "extensionVersion",
    "browserFamily",
    "stack",
] as const;

/**
 * Complete event fields accepted from content-runtime messages.
 */
export const DIAGNOSTIC_EVENT_INPUT_KEYS = [
    "category",
    ...DIAGNOSTIC_EVENT_OPTIONAL_KEYS,
] as const;

/**
 * Required fields added before a diagnostic event is persisted.
 */
export const DIAGNOSTIC_EVENT_REQUIRED_KEYS = [
    "category",
    "timestamp",
    "hostname",
    "pageCategory",
    "incognito",
] as const;

/**
 * Fields accepted in diagnostic environment metadata.
 */
export const DIAGNOSTIC_ENVIRONMENT_KEYS = ["browserFamily", "extensionVersion"] as const;

/**
 * Redacted stack-frame syntax accepted by the persistent journal.
 */
export const DIAGNOSTIC_STACK_FRAME_PATTERN = /^frame(?::\d+(?::\d+)?)?$/u;

/**
 * Largest event count retained in one diagnostic entry.
 */
export const DIAGNOSTIC_MAX_COUNT = 1_000_000;

/**
 * Largest event duration retained in one diagnostic entry.
 */
export const DIAGNOSTIC_MAX_DURATION_MS = 86_400_000;

/**
 * Largest number of redacted frames retained in one diagnostic entry.
 */
export const DIAGNOSTIC_MAX_STACK_FRAMES = 16;
