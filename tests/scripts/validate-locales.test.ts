/**
 * @file Verifies that catalog validation rejects each defect class.
 */

import { execFile } from "node:child_process";
import {
    cpSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    symlinkSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const PNPM_COMMAND = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
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
    const root = mkdtempSync(path.join(tmpdir(), "no-more-ago-locales-"));
    created.push(root);
    cpSync(path.join(process.cwd(), "package.json"), path.join(root, "package.json"));
    mkdirSync(path.join(root, "src/shared/i18n"), { recursive: true });
    cpSync(
        path.join(process.cwd(), "src/shared/i18n/locales.ts"),
        path.join(root, "src/shared/i18n/locales.ts"),
    );
    cpSync(path.join(process.cwd(), "src/_locales"), path.join(root, "src/_locales"), {
        recursive: true,
    });
    mkdirSync(path.join(root, "scripts"), { recursive: true });
    cpSync(
        path.join(process.cwd(), "scripts/validate-locales.ts"),
        path.join(root, "scripts/validate-locales.ts"),
    );
    symlinkSync(path.join(process.cwd(), "node_modules"), path.join(root, "node_modules"));
    return root;
}

/**
 * Rewrites one catalog inside a scratch project.
 *
 * @param root - Scratch project root.
 * @param code - Locale directory code.
 * @param mutate - Transforms the parsed catalog in place.
 */
function editCatalog(
    root: string,
    code: string,
    mutate: (catalog: Record<string, CatalogEntry>) => void,
): void {
    const file = path.join(root, "src/_locales", code, "messages.json");
    const catalog = JSON.parse(readFileSync(file, "utf8")) as Record<string, CatalogEntry>;
    mutate(catalog);
    writeFileSync(file, `${JSON.stringify(catalog, null, 2)}\n`);
}

/**
 * Runs the validator and returns its combined output and exit status.
 *
 * @param root - Scratch project root.
 * @returns - Whether validation passed, plus everything it printed.
 */
async function validate(root: string): Promise<{ ok: boolean; output: string }> {
    try {
        const result = await execFileAsync(PNPM_COMMAND, ["locales:validate"], { cwd: root });
        return { ok: true, output: result.stdout + result.stderr };
    } catch (error) {
        const failure = error as { stdout?: string; stderr?: string };
        return { ok: false, output: `${failure.stdout ?? ""}${failure.stderr ?? ""}` };
    }
}

afterEach(() => {
    for (const root of created.splice(0)) {
        rmSync(root, { recursive: true, force: true });
    }
});

describe("locale validation", () => {
    it("passes on the committed catalogs", async () => {
        expect((await validate(scratchProject())).ok).toBe(true);
    }, 60_000);

    it("rejects a missing key", async () => {
        const root = scratchProject();
        editCatalog(root, "th", (catalog) => {
            delete catalog.popup_status_active;
        });
        const result = await validate(root);
        expect(result.ok).toBe(false);
        expect(result.output).toContain("th: missing key popup_status_active");
    }, 60_000);

    it("rejects an extra key", async () => {
        const root = scratchProject();
        editCatalog(root, "th", (catalog) => {
            catalog.invented_key = { message: "x", description: "x" };
        });
        const result = await validate(root);
        expect(result.ok).toBe(false);
        expect(result.output).toContain("invented_key");
    }, 60_000);

    it("rejects a dropped placeholder", async () => {
        const root = scratchProject();
        editCatalog(root, "ko", (catalog) => {
            (catalog.popup_site_switch_aria as CatalogEntry).message = "사이트에서 사용";
        });
        const result = await validate(root);
        expect(result.ok).toBe(false);
        expect(result.output).toContain("ko: popup_site_switch_aria");
    }, 60_000);

    it("rejects a wrong plural form count", async () => {
        const root = scratchProject();
        editCatalog(root, "ru", (catalog) => {
            (catalog.sites_count as CatalogEntry).message = "%count% сайт|%count% сайта";
        });
        const result = await validate(root);
        expect(result.ok).toBe(false);
        expect(result.output).toContain("ru: sites_count");
    }, 60_000);

    it("rejects an over-long extension description", async () => {
        const root = scratchProject();
        editCatalog(root, "de", (catalog) => {
            (catalog.extension_description as CatalogEntry).message = "x".repeat(133);
        });
        const result = await validate(root);
        expect(result.ok).toBe(false);
        expect(result.output).toContain("133");
    }, 60_000);

    it("rejects a translated product name", async () => {
        const root = scratchProject();
        editCatalog(root, "fr", (catalog) => {
            (catalog.extension_name as CatalogEntry).message = "Plus Jamais Il Y A";
        });
        const result = await validate(root);
        expect(result.ok).toBe(false);
        expect(result.output).toContain("extension_name");
    }, 60_000);

    it("rejects a catalog directory outside the registry", async () => {
        const root = scratchProject();
        cpSync(
            path.join(root, "src/_locales/en"),
            path.join(root, "src/_locales/lv"),
            { recursive: true },
        );
        const result = await validate(root);
        expect(result.ok).toBe(false);
        expect(result.output).toContain("lv");
    }, 60_000);

    it("rejects a changed translator note", async () => {
        const root = scratchProject();
        editCatalog(root, "ja", (catalog) => {
            (catalog.popup_status_active as CatalogEntry).description = "翻訳者向けメモ";
        });
        const result = await validate(root);
        expect(result.ok).toBe(false);
        expect(result.output).toContain("ja: popup_status_active description");
    }, 60_000);
});
