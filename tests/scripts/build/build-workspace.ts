/**
 * @file Provides a temporary project copy for public build-command tests.
 */

import { spawn } from "node:child_process";
import { cpSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Temporary build workspace with ownership-bound cleanup.
 */
export interface BuildWorkspace {
    /**
     * Absolute project-copy path.
     */
    readonly root: string;

    /**
     * Removes this exact temporary project copy.
     */
    cleanup(): void;
}

/**
 * Progress event emitted by the watch command.
 */
export interface BuildEvent {
    /**
     * Event kind.
     */
    readonly type?: string;

    /**
     * Build outcome.
     */
    readonly status?: string;

    /**
     * Monotonic build number.
     */
    readonly sequence?: number;

    /**
     * Build-process identifier.
     */
    readonly pid?: number;
}

/**
 * Running watch command observed through its public event stream.
 */
export interface RunningWatch {
    /**
     * Waits for one matching event.
     *
     * @param predicate - Event selection predicate.
     * @returns - First matching event.
     */
    waitFor(predicate: (event: BuildEvent) => boolean): Promise<BuildEvent>;

    /**
     * Stops the build process.
     *
     * @param pid - Build-process identifier from the ready event.
     * @returns - Promise settled after process shutdown.
     */
    stop(pid?: number): Promise<void>;
}

const PNPM_COMMAND = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

/**
 * Copies build inputs and links the installed dependency tree.
 *
 * @returns - Temporary build workspace.
 */
export function createBuildWorkspace(): BuildWorkspace {
    const root = mkdtempSync(path.join(tmpdir(), "no-more-ago-build-"));
    for (const name of [
        "package.json",
        "pnpm-lock.yaml",
        "rspack.config.ts",
        "Makefile",
    ]) {
        cpSync(path.join(process.cwd(), name), path.join(root, name));
    }
    cpSync(path.join(process.cwd(), "src"), path.join(root, "src"), { recursive: true });
    cpSync(path.join(process.cwd(), "scripts"), path.join(root, "scripts"), {
        recursive: true,
    });
    symlinkSync(path.join(process.cwd(), "node_modules"), path.join(root, "node_modules"));
    return {
        root,
        cleanup: () => {
            rmSync(root, { recursive: true, force: true });
        },
    };
}

/**
 * Starts the public Chrome development watcher.
 *
 * @param workspace - Temporary build workspace.
 * @returns - Observable watch-process handle.
 */
export function startChromeWatch(workspace: string): RunningWatch {
    const child = spawn(PNPM_COMMAND, ["dev", "chrome", "--watch"], {
        cwd: workspace,
        stdio: ["ignore", "pipe", "pipe"],
    });
    const events: BuildEvent[] = [];
    let pendingOutput = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
        pendingOutput += chunk.toString("utf8");
        const lines = pendingOutput.split("\n");
        pendingOutput = lines.pop() ?? "";
        for (const line of lines) {
            try {
                events.push(JSON.parse(line) as BuildEvent);
            } catch {
                /* pnpm status output is not a build event */
            }
        }
    });
    child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
    });
    const exited = new Promise<void>((resolve) => {
        child.once("exit", () => {
            resolve();
        });
    });
    return {
        waitFor: (predicate) => new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                clearInterval(poll);
                reject(new Error(`Timed out waiting for build event. ${stderr}`));
            }, 30_000);
            const poll = setInterval(() => {
                const event = events.find(predicate);
                if (event) {
                    clearTimeout(timeout);
                    clearInterval(poll);
                    resolve(event);
                } else if (child.exitCode !== null) {
                    clearTimeout(timeout);
                    clearInterval(poll);
                    reject(new Error(`Build exited before the expected event. ${stderr}`));
                }
            }, 25);
        }),
        stop: async (pid) => {
            if (pid !== undefined) {
                try {
                    process.kill(pid, "SIGTERM");
                } catch {
                    /* process already stopped */
                }
            } else {
                child.kill("SIGTERM");
            }
            await Promise.race([
                exited,
                new Promise<void>((resolve) => {
                    setTimeout(resolve, 5_000);
                }),
            ]);
            if (child.exitCode === null) {
                child.kill("SIGKILL");
                await exited;
            }
        },
    };
}
