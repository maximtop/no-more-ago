/**
 * @file Verifies observable rebuild behavior of the public watch command.
 */

import { appendFileSync, readFileSync } from 'node:fs';

import { strFromU8, unzipSync } from 'fflate';
import {
    describe, expect, it, vi,
} from 'vitest';

import { createBuildWorkspace, startChromeWatch } from './build-workspace';

describe('development watch command', () => {
    it('updates the unpacked extension and ZIP after a source change', async () => {
        const workspace = createBuildWorkspace();
        const running = startChromeWatch(workspace.root);
        let pid: number | undefined;
        try {
            const ready = await running.waitFor((event) => event.type === 'ready');
            pid = ready.pid;
            const initial = await running.waitFor(
                (event) => event.type === 'build' && event.status === 'success',
            );
            const sequence = initial.sequence ?? 0;
            const marker = '__noMoreAgoWatchMarker';
            appendFileSync(
                `${workspace.root}/src/content-script/main.ts`,
                `\nglobalThis.${marker} = true;\n`,
            );
            await running.waitFor(
                (event) => event.type === 'build'
                    && event.status === 'success'
                    && (event.sequence ?? 0) > sequence,
            );
            await vi.waitFor(() => {
                expect(
                    readFileSync(`${workspace.root}/dist/dev/chrome/content.js`, 'utf8'),
                ).toContain(marker);
                const zip = unzipSync(readFileSync(`${workspace.root}/dist/dev/chrome.zip`));
                const content = zip['content.js'];
                expect(content && strFromU8(content)).toContain(marker);
            }, { timeout: 30_000, interval: 25 });
        } finally {
            await running.stop(pid);
            workspace.cleanup();
        }
    }, 90_000);
});
