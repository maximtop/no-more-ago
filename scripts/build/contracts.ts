/**
 * @file Canonical browser targets and modes accepted by the extension build pipeline.
 */

/**
 * Named browser artifact targets used by build producers and consumers.
 */
export const BROWSER = {
    CHROME: "chrome",
    FIREFOX: "firefox",
    EDGE: "edge",
} as const;

/**
 * Browser artifacts emitted by development and release builds.
 */
export const BROWSERS = [BROWSER.CHROME, BROWSER.FIREFOX, BROWSER.EDGE] as const;

/**
 * Browser artifact target accepted by the build pipeline.
 */
export type Browser = (typeof BROWSERS)[number];

/**
 * Named build modes used by CLI commands and the artifact pipeline.
 */
export const BUILD_MODE = {
    DEV: "dev",
    RELEASE: "release",
} as const;

/**
 * Supported build modes.
 */
export const BUILD_MODES = [BUILD_MODE.DEV, BUILD_MODE.RELEASE] as const;

/**
 * Process exit codes exposed by the extension build command.
 */
export const BUILD_EXIT_CODE = {
    SUCCESS: 0,
    FAILURE: 1,
    USAGE: 2,
} as const;

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
