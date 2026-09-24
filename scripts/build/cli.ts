/**
 * @file Commander-based parsing for development and release build commands.
 */

import { Argument, Command } from 'commander';

import {
    BROWSERS,
    BROWSER,
    BUILD_EXIT_CODE,
    BUILD_MODE,
    isBrowser,
    type Browser,
    type BuildMode,
} from './contracts.ts';

/**
 * Validated build request passed from the command-line adapter to the build pipeline.
 */
export interface BuildRequest {
    /**
     * Validated development or release mode.
     */
    readonly mode: BuildMode;

    /**
     * Browser targets selected for this build.
     */
    readonly browsers: readonly Browser[];

    /**
     * Whether the selected development target remains active and watches for changes.
     */
    readonly watch: boolean;
}

/**
 * Creates the optional browser argument shared by both build commands.
 *
 * @returns - Commander argument restricted to supported browser targets.
 */
function browserArgument(): Argument {
    return new Argument('[browser]', 'browser artifact to build').choices(BROWSERS);
}

/**
 * Builds a typed request from a supported mode and optional browser choice.
 *
 * @param mode - Command-selected development or release mode.
 * @param browser - Optional browser selected by the command.
 * @param watch - Whether continuous development compilation was requested.
 *
 * @returns - Complete request consumed by the build pipeline.
 *
 * @throws If the browser is not a supported build target.
 */
export function createBuildRequest(
    mode: BuildMode,
    browser: string | undefined,
    watch: boolean,
): BuildRequest {
    if (browser !== undefined && !isBrowser(browser)) {
        throw new Error(`Unknown browser: ${browser}`);
    }
    const defaultBrowsers = mode === BUILD_MODE.DEV ? [BROWSER.CHROME] : [...BROWSERS];
    return {
        mode,
        browsers: browser === undefined ? defaultBrowsers : [browser],
        watch,
    };
}

/**
 * Parses the current process arguments into one validated build request.
 *
 * @returns - Validated request selected by the build command.
 */
export function parseBuildCli(): BuildRequest {
    let request: BuildRequest | undefined;
    const program = new Command()
        .name('pnpm')
        .description('Build No More Ago browser extension artifacts.')
        .showSuggestionAfterError()
        .showHelpAfterError()
        .exitOverride((error) => {
            process.exit(error.exitCode === BUILD_EXIT_CODE.SUCCESS
                ? BUILD_EXIT_CODE.SUCCESS
                : BUILD_EXIT_CODE.USAGE);
        });

    program
        .command(BUILD_MODE.DEV)
        .description('build development artifacts')
        .addArgument(browserArgument())
        .option('--watch', 'watch one browser target for changes')
        .action((browser: string | undefined, options: { readonly watch?: boolean }) => {
            const watch = options.watch === true;
            request = createBuildRequest(BUILD_MODE.DEV, browser, watch);
        });

    program
        .command(BUILD_MODE.RELEASE)
        .description('build release artifacts')
        .addArgument(browserArgument())
        .action((browser: string | undefined) => {
            request = createBuildRequest(BUILD_MODE.RELEASE, browser, false);
        });

    program.parse();
    return request ?? program.help({ error: true });
}
