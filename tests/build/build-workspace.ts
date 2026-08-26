/**
 * @file Provides isolated workspace and process helpers for build tests.
 */

import {
    cpSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    readdirSync,
    rmSync,
    statSync,
    symlinkSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash } from "node:crypto";

/**
 * Structured progress event emitted by a build subprocess.
 */
export type BuildEvent = Record<string, unknown> & {
    type?: string;
    status?: string;
    sequence?: number;
    pid?: number;
};

/**
 * Copies the project into an isolated temporary workspace linked to installed dependencies.
 *
 * @param sourceRoot - Project root whose build inputs are copied.
 * @returns - Absolute path to the isolated workspace.
 */
export function makeWorkspace(sourceRoot = process.cwd()): string {
    const workspace = mkdtempSync(path.join(tmpdir(), "no-more-ago-build-"));
    for (const name of [
        "package.json",
        "pnpm-lock.yaml",
        "rspack.config.ts",
        "Makefile",
        "tsconfig.json",
        "vitest.config.ts",
        "eslint.config.ts",
    ]) {
        cpSync(path.join(sourceRoot, name), path.join(workspace, name));
    }
    cpSync(path.join(sourceRoot, "src"), path.join(workspace, "src"), { recursive: true });
    cpSync(path.join(sourceRoot, "scripts"), path.join(workspace, "scripts"), { recursive: true });
    mkdirSync(path.join(workspace, "tests/build"), { recursive: true });
    cpSync(
        path.join(sourceRoot, "tests/build/fixtures"),
        path.join(workspace, "tests/build/fixtures"),
        { recursive: true },
    );
    const modules = path.join(workspace, "node_modules");
    // Tests use the already-installed dependency tree and never invoke a package-manager install.
    symlinkSync(path.join(sourceRoot, "node_modules"), modules, "junction");
    return workspace;
}

/**
 * Removes a temporary build workspace after verifying its guarded name.
 *
 * @param workspace - Temporary workspace created by makeWorkspace.
 */
export function removeWorkspace(workspace: string): void {
    if (workspace.includes("no-more-ago-build-")) {
        rmSync(workspace, { recursive: true, force: true });
    }
}

/**
 * Calculates a stable SHA-256 digest for a file or directory tree.
 *
 * @param file - File or directory whose contents are hashed.
 * @returns - Hexadecimal SHA-256 digest.
 */
export function hashPath(file: string): string {
    const hash = createHash("sha256");
    const visit = (current: string): void => {
        const stat = statSync(current);
        if (stat.isDirectory()) {
            for (const name of readdirSync(current).sort()) {
                hash.update(name);
                visit(path.join(current, name));
            }
        } else {
            hash.update(readFileSync(current));
        }
    };
    visit(file);
    return hash.digest("hex");
}

/**
 * Lists regular artifact files beneath a build output root.
 *
 * @param root - Artifact directory to traverse.
 * @returns - Sorted portable paths relative to the root.
 */
export function artifactBytes(root: string): string[] {
    const names: string[] = [];
    const visit = (current: string): void => {
        for (const name of readdirSync(current).sort()) {
            const file = path.join(current, name);
            if (statSync(file).isDirectory()) {
                visit(file);
            } else {
                names.push(path.relative(root, file).split(path.sep).join("/"));
            }
        }
    };
    visit(root);
    return names;
}

/**
 * Handle for observing and stopping a spawned build process.
 */
export interface RunningBuild {
    /**
     * Spawned package-manager process.
     */
    child: ReturnType<typeof spawn>;

    /**
     * Parsed build progress events received from standard output.
     */
    events: BuildEvent[];

    /**
     * Waits until a parsed build event satisfies a caller predicate.
     */
    waitFor(predicate: (event: BuildEvent) => boolean, timeoutMs?: number): Promise<BuildEvent>;

    /**
     * Terminates the build and waits for its process resources to close.
     */
    stop(readyPid?: number, timeoutMs?: number): Promise<void>;
}

/**
 * Terminates a build process tree within bounded waits and closes captured streams.
 *
 * @param child - Spawned package-manager wrapper process.
 * @param exited - Promise settled when the wrapper exits.
 * @param stdoutClosed - Promise settled when standard output closes.
 * @param stderrClosed - Promise settled when standard error closes.
 * @param readyPid - Build process identifier reported by the fixture.
 * @param timeoutMs - Maximum duration of each shutdown phase.
 */
async function boundedStop(
    child: ReturnType<typeof spawn>,
    exited: Promise<void>,
    stdoutClosed: Promise<void>,
    stderrClosed: Promise<void>,
    readyPid: number | undefined,
    timeoutMs: number,
): Promise<void> {
    const signalPid = readyPid ?? child.pid;
    if (signalPid !== undefined) {
        try {
            process.kill(signalPid, "SIGTERM");
        } catch (error) {
            if (!(error instanceof Error) || !("code" in error) || error.code !== "ESRCH") {
                throw error;
            }
        }
    }
    await Promise.race([exited, new Promise<void>((resolve) => setTimeout(resolve, timeoutMs))]);
    const wrapperPid = child.pid;
    if (child.exitCode === null && process.platform !== "win32" && wrapperPid !== undefined) {
        try {
            process.kill(-wrapperPid, "SIGKILL");
        } catch {
            /* already exited */
        }
    }
    if (child.exitCode === null) {
        child.kill("SIGKILL");
    }
    await Promise.race([exited, new Promise<void>((resolve) => setTimeout(resolve, timeoutMs))]);
    if (signalPid !== undefined) {
        await waitForPidGone(signalPid, timeoutMs);
    }
    if (wrapperPid !== undefined) {
        await waitForPidGone(wrapperPid, timeoutMs);
    }
    if (child.stdout) {
        child.stdout.destroy();
    }
    if (child.stderr) {
        child.stderr.destroy();
    }
    await Promise.race([
        Promise.all([stdoutClosed, stderrClosed]),
        new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
    ]);
}

/**
 * Starts a build command and exposes its parsed event stream.
 *
 * @param workspace - Isolated workspace used as the process directory.
 * @param args - Package-manager arguments for the build command.
 * @param environment - Environment variables supplied to the process.
 * @returns - Running build handle.
 */
export function startBuild(
    workspace: string,
    args: string[],
    environment: NodeJS.ProcessEnv = process.env,
): RunningBuild {
    const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
    const child = spawn(command, args, {
        cwd: workspace,
        env: environment,
        stdio: ["ignore", "pipe", "pipe"],
        detached: process.platform !== "win32",
    }) as unknown as ChildProcessWithoutNullStreams;
    const stdout = child.stdout;
    const stderr = child.stderr;
    const exited = new Promise<void>((resolve) => {
        child.once("exit", () => {
            resolve();
        });
    });
    const stdoutClosed = new Promise<void>((resolve) => {
        stdout.once("close", () => {
            resolve();
        });
    });
    const stderrClosed = new Promise<void>((resolve) => {
        stderr.once("close", () => {
            resolve();
        });
    });
    const events: BuildEvent[] = [];
    let output = "";
    stdout.on("data", (chunk: Buffer) => {
        output += chunk.toString("utf8");
        const lines = output.split("\n");
        output = lines.pop() ?? "";
        for (const line of lines) {
            try {
                const event = JSON.parse(line) as BuildEvent;
                events.push(event);
            } catch {
                /* package-manager diagnostics are not events */
            }
        }
    });
    const waitFor = (
        predicate: (event: BuildEvent) => boolean,
        timeoutMs = 20_000,
    ): Promise<BuildEvent> =>
        new Promise((resolve, reject) => {
            const started = Date.now();
            const timer = setInterval(() => {
                const event = events.find(predicate);
                if (event) {
                    clearInterval(timer);
                    resolve(event);
                } else if (Date.now() - started > timeoutMs) {
                    clearInterval(timer);
                    reject(
                        new Error(`Timed out waiting for build event: ${JSON.stringify(events)}`),
                    );
                }
            }, 25);
        });
    let stopping: Promise<void> | undefined;
    const stop = (readyPid?: number, timeoutMs = 5_000): Promise<void> => {
        stopping ??= boundedStop(child, exited, stdoutClosed, stderrClosed, readyPid, timeoutMs);
        return stopping;
    };
    return { child, events, waitFor, stop };
}

/**
 * Starts the injected watch-build fixture for a selected failure phase.
 *
 * @param workspace - Isolated workspace used as the process directory.
 * @param phase - Build phase where the child fixture injects behavior.
 * @returns - Running build handle.
 */
export function startInjectedBuild(workspace: string, phase: string): RunningBuild {
    const packagePath = path.join(workspace, "package.json");
    const packageJson = JSON.parse(readFileSync(packagePath, "utf8")) as {
        scripts: Record<string, string>;
    };
    packageJson.scripts.dev =
        "node --experimental-strip-types tests/build/fixtures/injected-build-child.ts";
    writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
    const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
    const child = spawn(command, ["dev", "chrome", "--watch"], {
        cwd: workspace,
        env: { ...process.env, NO_MORE_AGO_INJECT_PHASE: phase },
        stdio: ["ignore", "pipe", "pipe"],
        detached: process.platform !== "win32",
    }) as unknown as ChildProcessWithoutNullStreams;
    const stdout = child.stdout;
    const stderr = child.stderr;
    const events: BuildEvent[] = [];
    let output = "";
    const exited = new Promise<void>((resolve) => {
        child.once("exit", () => {
            resolve();
        });
    });
    const stdoutClosed = new Promise<void>((resolve) => {
        stdout.once("close", () => {
            resolve();
        });
    });
    const stderrClosed = new Promise<void>((resolve) => {
        stderr.once("close", () => {
            resolve();
        });
    });
    stdout.on("data", (chunk: Buffer) => {
        output += chunk.toString("utf8");
        const lines = output.split("\n");
        output = lines.pop() ?? "";
        for (const line of lines) {
            try {
                events.push(JSON.parse(line) as BuildEvent);
            } catch {
                /* diagnostics */
            }
        }
    });
    const waitFor = (
        predicate: (event: BuildEvent) => boolean,
        timeoutMs = 20_000,
    ): Promise<BuildEvent> =>
        new Promise((resolve, reject) => {
            const start = Date.now();
            const timer = setInterval(() => {
                const event = events.find(predicate);
                if (event) {
                    clearInterval(timer);
                    resolve(event);
                } else if (Date.now() - start > timeoutMs) {
                    clearInterval(timer);
                    reject(
                        new Error(`Timed out waiting for fixture event: ${JSON.stringify(events)}`),
                    );
                }
            }, 25);
        });
    let stopping: Promise<void> | undefined;
    const stop = (readyPid?: number, timeoutMs = 5_000): Promise<void> => {
        stopping ??= boundedStop(child, exited, stdoutClosed, stderrClosed, readyPid, timeoutMs);
        return stopping;
    };
    return { child, events, waitFor, stop };
}

/**
 * Polls until an operating-system process no longer exists.
 *
 * @param pid - Process identifier expected to terminate.
 * @param timeoutMs - Maximum polling duration.
 */
export async function waitForPidGone(pid: number, timeoutMs = 5_000): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        try {
            process.kill(pid, 0);
        } catch {
            return;
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`PID ${String(pid)} remained alive after ${String(timeoutMs)}ms`);
}

/**
 * Checks that temporary task and candidate directories were removed.
 *
 * @param workspace - Isolated build workspace to inspect.
 * @returns - Whether the distribution tree contains no transient build residue.
 */
export function hasNoBuildResidue(workspace: string): boolean {
    const dist = path.join(workspace, "dist");
    return (
        !existsSync(dist) ||
        readdirSync(dist).every(
            (name) => !name.startsWith(".task-") && !name.startsWith(".candidate-"),
        )
    );
}
