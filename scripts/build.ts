/**
 * @file Command-line entry point for development and release artifact builds.
 */

import { parseBuildCli, UsageError } from "./build/cli.ts";
import { runBuildCommand } from "./build/pipeline.ts";

try {
    const request = parseBuildCli(process.argv);
    if (request !== null) {
        await runBuildCommand({
            request,
            events: (event: Record<string, unknown>) => {
                if (process.env.NO_MORE_AGO_BUILD_EVENTS !== "1") {
                    process.stdout.write(`${JSON.stringify(event)}\n`);
                }
            },
        });
    }
} catch (error) {
    if (error instanceof UsageError) {
        console.error(error.message);
        process.exitCode = 2;
    } else {
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 1;
    }
}
