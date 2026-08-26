/**
 * @file Command-line entry point for development and release artifact builds.
 */

import { runBuildCommand, UsageError } from "./build/pipeline.ts";

const mode = process.argv[2] ?? "";
const argv = process.argv.slice(3);
const workspaceRoot = process.cwd();

try {
    await runBuildCommand({ workspaceRoot, mode, argv, events: (event: Record<string, unknown>) => {
        if (process.env.NO_MORE_AGO_BUILD_EVENTS !== "1") {
            process.stdout.write(`${JSON.stringify(event)}\n`);
        }
    } });
} catch (error) {
    if (error instanceof UsageError) {
        console.error(error.message); process.exitCode = 2;
    } else {
        console.error(error instanceof Error ? error.message : error); process.exitCode = 1;
    }
}
