/**
 * @file Canonical diagnostic field names, finite values, validation patterns, and limits.
 */

/**
 * Named event categories accepted across diagnostic boundaries.
 */
export const DIAGNOSTIC_CATEGORY = {
    LIFECYCLE: "lifecycle",
    ADAPTER: "adapter",
    MUTATION: "mutation",
    TIMING: "timing",
    SETTINGS: "settings",
    SKIP: "skip",
    ERROR: "error",
} as const;

/**
 * Event categories accepted across the content, background, journal, and export boundaries.
 */
export const DIAGNOSTIC_CATEGORIES = [
    DIAGNOSTIC_CATEGORY.LIFECYCLE,
    DIAGNOSTIC_CATEGORY.ADAPTER,
    DIAGNOSTIC_CATEGORY.MUTATION,
    DIAGNOSTIC_CATEGORY.TIMING,
    DIAGNOSTIC_CATEGORY.SETTINGS,
    DIAGNOSTIC_CATEGORY.SKIP,
    DIAGNOSTIC_CATEGORY.ERROR,
] as const;

/**
 * Hostname used for background-only diagnostic events.
 */
export const DIAGNOSTIC_INTERNAL_HOSTNAME = "no-more-ago.invalid" as const;

/**
 * Finite diagnostic event category.
 */
export type DiagnosticCategory = (typeof DIAGNOSTIC_CATEGORIES)[number];

/**
 * Named page groups retained without recording complete paths.
 */
export const DIAGNOSTIC_PAGE_CATEGORY = {
    REPOSITORY: "repository",
    ISSUE: "issue",
    PULL_REQUEST: "pull-request",
    ACTIONS: "actions",
    SETTINGS: "settings",
    OTHER: "other",
} as const;

/**
 * Page groups retained without recording complete paths.
 */
export const DIAGNOSTIC_PAGE_CATEGORIES = [
    DIAGNOSTIC_PAGE_CATEGORY.REPOSITORY,
    DIAGNOSTIC_PAGE_CATEGORY.ISSUE,
    DIAGNOSTIC_PAGE_CATEGORY.PULL_REQUEST,
    DIAGNOSTIC_PAGE_CATEGORY.ACTIONS,
    DIAGNOSTIC_PAGE_CATEGORY.SETTINGS,
    DIAGNOSTIC_PAGE_CATEGORY.OTHER,
] as const;

/**
 * Finite diagnostic page category.
 */
export type DiagnosticPageCategory = (typeof DIAGNOSTIC_PAGE_CATEGORIES)[number];

/**
 * Named coarse browser families permitted in diagnostics.
 */
export const DIAGNOSTIC_BROWSER_FAMILY = {
    CHROMIUM: "chromium",
    FIREFOX: "firefox",
    OTHER: "other",
} as const;

/**
 * Coarse browser families permitted in diagnostics.
 */
export const DIAGNOSTIC_BROWSER_FAMILIES = [
    DIAGNOSTIC_BROWSER_FAMILY.CHROMIUM,
    DIAGNOSTIC_BROWSER_FAMILY.FIREFOX,
    DIAGNOSTIC_BROWSER_FAMILY.OTHER,
] as const;

/**
 * Coarse browser family that avoids recording a user agent.
 */
export type DiagnosticBrowserFamily = (typeof DIAGNOSTIC_BROWSER_FAMILIES)[number];

/**
 * Named allow-listed explanations that diagnostic producers may persist.
 */
export const DIAGNOSTIC_REASON = {
    ADAPTER_MATCHED: "adapter-matched",
    ADAPTER_MISSING: "adapter-missing",
    CANDIDATE_SKIPPED: "candidate-skipped",
    INVALID_TIMESTAMP: "invalid-timestamp",
    ALREADY_OWNED: "already-owned",
    UNSUPPORTED: "unsupported",
    PROCESSING_FAILED: "processing-failed",
    STORAGE_FAILED: "storage-failed",
    SETTINGS_UPDATED: "settings-updated",
} as const;

/**
 * Allow-listed explanations that diagnostic producers may persist.
 */
export const DIAGNOSTIC_REASONS = [
    DIAGNOSTIC_REASON.ADAPTER_MATCHED,
    DIAGNOSTIC_REASON.ADAPTER_MISSING,
    DIAGNOSTIC_REASON.CANDIDATE_SKIPPED,
    DIAGNOSTIC_REASON.INVALID_TIMESTAMP,
    DIAGNOSTIC_REASON.ALREADY_OWNED,
    DIAGNOSTIC_REASON.UNSUPPORTED,
    DIAGNOSTIC_REASON.PROCESSING_FAILED,
    DIAGNOSTIC_REASON.STORAGE_FAILED,
    DIAGNOSTIC_REASON.SETTINGS_UPDATED,
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
