/**
 * @file Commander-based parsing for development and release build commands.
 */

import { Argument, Command, CommanderError } from "commander";
import {
    BROWSERS,
    BUILD_MODE,
    isBrowser,
    type Browser,
    type BuildMode,
} from "./contracts.ts";

/**
 * Compact usage text appended to build command errors.
 */
export const USAGE = `Usage: pnpm ${BUILD_MODE.DEV}|${BUILD_MODE.RELEASE} `
    + `[${BROWSERS.join("|")}] [--watch]`;

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
 * Reports invalid command-line usage together with the supported invocation syntax.
 */
export class UsageError extends Error {
    /**
     * Creates an actionable CLI error whose message includes the supported build invocation.
     *
     * @param message - Specific command-line usage error.
     */
    public constructor(message: string) {
        super(`${message}\n${USAGE}`);
        this.name = "UsageError";
    }
}

/**
 * Writes Commander help text to standard output.
 *
 * @param value - Formatted help text produced by Commander.
 */
function writeHelp(value: string): void {
    process.stdout.write(value);
}

/**
 * Creates the optional browser argument shared by both build commands.
 *
 * @returns - Commander argument restricted to supported browser targets.
 */
function browserArgument(): Argument {
    return new Argument("[browser]", "browser artifact to build").choices(BROWSERS);
}

/**
 * Builds a typed request from a supported mode and optional browser choice.
 *
 * @param mode - Command-selected development or release mode.
 * @param browser - Optional browser selected by the command.
 * @param watch - Whether continuous development compilation was requested.
 * @returns - Complete request consumed by the build pipeline.
 */
export function createBuildRequest(
    mode: BuildMode,
    browser: string | undefined,
    watch: boolean,
): BuildRequest {
    if (browser !== undefined && !isBrowser(browser)) {
        throw new UsageError(`Unknown browser: ${browser}`);
    }
    return {
        mode,
        browsers: browser === undefined ? [...BROWSERS] : [browser],
        watch,
    };
}

/**
 * Removes Commander's presentation prefix before wrapping an error in the project CLI contract.
 *
 * @param error - Commander parsing error.
 * @returns - Concise human-readable parsing failure.
 */
function commanderMessage(error: CommanderError): string {
    return error.message.replace(/^error:\s*/u, "");
}

/**
 * Parses the current process arguments into one validated build request.
 *
 * @returns - Validated request, or null after displaying requested help.
 */
export function parseBuildCli(): BuildRequest | null {
    let request: BuildRequest | undefined;
    const program = new Command()
        .name("pnpm")
        .description("Build No More Ago browser extension artifacts.")
        .showSuggestionAfterError()
        .exitOverride()
        .configureOutput({
            writeOut: writeHelp,
            writeErr: () => undefined,
        });

    program
        .command(BUILD_MODE.DEV)
        .description("build development artifacts")
        .addArgument(browserArgument())
        .option("--watch", "watch one browser target for changes")
        .action((browser: string | undefined, options: { readonly watch?: boolean }) => {
            const watch = options.watch === true;
            if (watch && browser === undefined) {
                throw new UsageError("Watch requires one browser");
            }
            request = createBuildRequest(BUILD_MODE.DEV, browser, watch);
        });

    program
        .command(BUILD_MODE.RELEASE)
        .description("build release artifacts")
        .addArgument(browserArgument())
        .action((browser: string | undefined) => {
            request = createBuildRequest(BUILD_MODE.RELEASE, browser, false);
        });

    try {
        program.parse();
    } catch (error) {
        if (error instanceof UsageError) {
            throw error;
        }
        if (error instanceof CommanderError) {
            if (error.code === "commander.helpDisplayed") {
                return null;
            }
            throw new UsageError(commanderMessage(error));
        }
        throw error;
    }
    if (request === undefined) {
        throw new UsageError("Choose dev or release");
    }
    return request;
}
