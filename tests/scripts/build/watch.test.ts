/**
 * @file Verifies observable rebuild behavior of the public watch command.
 */

import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';

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

    it('reports a failed build, keeps the last good artifact, and recovers after the fix', async () => {
        const workspace = createBuildWorkspace();
        const running = startChromeWatch(workspace.root);
        const entry = `${workspace.root}/src/content-script/main.ts`;
        const good = readFileSync(entry, 'utf8');
        let pid: number | undefined;
        try {
            const ready = await running.waitFor((event) => event.type === 'ready');
            pid = ready.pid;
            const initial = await running.waitFor(
                (event) => event.type === 'build' && event.status === 'success',
            );
            const goodContent = readFileSync(`${workspace.root}/dist/dev/chrome/content.js`, 'utf8');

            appendFileSync(entry, '\nconst = ;\n');
            const failed = await running.waitFor(
                (event) => event.type === 'build' && event.status === 'failed',
            );
            expect(failed.error).toContain('main.ts');
            expect(failed.sequence).toBeGreaterThan(initial.sequence ?? 0);
            expect(readFileSync(`${workspace.root}/dist/dev/chrome/content.js`, 'utf8')).toBe(goodContent);

            const marker = '__noMoreAgoRecoveryMarker';
            writeFileSync(entry, `${good}\nglobalThis.${marker} = true;\n`);
            const recovered = await running.waitFor(
                (event) => event.type === 'build'
                    && event.status === 'success'
                    && (event.sequence ?? 0) > (failed.sequence ?? 0),
            );
            expect(recovered.status).toBe('success');
            await vi.waitFor(() => {
                expect(
                    readFileSync(`${workspace.root}/dist/dev/chrome/content.js`, 'utf8'),
                ).toContain(marker);
            }, { timeout: 30_000, interval: 25 });
        } finally {
            await running.stop(pid);
            workspace.cleanup();
        }
    }, 90_000);
});
