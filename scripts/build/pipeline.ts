import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { setImmediate } from "node:timers";
import path from "node:path";
import rspack from "@rspack/core";
import { BROWSERS, MODES, createRspackConfig } from "../../rspack.config.ts";
import { assertSafe, createArtifactServices } from "./artifacts.ts";

export const USAGE = "Usage: pnpm dev|release [chrome|firefox|edge] [--watch]";

type BuildRequest = { mode: string; browsers: string[]; watch: boolean };
type BuildEvent = Record<string, unknown>;
type EventSink = (event: BuildEvent) => void;
type CompilerStats = { hasErrors(): boolean; toString(options?: unknown): string };
export type CompilerLike = {
    run(callback: (error: Error | null, stats?: CompilerStats) => void): void;
    close?(callback: (error?: Error | null) => void): void;
    watch(options: unknown, callback: (error: Error | null, stats?: CompilerStats) => void): void;
};
export type CompilerFactory = (...args: any[]) => CompilerLike;
type ArtifactServices = ReturnType<typeof createArtifactServices>;
type PhaseHooks = {
    keepTask?: boolean;
    beforeCompile?: () => void;
    beforePackage?: () => void;
    beforePublish?: () => void;
    afterPublish?: () => void;
    afterCleanup?: () => void;
};
type BuildOptions = {
    workspaceRoot?: string;
    mode: string;
    argv?: string[];
    compilerFactory?: CompilerFactory;
    artifacts?: ArtifactServices;
    events?: EventSink;
    phaseHooks?: PhaseHooks;
};
type BuildContext = {
    workspaceRoot: string;
    mode: string;
    browsers: string[];
    taskRoot: string;
    artifacts: ArtifactServices;
    compilerFactory: CompilerFactory;
    events: EventSink;
};
type BuildError = Error & { keepTask?: boolean };

const defaultCompilerFactory = rspack as unknown as CompilerFactory;

export function parseBuildRequest(mode: string, argv: string[]): BuildRequest {
    if (!MODES.includes(mode)) throw new UsageError(`Unknown mode: ${mode}`);
    const args = [...argv]; const watch = args.includes("--watch");
    if (args.includes("--watch")) args.splice(args.indexOf("--watch"), 1);
    if (args.some((arg) => arg.startsWith("-"))) throw new UsageError("Unknown flag");
    if (args.length > 1) throw new UsageError("Expected at most one browser");
    if (watch && mode !== "dev") throw new UsageError("Watch is available only for dev");
    if (watch && args.length !== 1) throw new UsageError("Watch requires one browser");
    const browsers = args.length === 0 ? [...BROWSERS] : [args[0]].filter((browser): browser is string => browser !== undefined);
    if (browsers.some((browser) => !BROWSERS.includes(browser))) throw new UsageError(`Unknown browser: ${browsers.find((browser) => !BROWSERS.includes(browser))}`);
    return { mode, browsers, watch };
}

export class UsageError extends Error { constructor(message: string) { super(`${message}\n${USAGE}`); this.name = "UsageError"; } }

function removeRecoverableCandidate(artifacts: ArtifactServices, candidate: string, error: BuildError): void {
    try { artifacts.cleanupCandidate(candidate); }
    catch (cleanupError) { error.keepTask = true; error.message = `${error.message}; candidate cleanup failed at ${candidate}: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`; }
}

function compileOnce(config: unknown, compilerFactory: CompilerFactory = defaultCompilerFactory): Promise<CompilerStats | undefined> {
    return new Promise((resolve, reject) => {
        let compiler;
        try { compiler = compilerFactory(config); } catch (error) { reject(error); return; }
        compiler.run((error, stats) => {
            const failure = error ?? (stats?.hasErrors() ? new Error(stats.toString({ errors: true })) : undefined);
            const settle = () => { if (failure) reject(failure); else resolve(stats); };
            if (typeof compiler.close === "function") {
                try { compiler.close((closeError) => { if (closeError && !failure) reject(closeError); else settle(); }); }
                catch (closeError) { reject(closeError); }
            } else settle();
        });
    });
}

function pairFromCompilation({ outputPath, taskRoot, artifacts }: { outputPath: string; taskRoot: string; artifacts: ArtifactServices }): { directory: string; zipBytes: Buffer } {
    const generation = mkdtempSync(path.join(taskRoot, ".generation-"));
    try {
        artifacts.snapshot(outputPath, generation);
        const zipBytes = artifacts.createZip(generation);
        artifacts.validatePair(generation, zipBytes);
        return { directory: generation, zipBytes };
    } catch (error) { rmSync(generation, { recursive: true, force: true }); throw error; }
}

async function buildAll({ workspaceRoot, mode, browsers, taskRoot, artifacts, compilerFactory, events }: BuildContext): Promise<Record<string, { directory: string; zipBytes: Buffer }>> {
    const pairs: Record<string, { directory: string; zipBytes: Buffer }> = {};
    for (const browser of browsers) {
        const outputPath = path.join(taskRoot, `compiler-${browser}`);
        events?.({ type: "phase", phase: "compile", browser });
        await compileOnce(createRspackConfig({ workspaceRoot, browser, mode, outputPath }), compilerFactory);
        events?.({ type: "phase", phase: "package", browser });
        pairs[browser] = pairFromCompilation({ outputPath, taskRoot, artifacts });
    }
    const selected = browsers.length === 1 ? browsers[0] : undefined;
    events?.({ type: "phase", phase: "publish", mode });
    const buildInput = selected === undefined ? { workspaceRoot, mode, pairs } : { workspaceRoot, mode, pairs, selected };
    const { candidate, modeRoot } = artifacts.buildCandidateModeRoot(buildInput);
    try { artifacts.publishModeRoot({ candidate, modeRoot, taskRoot }); }
    catch (error) { const buildError = error as BuildError; if (!buildError.keepTask) removeRecoverableCandidate(artifacts, candidate, buildError); throw buildError; }
    events?.({ type: "build", sequence: 1, status: "success", mode, browsers });
    return pairs;
}

export async function runBuildCommand({ workspaceRoot = process.cwd(), mode, argv = [], compilerFactory = defaultCompilerFactory, artifacts = createArtifactServices(), events = () => undefined, phaseHooks = {} }: BuildOptions): Promise<Promise<void> | void> {
    const request = parseBuildRequest(mode, argv);
    const root = path.resolve(workspaceRoot); const dist = path.join(root, "dist");
    if (existsSync(dist)) assertSafe(path.dirname(dist), dist);
    else mkdirSync(dist, { recursive: false });
    const taskRoot = mkdtempSync(path.join(dist, ".task-"));
    if (request.watch) {
        try { return startWatch({ workspaceRoot: root, request, taskRoot, compilerFactory, artifacts, events, phaseHooks }); }
        catch (error) { try { artifacts.cleanupTask(taskRoot); } catch { /* retain an actionable failure root */ } throw error; }
    }
    let keepTask = Boolean(phaseHooks.keepTask);
    try { await buildAll({ workspaceRoot: root, mode: request.mode, browsers: request.browsers, taskRoot, artifacts, compilerFactory, events }); }
    catch (error) { keepTask ||= Boolean((error as BuildError)?.keepTask); throw error; }
    finally { if (!keepTask) { try { artifacts.cleanupTask(taskRoot); } catch { /* preserve actionable publication backups */ } } }
}

function startWatch({ workspaceRoot, request, taskRoot, compilerFactory, artifacts, events, phaseHooks }: { workspaceRoot: string; request: BuildRequest; taskRoot: string; compilerFactory: CompilerFactory; artifacts: ArtifactServices; events: EventSink; phaseHooks: PhaseHooks }): Promise<void> {
    const browser = request.browsers[0];
    if (!browser) throw new Error("Watch requires one browser");
    const outputPath = path.join(taskRoot, `compiler-${browser}`); let compiler: CompilerLike | undefined; let closing = false; let preserveTask = false; let sequence = 0; let settled: () => void;
    // Rspack schedules its next file watcher from process.nextTick after invoking
    // this callback. Publish build status on the next event-loop turn so
    // consumers cannot mutate a maintained input in the gap before that watcher
    // is re-armed. A microtask is still ahead of later watcher setup work on
    // some Rspack versions, which makes the first emitted success racy.
    const emitAfterWatchRearm = (event: BuildEvent): void => { setImmediate(() => { if (!closing) events(event); }); };
    const done = new Promise<void>((resolve) => { settled = resolve; });
    const finish = () => {
        if (closing) return;
        closing = true;
        let completed = false;
        const complete = () => { if (completed) return; completed = true; if (!preserveTask) { try { artifacts.cleanupTask(taskRoot); } catch { /* preserve recovery paths */ } } phaseHooks.afterCleanup?.(); settled(); };
        const timeout = setTimeout(complete, 5000);
        if (typeof compiler?.close === "function") compiler.close(() => { clearTimeout(timeout); complete(); });
        else { clearTimeout(timeout); complete(); }
    };
    const onSignal = () => finish(); process.once("SIGINT", onSignal); process.once("SIGTERM", onSignal);
    done.finally(() => { process.off("SIGINT", onSignal); process.off("SIGTERM", onSignal); });
    events({ type: "ready", pid: process.pid, browser, mode: "dev", session: taskRoot });
    phaseHooks.beforeCompile?.();
    compiler = compilerFactory(createRspackConfig({ workspaceRoot, browser, mode: "dev", outputPath }));
    compiler.watch({}, (error, stats) => {
        if (closing) return;
        if (error || stats?.hasErrors()) { emitAfterWatchRearm({ type: "build", sequence: ++sequence, status: "failed", error: error?.message ?? "Compilation failed" }); return; }
        let pair; let generationActive = false; let candidate;
        try {
            events({ type: "phase", phase: "package", browser });
            phaseHooks.beforePackage?.();
            events({ type: "allocation", resource: "generation", action: "start", browser });
            generationActive = true; pair = pairFromCompilation({ outputPath, taskRoot, artifacts });
            const pairs = { [browser]: pair }; const built = artifacts.buildCandidateModeRoot({ workspaceRoot, mode: "dev", pairs, selected: browser }); candidate = built.candidate; const { modeRoot } = built;
            events({ type: "allocation", resource: "candidate", action: "start", browser });
            events({ type: "phase", phase: "publish", browser });
            events({ type: "phase", phase: "promotion", browser });
            try { phaseHooks.beforePublish?.(); artifacts.publishModeRoot({ candidate, modeRoot, taskRoot }); phaseHooks.afterPublish?.(); }
            catch (error) { const buildError = error as BuildError; if (!buildError.keepTask) removeRecoverableCandidate(artifacts, candidate, buildError); throw buildError; }
            finally { events({ type: "allocation", resource: "candidate", action: "end", browser }); }
            rmSync(pair.directory, { recursive: true, force: true });
            events({ type: "allocation", resource: "generation", action: "end", browser });
            emitAfterWatchRearm({ type: "build", sequence: ++sequence, status: "success", browser, mode: "dev" });
        } catch (error) {
            const buildError = error as BuildError;
            preserveTask ||= Boolean(buildError.keepTask);
            if (pair?.directory) { try { rmSync(pair.directory, { recursive: true, force: true }); } catch { /* preserve only unrecoverable publication state */ } }
            if (generationActive) events({ type: "allocation", resource: "generation", action: "end", browser });
            emitAfterWatchRearm({ type: "build", sequence: ++sequence, status: "failed", error: buildError.message });
        }
    });
    return done;
}

export { buildAll };
