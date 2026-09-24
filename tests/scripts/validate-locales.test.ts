/**
 * @file Verifies that catalog validation rejects each defect class.
 */

import { execFile } from 'node:child_process';
import {
    cpSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    symlinkSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import {
    afterEach, describe, expect, it,
} from 'vitest';

const execFileAsync = promisify(execFile);
const PNPM_COMMAND = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const created: string[] = [];

/**
 * One entry as stored in a WebExtension message catalog.
 */
interface CatalogEntry {
    /**
     * Translated text.
     */
    message: string;

    /**
     * English translator note.
     */
    description: string;
}

/**
 * Copies only the validator's inputs into a scratch project.
 *
 * @returns - Absolute path to the scratch project root.
 */
function scratchProject(): string {
    const root = mkdtempSync(path.join(tmpdir(), 'no-more-ago-locales-'));
    created.push(root);
    cpSync(path.join(process.cwd(), 'package.json'), path.join(root, 'package.json'));
    mkdirSync(path.join(root, 'src/shared/i18n'), { recursive: true });
    cpSync(
        path.join(process.cwd(), 'src/shared/i18n/locales.ts'),
        path.join(root, 'src/shared/i18n/locales.ts'),
    );
    cpSync(path.join(process.cwd(), 'src/_locales'), path.join(root, 'src/_locales'), {
        recursive: true,
    });
    mkdirSync(path.join(root, 'scripts'), { recursive: true });
    cpSync(
        path.join(process.cwd(), 'scripts/validate-locales.ts'),
        path.join(root, 'scripts/validate-locales.ts'),
    );
    symlinkSync(path.join(process.cwd(), 'node_modules'), path.join(root, 'node_modules'));
    return root;
}

/**
 * Message catalog keyed by message name.
 */
type Catalog = Record<string, CatalogEntry>;

/**
 * Copies a catalog with some fields of one entry replaced.
 *
 * @param catalog - Catalog to copy.
 * @param key - Message name of the entry to change.
 * @param patch - Fields that replace the entry's current values.
 *
 * @returns - The edited copy.
 */
function withEntry(catalog: Catalog, key: string, patch: Partial<CatalogEntry>): Catalog {
    return { ...catalog, [key]: { ...catalog[key], ...patch } as CatalogEntry };
}

/**
 * Rewrites one catalog inside a scratch project.
 *
 * @param root - Scratch project root.
 * @param code - Locale directory code.
 * @param transform - Returns the catalog to store, given the parsed one.
 */
function editCatalog(
    root: string,
    code: string,
    transform: (catalog: Catalog) => Catalog,
): void {
    const file = path.join(root, 'src/_locales', code, 'messages.json');
    const catalog = JSON.parse(readFileSync(file, 'utf8')) as Catalog;
    writeFileSync(file, `${JSON.stringify(transform(catalog), null, 2)}\n`);
}

/**
 * Runs the validator and returns its combined output and exit status.
 *
 * @param root - Scratch project root.
 *
 * @returns - Whether validation passed, plus everything it printed.
 */
async function validate(root: string): Promise<{ ok: boolean; output: string }> {
    try {
        const result = await execFileAsync(PNPM_COMMAND, ['locales:validate'], { cwd: root });
        return { ok: true, output: result.stdout + result.stderr };
    } catch (error) {
        const failure = error as { stdout?: string; stderr?: string };
        return { ok: false, output: `${failure.stdout ?? ''}${failure.stderr ?? ''}` };
    }
}

afterEach(() => {
    for (const root of created.splice(0)) {
        rmSync(root, { recursive: true, force: true });
    }
});

describe('locale validation', () => {
    it('rejects a catalog that identifies a different language', async () => {
        const root = scratchProject();
        editCatalog(root, 'ru', (catalog) => withEntry(catalog, 'catalog_locale', { message: 'en' }));
        const result = await validate(root);
        expect(result.ok).toBe(false);
        expect(result.output).toContain('ru: catalog_locale');
    }, 60_000);

    it('passes on the committed catalogs', async () => {
        expect((await validate(scratchProject())).ok).toBe(true);
    }, 60_000);

    it('rejects a missing key', async () => {
        const root = scratchProject();
        editCatalog(root, 'th', ({ popup_status_active: removed, ...catalog }) => catalog);
        const result = await validate(root);
        expect(result.ok).toBe(false);
        expect(result.output).toContain('th: missing key popup_status_active');
    }, 60_000);

    it('rejects an extra key', async () => {
        const root = scratchProject();
        editCatalog(root, 'th', (catalog) => ({
            ...catalog,
            invented_key: { message: 'x', description: 'x' },
        }));
        const result = await validate(root);
        expect(result.ok).toBe(false);
        expect(result.output).toContain('invented_key');
    }, 60_000);

    it('rejects a dropped placeholder', async () => {
        const root = scratchProject();
        editCatalog(root, 'ko', (catalog) => withEntry(catalog, 'popup_site_switch_aria', {
            message: '사이트에서 사용',
        }));
        const result = await validate(root);
        expect(result.ok).toBe(false);
        expect(result.output).toContain('ko: popup_site_switch_aria');
    }, 60_000);

    it('rejects a wrong plural form count', async () => {
        const root = scratchProject();
        editCatalog(root, 'ru', (catalog) => withEntry(catalog, 'sites_count', {
            message: '%count% сайт|%count% сайта',
        }));
        const result = await validate(root);
        expect(result.ok).toBe(false);
        expect(result.output).toContain('ru: sites_count');
    }, 60_000);

    it('rejects an over-long extension description', async () => {
        const root = scratchProject();
        editCatalog(root, 'de', (catalog) => withEntry(catalog, 'extension_description', {
            message: 'x'.repeat(133),
        }));
        const result = await validate(root);
        expect(result.ok).toBe(false);
        expect(result.output).toContain('133');
    }, 60_000);

    it('rejects a translated product name', async () => {
        const root = scratchProject();
        editCatalog(root, 'fr', (catalog) => withEntry(catalog, 'extension_name', {
            message: 'Plus Jamais Il Y A',
        }));
        const result = await validate(root);
        expect(result.ok).toBe(false);
        expect(result.output).toContain('extension_name');
    }, 60_000);

    it('rejects a catalog directory outside the registry', async () => {
        const root = scratchProject();
        cpSync(
            path.join(root, 'src/_locales/en'),
            path.join(root, 'src/_locales/lv'),
            { recursive: true },
        );
        const result = await validate(root);
        expect(result.ok).toBe(false);
        expect(result.output).toContain('lv');
    }, 60_000);

    it('rejects a changed translator note', async () => {
        const root = scratchProject();
        editCatalog(root, 'ja', (catalog) => withEntry(catalog, 'popup_status_active', {
            description: '翻訳者向けメモ',
        }));
        const result = await validate(root);
        expect(result.ok).toBe(false);
        expect(result.output).toContain('ja: popup_status_active description');
    }, 60_000);
});
