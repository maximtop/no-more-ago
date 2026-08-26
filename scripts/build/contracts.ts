/**
 * @file Canonical browser targets and modes accepted by the extension build pipeline.
 */

/**
 * Browser artifacts emitted by development and release builds.
 */
export const BROWSERS = ["chrome", "firefox", "edge"] as const;

/**
 * Browser artifact target accepted by the build pipeline.
 */
export type Browser = (typeof BROWSERS)[number];

/**
 * Supported build modes.
 */
export const BUILD_MODES = ["dev", "release"] as const;

/**
 * Build mode accepted by the pipeline.
 */
export type BuildMode = (typeof BUILD_MODES)[number];

const BROWSER_SET = new Set<string>(BROWSERS);
const BUILD_MODE_SET = new Set<string>(BUILD_MODES);

/**
 * Recognizes one supported browser artifact target.
 *
 * @param value - Untrusted browser target.
 * @returns - Whether the value is a supported browser target.
 */
export function isBrowser(value: string): value is Browser {
    return BROWSER_SET.has(value);
}

/**
 * Recognizes one supported build mode.
 *
 * @param value - Untrusted build mode.
 * @returns - Whether the value is a supported build mode.
 */
export function isBuildMode(value: string): value is BuildMode {
    return BUILD_MODE_SET.has(value);
}
