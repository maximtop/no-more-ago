/**
 * @file Commander-based parsing for development and release build commands.
 */

import { Argument, Command, CommanderError } from "commander";
import { BROWSERS, isBrowser, type Browser, type BuildMode } from "./contracts.ts";

/**
 * Compact usage text appended to build command errors.
 */
export const USAGE = "Usage: pnpm dev|release [chrome|firefox|edge] [--watch]";

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
 * Builds a typed request after Commander has validated the browser choice.
 *
 * @param mode - Command-selected development or release mode.
 * @param browser - Optional browser selected by the command.
 * @param watch - Whether continuous development compilation was requested.
 * @returns - Complete request consumed by the build pipeline.
 */
function buildRequest(
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
 * Parses a complete Node process argument vector into one validated build request.
 *
 * @param argv - Node-style argument vector beginning with executable and script paths.
 * @param outputHelp - Destination for explicit Commander help output.
 * @returns - Validated request, or null after displaying requested help.
 */
export function parseBuildCli(
    argv: readonly string[],
    outputHelp: (value: string) => void = writeHelp,
): BuildRequest | null {
    let request: BuildRequest | undefined;
    const program = new Command()
        .name("pnpm")
        .description("Build No More Ago browser extension artifacts.")
        .showSuggestionAfterError()
        .exitOverride()
        .configureOutput({
            writeOut: outputHelp,
            writeErr: () => undefined,
        });

    program
        .command("dev")
        .description("build development artifacts")
        .addArgument(browserArgument())
        .option("--watch", "watch one browser target for changes")
        .action((browser: string | undefined, options: { readonly watch?: boolean }) => {
            const watch = options.watch === true;
            if (watch && browser === undefined) {
                throw new UsageError("Watch requires one browser");
            }
            request = buildRequest("dev", browser, watch);
        });

    program
        .command("release")
        .description("build release artifacts")
        .addArgument(browserArgument())
        .action((browser: string | undefined) => {
            request = buildRequest("release", browser, false);
        });

    try {
        program.parse([...argv], { from: "node" });
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

/**
 * Parses a mode and trailing arguments through the same Commander program used by the CLI.
 *
 * @param mode - Requested build subcommand.
 * @param argv - Browser and option arguments following the subcommand.
 * @returns - Validated build request.
 */
export function parseBuildRequest(mode: string, argv: readonly string[]): BuildRequest {
    const request = parseBuildCli(
        ["node", "scripts/build.ts", mode, ...argv],
        () => undefined,
    );
    if (request === null) {
        throw new UsageError("Help does not describe a build request");
    }
    return request;
}
