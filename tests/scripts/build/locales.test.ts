/**
 * @file Verifies the locale catalogs and localized manifest in built artifacts.
 */

import { execFile } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { CHROMIUM_LOCALE_ALIAS, UI_LOCALES } from "../../../src/shared/i18n/locales";
import { createBuildWorkspace } from "./build-workspace";

const execFileAsync = promisify(execFile);
const PNPM_COMMAND = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

describe("locale artifacts", () => {
    it("ships every catalog, the Chromium alias, and a localized manifest", async () => {
        const workspace = createBuildWorkspace();
        try {
            await execFileAsync(PNPM_COMMAND, ["dev"], { cwd: workspace.root, timeout: 300_000 });
            const codes = UI_LOCALES.map(({ code }) => code).sort();
            const aliases = Object.entries(CHROMIUM_LOCALE_ALIAS);

            for (const browser of ["chrome", "edge"]) {
                const root = `${workspace.root}/dist/dev/${browser}/_locales`;
                expect(readdirSync(root).sort())
                    .toEqual([...codes, ...aliases.map(([alias]) => alias)].sort());
                for (const [alias, source] of aliases) {
                    expect(readFileSync(`${root}/${alias}/messages.json`))
                        .toEqual(readFileSync(`${root}/${source}/messages.json`));
                }
            }

            const firefoxRoot = `${workspace.root}/dist/dev/firefox/_locales`;
            expect(readdirSync(firefoxRoot).sort()).toEqual(codes);
            for (const [alias] of aliases) {
                expect(existsSync(`${firefoxRoot}/${alias}`)).toBe(false);
            }

            for (const browser of ["chrome", "firefox", "edge"]) {
                const manifest = JSON.parse(readFileSync(
                    `${workspace.root}/dist/dev/${browser}/manifest.json`,
                    "utf8",
                )) as Record<string, string>;
                expect(manifest.default_locale).toBe("en");
                expect(manifest.name).toBe("__MSG_extension_name__");
                expect(manifest.description).toBe("__MSG_extension_description__");
            }
        } finally {
            workspace.cleanup();
        }
    }, 300_000);
});
