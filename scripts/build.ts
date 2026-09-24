/**
 * @file Command-line entry point for development and release artifact builds.
 */

import { parseBuildCli } from './build/cli.ts';
import { BUILD_EXIT_CODE } from './build/contracts.ts';
import { runBuildCommand } from './build/pipeline.ts';

try {
    const request = parseBuildCli();
    await runBuildCommand({
        request,
        events: (event: Record<string, unknown>) => {
            if (process.env.NO_MORE_AGO_BUILD_EVENTS !== '1') {
                process.stdout.write(`${JSON.stringify(event)}\n`);
            }
        },
    });
} catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = BUILD_EXIT_CODE.FAILURE;
}
