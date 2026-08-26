/**
 * @file Build compilation, artifact publication, and watch-mode lifecycle orchestration.
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { setImmediate } from "node:timers";
import path from "node:path";
import rspack from "@rspack/core";
import { createRspackConfig } from "../../rspack.config.ts";
import { assertSafe, createArtifactServices } from "./artifacts.ts";
import type { BuildRequest } from "./cli.ts";

/**
 * Maximum time allowed for the watch compiler to close after an interrupted build.
 */
const WATCH_CLOSE_TIMEOUT_MS = 5_000;

/**
 * Lifecycle notification emitted around compile, package, publish, and watch transitions.
 */
type BuildEvent = Record<string, unknown>;

/**
 * Optional observer of build progress; it never controls or mutates the pipeline.
 */
type EventSink = (event: BuildEvent) => void;

/**
 * Compiler result surface required to decide success and render an actionable error.
 */
type CompilerStats = {
    /**
     * Reports whether compilation produced an error.
     */
    hasErrors(): boolean;

    /**
     * Renders compiler diagnostics using optional formatter settings.
     */
    toString(options?: unknown): string;
};

/**
 * Minimal compiler lifecycle surface used to run and always close one compilation.
 */
export type CompilerLike = {
    /**
     * Executes one compilation and reports its result.
     */
    run(callback: (error: Error | null, stats?: CompilerStats) => void): void;

    /**
     * Releases compiler resources after a build, when supported.
     */
    close?(callback: (error?: Error | null) => void): void;

    /**
     * Starts continuous compilation and reports every completed result.
     */
    watch(options: unknown, callback: (error: Error | null, stats?: CompilerStats) => void): void;
};

/**
 * Factory seam that creates a compiler from the generated Rspack configuration.
 */
export type CompilerFactory = (...args: any[]) => CompilerLike;

/**
 * Guarded artifact operations required to snapshot, verify, package, and publish browser builds.
 */
type ArtifactServices = ReturnType<typeof createArtifactServices>;

/**
 * Optional test hooks run at deterministic points around each build phase.
 */
type PhaseHooks = {
    /**
     * Whether a failed test build preserves its temporary task directory.
     */
    keepTask?: boolean;

    /**
     * Runs immediately before compiler execution.
     */
    beforeCompile?: () => void;

    /**
     * Runs immediately before artifact packaging.
     */
    beforePackage?: () => void;

    /**
     * Runs immediately before artifact publication.
     */
    beforePublish?: () => void;

    /**
     * Runs immediately after artifact publication.
     */
    afterPublish?: () => void;

    /**
     * Runs after temporary build resources have been cleaned.
     */
    afterCleanup?: () => void;
};

/**
 * Injectable build dependencies and defaults used by the command-line entry point.
 */
type BuildOptions = {
    /**
     * Project root containing source files and build configuration.
     */
    workspaceRoot?: string;

    /**
     * Commander-validated build mode, browser targets, and watch behavior.
     */
    request: BuildRequest;

    /**
     * Optional compiler factory used instead of the production Rspack factory.
     */
    compilerFactory?: CompilerFactory;

    /**
     * Optional guarded artifact services used instead of production services.
     */
    artifacts?: ArtifactServices;

    /**
     * Optional observer receiving structured build lifecycle events.
     */
    events?: EventSink;

    /**
     * Optional deterministic phase hooks used by lifecycle tests.
     */
    phaseHooks?: PhaseHooks;
};

/**
 * Fully resolved build dependencies shared by compile, package, and publication steps.
 */
type BuildContext = {
    /**
     * Absolute project root used by every build phase.
     */
    workspaceRoot: string;

    /**
     * Validated development or release mode.
     */
    mode: BuildRequest["mode"];

    /**
     * Validated browser targets selected for compilation.
     */
    browsers: BuildRequest["browsers"];

    /**
     * Guarded temporary directory allocated for the complete build.
     */
    taskRoot: string;

    /**
     * Artifact services used for packaging and publication.
     */
    artifacts: ArtifactServices;

    /**
     * Compiler factory used for each selected browser.
     */
    compilerFactory: CompilerFactory;

    /**
     * Observer receiving structured build lifecycle events.
     */
    events: EventSink;
};

/**
 * Error enriched with cleanup state so the caller can preserve diagnostic artifacts when needed.
 */
type BuildError = Error & {
    /**
     * Whether cleanup must preserve the temporary task directory for diagnosis.
     */
    keepTask?: boolean;
};

const defaultCompilerFactory = rspack as unknown as CompilerFactory;

/**
 * Removes an incomplete candidate artifact left after a recoverable build failure.
 *
 * @param artifacts - Guarded artifact services used for cleanup.
 * @param candidate - Incomplete candidate directory to remove.
 * @param error - Build error to enrich if cleanup also fails.
 */
function removeRecoverableCandidate(
    artifacts: ArtifactServices,
    candidate: string,
    error: BuildError,
): void {
    try {
        artifacts.cleanupCandidate(candidate);
    } catch (cleanupError) {
        error.keepTask = true;
        const cleanupMessage = cleanupError instanceof Error
            ? cleanupError.message
            : String(cleanupError);
        error.message = `${error.message}; candidate cleanup failed at ${candidate}: `
            + cleanupMessage;
    }
}

/**
 * Runs one compiler instance and resolves only after its resources are closed.
 *
 * @param config - Rspack configuration passed to the compiler factory.
 * @param compilerFactory - Factory used to construct the compiler.
 * @returns - Compiler statistics after a successful closed run.
 */
function compileOnce(
    config: unknown,
    compilerFactory: CompilerFactory = defaultCompilerFactory,
): Promise<CompilerStats | undefined> {
    return new Promise((resolve, reject) => {
        let compiler;
        try {
            compiler = compilerFactory(config);
        } catch (error) {
            reject(error);
            return;
        }
        compiler.run((error, stats) => {
            const failure =
                error ??
                (stats?.hasErrors() ? new Error(stats.toString({ errors: true })) : undefined);
            const settle = () => {
                if (failure) {
                    reject(failure);
                } else {
                    resolve(stats);
                }
            };
            if (typeof compiler.close === "function") {
                try {
                    compiler.close((closeError) => {
                        if (closeError && !failure) {
                            reject(closeError);
                        } else {
                            settle();
                        }
                    });
                } catch (closeError) {
                    reject(closeError);
                }
            } else {
                settle();
            }
        });
    });
}

/**
 * Extracts matching directory and ZIP artifacts from compiler output.
 *
 * @param input - Compilation output and artifact dependencies.
 * @param input.outputPath - Directory emitted by the compiler.
 * @param input.taskRoot - Temporary root for this build task.
 * @param input.artifacts - Guarded artifact services.
 * @returns - Validated unpacked directory and matching ZIP bytes.
 */
function pairFromCompilation({
    outputPath,
    taskRoot,
    artifacts,
}: {
    outputPath: string;
    taskRoot: string;
    artifacts: ArtifactServices;
}): { directory: string; zipBytes: Buffer } {
    const generation = mkdtempSync(path.join(taskRoot, ".generation-"));
    try {
        artifacts.snapshot(outputPath, generation);
        const zipBytes = artifacts.createZip(generation);
        artifacts.validatePair(generation, zipBytes);
        return { directory: generation, zipBytes };
    } catch (error) {
        rmSync(generation, { recursive: true, force: true });
        throw error;
    }
}

/**
 * Compiles and packages every requested browser variant before publishing a complete mode root.
 *
 * @param context - Fully resolved build dependencies and targets.
 * @param context.workspaceRoot - Absolute project workspace path.
 * @param context.mode - Validated build mode.
 * @param context.browsers - Browser targets to compile.
 * @param context.taskRoot - Temporary root for this build task.
 * @param context.artifacts - Guarded artifact services.
 * @param context.compilerFactory - Factory used to construct compilers.
 * @param context.events - Build progress event sink.
 * @returns - Validated artifact pair for each requested browser.
 */
async function buildAll({
    workspaceRoot,
    mode,
    browsers,
    taskRoot,
    artifacts,
    compilerFactory,
    events,
}: BuildContext): Promise<Record<string, { directory: string; zipBytes: Buffer }>> {
    const pairs: Record<string, { directory: string; zipBytes: Buffer }> = {};
    for (const browser of browsers) {
        const outputPath = path.join(taskRoot, `compiler-${browser}`);
        events?.({ type: "phase", phase: "compile", browser });
        await compileOnce(
            createRspackConfig({ workspaceRoot, browser, mode, outputPath }),
            compilerFactory,
        );
        events?.({ type: "phase", phase: "package", browser });
        pairs[browser] = pairFromCompilation({ outputPath, taskRoot, artifacts });
    }
    const selected = browsers.length === 1 ? browsers[0] : undefined;
    events?.({ type: "phase", phase: "publish", mode });
    const buildInput =
        selected === undefined
            ? { workspaceRoot, mode, pairs }
            : { workspaceRoot, mode, pairs, selected };
    const { candidate, modeRoot } = artifacts.buildCandidateModeRoot(buildInput);
    try {
        artifacts.publishModeRoot({ candidate, modeRoot, taskRoot });
    } catch (error) {
        const buildError = error as BuildError;
        if (!buildError.keepTask) {
            removeRecoverableCandidate(artifacts, candidate, buildError);
        }
        throw buildError;
    }
    events?.({ type: "build", sequence: 1, status: "success", mode, browsers });
    return pairs;
}

/**
 * Runs the requested build or watch workflow from validated command-line options.
 *
 * @param options - Command inputs and injectable build dependencies.
 * @param options.workspaceRoot - Project workspace path.
 * @param options.request - Commander-validated build request.
 * @param options.compilerFactory - Factory used to construct compilers.
 * @param options.artifacts - Guarded artifact services.
 * @param options.events - Build progress event sink.
 * @param options.phaseHooks - Testable lifecycle hooks for task cleanup.
 * @returns - Watch completion promise, or no value after a one-off build.
 */
export async function runBuildCommand({
    workspaceRoot = process.cwd(),
    request,
    compilerFactory = defaultCompilerFactory,
    artifacts = createArtifactServices(),
    events = () => undefined,
    phaseHooks = {},
}: BuildOptions): Promise<Promise<void> | void> {
    const root = path.resolve(workspaceRoot);
    const dist = path.join(root, "dist");
    if (existsSync(dist)) {
        assertSafe(path.dirname(dist), dist);
    } else {
        mkdirSync(dist, { recursive: false });
    }
    const taskRoot = mkdtempSync(path.join(dist, ".task-"));
    if (request.watch) {
        try {
            return startWatch({
                workspaceRoot: root,
                request,
                taskRoot,
                compilerFactory,
                artifacts,
                events,
                phaseHooks,
            });
        } catch (error) {
            try {
                artifacts.cleanupTask(taskRoot);
            } catch {
                /* retain an actionable failure root */
            }
            throw error;
        }
    }
    let keepTask = Boolean(phaseHooks.keepTask);
    try {
        await buildAll({
            workspaceRoot: root,
            mode: request.mode,
            browsers: request.browsers,
            taskRoot,
            artifacts,
            compilerFactory,
            events,
        });
    } catch (error) {
        keepTask ||= Boolean((error as BuildError)?.keepTask);
        throw error;
    } finally {
        if (!keepTask) {
            try {
                artifacts.cleanupTask(taskRoot);
            } catch {
                /* preserve actionable publication backups */
            }
        }
    }
}

/**
 * Starts one compiler watch per requested browser, publishes only complete artifact pairs, and
 * resolves after the first successful publication or rejects after a compiler failure.
 *
 * @param input - Resolved watch workflow dependencies.
 * @param input.workspaceRoot - Absolute project workspace path.
 * @param input.request - Validated single-browser watch request.
 * @param input.taskRoot - Temporary root retained for watch generations.
 * @param input.compilerFactory - Factory used to construct the compiler.
 * @param input.artifacts - Guarded artifact services.
 * @param input.events - Build progress event sink.
 * @param input.phaseHooks - Testable lifecycle hooks for cleanup.
 * @returns - Promise settled after the watcher closes and cleanup completes.
 */
function startWatch({
    workspaceRoot,
    request,
    taskRoot,
    compilerFactory,
    artifacts,
    events,
    phaseHooks,
}: {
    workspaceRoot: string;
    request: BuildRequest;
    taskRoot: string;
    compilerFactory: CompilerFactory;
    artifacts: ArtifactServices;
    events: EventSink;
    phaseHooks: PhaseHooks;
}): Promise<void> {
    const browser = request.browsers[0];
    if (!browser) {
        throw new Error("Watch requires one browser");
    }
    const outputPath = path.join(taskRoot, `compiler-${browser}`);
    let compiler: CompilerLike | undefined;
    let closing = false;
    let preserveTask = false;
    let sequence = 0;
    let settled: () => void;
    // Rspack schedules its next file watcher from process.nextTick after invoking
    // this callback. Publish build status on the next event-loop turn so
    // consumers cannot mutate a maintained input in the gap before that watcher
    // is re-armed. A microtask is still ahead of later watcher setup work on
    // some Rspack versions, which makes the first emitted success racy.
    const emitAfterWatchRearm = (event: BuildEvent): void => {
        setImmediate(() => {
            if (!closing) {
                events(event);
            }
        });
    };
    const done = new Promise<void>((resolve) => {
        settled = resolve;
    });
    const finish = () => {
        if (closing) {
            return;
        }
        closing = true;
        let completed = false;
        const complete = () => {
            if (completed) {
                return;
            }
            completed = true;
            if (!preserveTask) {
                try {
                    artifacts.cleanupTask(taskRoot);
                } catch {
                    /* preserve recovery paths */
                }
            }
            phaseHooks.afterCleanup?.();
            settled();
        };
        const timeout = setTimeout(complete, WATCH_CLOSE_TIMEOUT_MS);
        if (typeof compiler?.close === "function") {
            compiler.close(() => {
                clearTimeout(timeout);
                complete();
            });
        } else {
            clearTimeout(timeout);
            complete();
        }
    };
    const onSignal = () => finish();
    process.once("SIGINT", onSignal);
    process.once("SIGTERM", onSignal);
    done.finally(() => {
        process.off("SIGINT", onSignal);
        process.off("SIGTERM", onSignal);
    });
    events({ type: "ready", pid: process.pid, browser, mode: "dev", session: taskRoot });
    phaseHooks.beforeCompile?.();
    compiler = compilerFactory(
        createRspackConfig({ workspaceRoot, browser, mode: "dev", outputPath }),
    );
    compiler.watch({}, (error, stats) => {
        if (closing) {
            return;
        }
        if (error || stats?.hasErrors()) {
            emitAfterWatchRearm({
                type: "build",
                sequence: ++sequence,
                status: "failed",
                error: error?.message ?? "Compilation failed",
            });
            return;
        }
        let pair;
        let generationActive = false;
        let candidate;
        try {
            events({ type: "phase", phase: "package", browser });
            phaseHooks.beforePackage?.();
            events({ type: "allocation", resource: "generation", action: "start", browser });
            generationActive = true;
            pair = pairFromCompilation({ outputPath, taskRoot, artifacts });
            const pairs = { [browser]: pair };
            const built = artifacts.buildCandidateModeRoot({
                workspaceRoot,
                mode: "dev",
                pairs,
                selected: browser,
            });
            candidate = built.candidate;
            const { modeRoot } = built;
            events({ type: "allocation", resource: "candidate", action: "start", browser });
            events({ type: "phase", phase: "publish", browser });
            events({ type: "phase", phase: "promotion", browser });
            try {
                phaseHooks.beforePublish?.();
                artifacts.publishModeRoot({ candidate, modeRoot, taskRoot });
                phaseHooks.afterPublish?.();
            } catch (error) {
                const buildError = error as BuildError;
                if (!buildError.keepTask) {
                    removeRecoverableCandidate(artifacts, candidate, buildError);
                }
                throw buildError;
            } finally {
                events({ type: "allocation", resource: "candidate", action: "end", browser });
            }
            rmSync(pair.directory, { recursive: true, force: true });
            events({ type: "allocation", resource: "generation", action: "end", browser });
            emitAfterWatchRearm({
                type: "build",
                sequence: ++sequence,
                status: "success",
                browser,
                mode: "dev",
            });
        } catch (error) {
            const buildError = error as BuildError;
            preserveTask ||= Boolean(buildError.keepTask);
            if (pair?.directory) {
                try {
                    rmSync(pair.directory, { recursive: true, force: true });
                } catch {
                    /* preserve only unrecoverable publication state */
                }
            }
            if (generationActive) {
                events({ type: "allocation", resource: "generation", action: "end", browser });
            }
            emitAfterWatchRearm({
                type: "build",
                sequence: ++sequence,
                status: "failed",
                error: buildError.message,
            });
        }
    });
    return done;
}

export { buildAll };
