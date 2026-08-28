/**
 * @file Runs one-shot and watch builds for browser-extension artifacts.
 */

import { mkdirSync } from "node:fs";
import { setImmediate } from "node:timers";
import path from "node:path";
import rspack from "@rspack/core";
import { createRspackConfig } from "../../rspack.config.ts";
import type { BuildRequest } from "./cli.ts";
import { writeArtifactZip } from "./artifacts.ts";
import { BUILD_MODE, type Browser, type BuildMode } from "./contracts.ts";

/**
 * Structured progress event emitted by the build process.
 */
type BuildEvent = Record<string, unknown>;

/**
 * Receives build progress events, primarily for watch-mode status output.
 */
type EventSink = (event: BuildEvent) => void;

/**
 * Compiler result surface used by the build runner.
 */
interface CompilerStats {
    /**
     * Reports whether compilation produced errors.
     */
    hasErrors(): boolean;

    /**
     * Formats compilation diagnostics.
     */
    toString(options?: unknown): string;
}

/**
 * Compiler surface used for one-shot and watch builds.
 */
interface Compiler {
    /**
     * Executes one compilation.
     */
    run(callback: (error: Error | null, stats?: CompilerStats) => void): void;

    /**
     * Starts continuous compilation.
     */
    watch(options: unknown, callback: (error: Error | null, stats?: CompilerStats) => void): void;

    /**
     * Releases compiler and watcher resources.
     */
    close(callback: (error?: Error | null) => void): void;
}

/**
 * Inputs accepted by the extension build runner.
 */
interface BuildOptions {
    /**
     * Project root containing package and source files.
     */
    readonly workspaceRoot?: string;

    /**
     * Validated build targets and watch selection.
     */
    readonly request: BuildRequest;

    /**
     * Optional build progress observer.
     */
    readonly events?: EventSink;
}

const createCompiler = rspack as unknown as (config: unknown) => Compiler;

/**
 * Converts compiler callbacks into a single closed one-shot compilation.
 *
 * @param compiler - Rspack compiler to execute and close.
 * @returns - Promise settled when compilation and cleanup finish.
 */
function runCompiler(compiler: Compiler): Promise<void> {
    return new Promise((resolve, reject) => {
        compiler.run((error, stats) => {
            const compilationError = error
                ?? (stats?.hasErrors() ? new Error(stats.toString({ errors: true })) : undefined);
            compiler.close((closeError) => {
                if (compilationError) {
                    reject(compilationError);
                } else if (closeError) {
                    reject(closeError);
                } else {
                    resolve();
                }
            });
        });
    });
}

/**
 * Returns output paths for one browser and build mode.
 *
 * @param workspaceRoot - Absolute project root.
 * @param mode - Development or release mode.
 * @param browser - Browser target being built.
 * @returns - Unpacked output and matching ZIP paths.
 */
function artifactPaths(
    workspaceRoot: string,
    mode: BuildMode,
    browser: Browser,
): { readonly directory: string; readonly zip: string } {
    const modeRoot = path.join(workspaceRoot, "dist", mode);
    return {
        directory: path.join(modeRoot, browser),
        zip: path.join(modeRoot, `${browser}.zip`),
    };
}

/**
 * Builds and packages one browser target.
 *
 * @param workspaceRoot - Absolute project root.
 * @param mode - Development or release mode.
 * @param browser - Browser target being built.
 */
async function buildBrowser(
    workspaceRoot: string,
    mode: BuildMode,
    browser: Browser,
): Promise<void> {
    const output = artifactPaths(workspaceRoot, mode, browser);
    mkdirSync(path.dirname(output.directory), { recursive: true });
    const compiler = createCompiler(
        createRspackConfig({
            workspaceRoot,
            browser,
            mode,
            outputPath: output.directory,
        }),
    );
    await runCompiler(compiler);
    writeArtifactZip(output.directory, output.zip);
}

/**
 * Starts continuous compilation for one development browser target.
 *
 * @param workspaceRoot - Absolute project root.
 * @param browser - Browser target being watched.
 * @param events - Build progress observer.
 * @returns - Promise settled after the watcher receives a termination signal.
 */
function watchBrowser(
    workspaceRoot: string,
    browser: Browser,
    events: EventSink,
): Promise<void> {
    const output = artifactPaths(workspaceRoot, BUILD_MODE.DEV, browser);
    mkdirSync(path.dirname(output.directory), { recursive: true });
    const compiler = createCompiler(
        createRspackConfig({
            workspaceRoot,
            browser,
            mode: BUILD_MODE.DEV,
            outputPath: output.directory,
        }),
    );
    let sequence = 0;
    let stopping = false;
    let finish: () => void;
    const done = new Promise<void>((resolve) => {
        finish = resolve;
    });
    const stop = (): void => {
        if (stopping) {
            return;
        }
        stopping = true;
        compiler.close(() => {
            finish();
        });
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    done.finally(() => {
        process.off("SIGINT", stop);
        process.off("SIGTERM", stop);
    });
    compiler.watch({}, (error, stats) => {
        if (stopping) {
            return;
        }
        const compilationError = error
            ?? (stats?.hasErrors() ? new Error(stats.toString({ errors: true })) : undefined);
        if (compilationError) {
            events({
                type: "build",
                status: "failed",
                sequence: ++sequence,
                error: compilationError.message,
            });
            return;
        }
        try {
            writeArtifactZip(output.directory, output.zip);
            const event = {
                type: "build",
                status: "success",
                sequence: ++sequence,
                browser,
                mode: BUILD_MODE.DEV,
            };
            setImmediate(() => {
                if (!stopping) {
                    events(event);
                }
            });
        } catch (buildError) {
            events({
                type: "build",
                status: "failed",
                sequence: ++sequence,
                error: buildError instanceof Error ? buildError.message : String(buildError),
            });
        }
    });
    events({
        type: "ready",
        pid: process.pid,
        browser,
        mode: BUILD_MODE.DEV,
    });
    return done;
}

/**
 * Runs a validated one-shot or watch build request.
 *
 * @param options - Build request and optional progress observer.
 * @param options.workspaceRoot - Project root containing build inputs.
 * @param options.request - Validated build request.
 * @param options.events - Optional progress observer.
 * @returns - Promise settled after the build or watch session ends.
 */
export async function runBuildCommand({
    workspaceRoot = process.cwd(),
    request,
    events = () => undefined,
}: BuildOptions): Promise<void> {
    const root = path.resolve(workspaceRoot);
    if (request.watch) {
        const browser = request.browsers[0];
        if (request.mode !== BUILD_MODE.DEV || request.browsers.length !== 1 || !browser) {
            throw new Error("Watch requires one development browser");
        }
        await watchBrowser(root, browser, events);
        return;
    }
    for (const browser of request.browsers) {
        await buildBrowser(root, request.mode, browser);
    }
}
