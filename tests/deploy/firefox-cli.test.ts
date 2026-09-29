// @vitest-environment node

/**
 * @file Verify Firefox preflight and status orchestration with simulated AMO responses.
 */

import { createHash } from 'node:crypto';
import {
    appendFileSync,
    mkdirSync,
    readFileSync,
    writeFileSync,
} from 'node:fs';
import path from 'node:path';

import AdmZip from 'adm-zip';
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';

import { GECKO_ID, STORE_UPLOAD_DIRECTORY } from '../../scripts/deploy/constants';
import { AMO_STATUS } from '../../scripts/deploy/firefox';
import { AMO_OPERATION, run } from '../../scripts/deploy/firefox-cli';

vi.mock('node:fs', async (original) => ({
    ...await original<Record<string, unknown>>(),
    appendFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
}));
const env = {
    FIREFOX_CLIENT_ID: 'fixture-issuer',
    FIREFOX_CLIENT_SECRET: 'fixture-secret',
    FIREFOX_AMO_ID: 'fixture',
    VERSION: '1.2.3',
    GITHUB_OUTPUT: 'fixture-output',
    GITHUB_STEP_SUMMARY: 'fixture-summary',
};
const addon = {
    guid: GECKO_ID,
    slug: 'fixture',
    status: AMO_STATUS.Unreviewed,
    categories: ['appearance'],
};
const pending = {
    id: 123,
    version: '1.2.3',
    channel: 'listed',
    source: 'https://example.test/source.zip',
    file: { status: AMO_STATUS.Unreviewed },
};
const SIGNED_URL = 'https://addons.mozilla.org/firefox/downloads/file/1/fixture-1.2.3.xpi';
const zip = new AdmZip();
zip.addFile('manifest.json', Buffer.from(JSON.stringify({
    manifest_version: 3,
    version: '1.2.3',
    browser_specific_settings: { gecko: { id: GECKO_ID } },
    background: { scripts: ['background.js'] },
})));
zip.addFile('META-INF/mozilla.rsa', Buffer.from('synthetic signature envelope'));
const signedXpi = zip.toBuffer();
const signedDigest = createHash('sha256').update(signedXpi).digest('hex');
const approved = (url: string | undefined, hash: string | undefined): object => {
    return {
        ...pending,
        file: { status: AMO_STATUS.Public, url, hash },
    };
};
const request = vi.fn<typeof fetch>();
const json = (value: unknown): Response => {
    return new Response(JSON.stringify(value));
};

beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal('fetch', request);
    vi.mocked(readFileSync).mockReturnValue('Reproduce with pnpm install; pnpm release firefox');
    request.mockResolvedValueOnce(json(addon));
});
afterEach(() => {
    vi.unstubAllGlobals();
});

describe('Firefox deployment orchestration', () => {
    it.each(['', 'prefligth'])(
        'rejects invalid operation %j before contacting AMO',
        async (operation) => {
            await expect(run({ ...env, AMO_OPERATION: operation })).rejects
                .toThrow('Invalid AMO_OPERATION');
            expect(request).not.toHaveBeenCalled();
            expect(appendFileSync).not.toHaveBeenCalled();
            expect(writeFileSync).not.toHaveBeenCalled();
        },
    );
    it('permits one new version only when source reviewer notes are ready', async () => {
        request.mockResolvedValueOnce(new Response(null, { status: 404 }));
        await run({ ...env, AMO_OPERATION: AMO_OPERATION.Preflight });
        expect(appendFileSync).toHaveBeenCalledWith('fixture-output', 'submit=true\n');
        expect(request).toHaveBeenCalledTimes(2);
    });
    it('refuses new submission without reviewer notes', async () => {
        request.mockResolvedValueOnce(new Response(null, { status: 404 }));
        vi.mocked(readFileSync).mockReturnValue('');
        await expect(run({ ...env, AMO_OPERATION: AMO_OPERATION.Preflight })).rejects
            .toThrow('AMO_REVIEW.md');
        expect(appendFileSync).not.toHaveBeenCalled();
    });
    it('skips an existing historical version without requiring new source notes', async () => {
        request.mockResolvedValueOnce(json(pending));
        await run({ ...env, AMO_OPERATION: AMO_OPERATION.Preflight });
        expect(readFileSync).not.toHaveBeenCalled();
        expect(appendFileSync).toHaveBeenCalledWith('fixture-output', 'submit=false\n');
    });
    it.each([undefined, AMO_OPERATION.Status])(
        'reports pending review in status mode %j',
        async (operation) => {
            request.mockResolvedValueOnce(json(pending));
            await run({ ...env, AMO_OPERATION: operation });
            expect(request).toHaveBeenCalledTimes(2);
            expect(writeFileSync).not.toHaveBeenCalled();
            expect(appendFileSync).toHaveBeenCalledWith(
                'fixture-summary',
                expect.stringContaining('awaiting Mozilla'),
            );
        },
    );
    it('never treats a status outage as permission to upload', async () => {
        request.mockResolvedValueOnce(new Response(null, { status: 503 }));
        await expect(run({ ...env, AMO_OPERATION: AMO_OPERATION.Preflight })).rejects
            .toThrow('HTTP 503');
        expect(appendFileSync).not.toHaveBeenCalled();
    });
    it('rejects an unexpected listing identity before looking up versions', async () => {
        request.mockReset().mockResolvedValueOnce(json({ ...addon, guid: 'wrong@test' }));
        await expect(run({ ...env, AMO_OPERATION: AMO_OPERATION.Preflight })).rejects
            .toThrow('Gecko ID mismatch');
        expect(request).toHaveBeenCalledTimes(1);
    });
    describe('approved version download', () => {
        it('saves the signed XPI with its checksum and reports signed=true', async () => {
            request
                .mockResolvedValueOnce(json(approved(SIGNED_URL, `sha256:${signedDigest}`)))
                .mockResolvedValueOnce(new Response(new Uint8Array(signedXpi)));
            await run({ ...env, AMO_OPERATION: AMO_OPERATION.Status });
            const directory = path.join(STORE_UPLOAD_DIRECTORY, 'signed');
            expect(mkdirSync).toHaveBeenCalledWith(directory, { recursive: true });
            expect(writeFileSync).toHaveBeenCalledWith(
                path.join(directory, 'firefox-1.2.3.xpi'),
                signedXpi,
            );
            expect(writeFileSync).toHaveBeenCalledWith(
                path.join(directory, 'SHA256SUMS.txt'),
                `${signedDigest}  firefox-1.2.3.xpi\n`,
            );
            expect(appendFileSync).toHaveBeenCalledWith('fixture-output', 'signed=true\n');
            expect(request.mock.calls[2]?.[1]).not.toHaveProperty('headers');
        });
        it.each([
            ['a lookalike hostname', 'https://addons.mozilla.org.evil.test/file.xpi'],
            ['a subdomain CDN', 'https://cdn.addons.mozilla.org/file.xpi'],
            ['plain http', 'http://addons.mozilla.org/file.xpi'],
        ])('refuses to download from %s', async (_name, url) => {
            request.mockResolvedValueOnce(json(approved(url, `sha256:${signedDigest}`)));
            await expect(run({ ...env, AMO_OPERATION: AMO_OPERATION.Status })).rejects
                .toThrow('Unexpected AMO download URL');
            expect(request).toHaveBeenCalledTimes(2);
            expect(writeFileSync).not.toHaveBeenCalled();
            expect(appendFileSync).not.toHaveBeenCalledWith('fixture-output', 'signed=true\n');
        });
        it.each([
            ['url', approved(undefined, `sha256:${signedDigest}`)],
            ['hash', approved(SIGNED_URL, undefined)],
        ])('waits when the approved version has no %s yet', async (_name, version) => {
            request.mockResolvedValueOnce(json(version));
            await expect(run({ ...env, AMO_OPERATION: AMO_OPERATION.Status })).rejects
                .toThrow('no downloadable signed artifact');
            expect(writeFileSync).not.toHaveBeenCalled();
        });
        it('rejects bytes that do not match the AMO hash and saves nothing', async () => {
            request
                .mockResolvedValueOnce(json(approved(SIGNED_URL, `sha256:${'0'.repeat(64)}`)))
                .mockResolvedValueOnce(new Response(new Uint8Array(signedXpi)));
            await expect(run({ ...env, AMO_OPERATION: AMO_OPERATION.Status })).rejects
                .toThrow('hash does not match');
            expect(writeFileSync).not.toHaveBeenCalled();
            expect(appendFileSync).not.toHaveBeenCalledWith('fixture-output', 'signed=true\n');
        });
        it('fails and saves nothing when the download errors', async () => {
            request
                .mockResolvedValueOnce(json(approved(SIGNED_URL, `sha256:${signedDigest}`)))
                .mockResolvedValueOnce(new Response(null, { status: 502 }));
            await expect(run({ ...env, AMO_OPERATION: AMO_OPERATION.Status })).rejects
                .toThrow('HTTP 502');
            expect(writeFileSync).not.toHaveBeenCalled();
        });
        it('does not download a disabled approved version', async () => {
            request.mockResolvedValueOnce(json({
                ...approved(SIGNED_URL, `sha256:${signedDigest}`),
                is_disabled: true,
            }));
            await run({ ...env, AMO_OPERATION: AMO_OPERATION.Status });
            expect(request).toHaveBeenCalledTimes(2);
            expect(writeFileSync).not.toHaveBeenCalled();
        });
    });
});
