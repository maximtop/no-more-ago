/**
 * @file Exercises the public build commands and their emitted extension artifacts.
 */

import { execFile } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { promisify } from "node:util";
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { BROWSERS } from "../../../scripts/build/contracts";
import {
    EXTENSION_ICON_BASENAME,
    EXTENSION_ICON_SIZES,
    FACEBOOK_PAYLOAD_BRIDGE_SCRIPT_FILE,
} from "../../../src/shared/extension-files";
import { createBuildWorkspace } from "./build-workspace";

const execFileAsync = promisify(execFile);
const PNPM_COMMAND = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

/**
 * Reads the pixel size recorded in a PNG header, so a stale icon export fails the build test.
 *
 * @param bytes - PNG file contents.
 * @returns - Width and height from the IHDR chunk.
 */
function pngDimensions(bytes: Buffer): { readonly width: number; readonly height: number } {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

describe("build commands", () => {
    it("shows Commander help without creating artifacts", async () => {
        const workspace = createBuildWorkspace();
        try {
            const result = await execFileAsync(PNPM_COMMAND, ["dev", "--help"], {
                cwd: workspace.root,
            });
            expect(result.stdout).toContain("Usage: pnpm dev [options] [browser]");
            expect(result.stdout).toContain("--watch");
            expect(existsSync(`${workspace.root}/dist`)).toBe(false);
        } finally {
            workspace.cleanup();
        }
    });

    it("rejects an unknown browser without creating artifacts", async () => {
        const workspace = createBuildWorkspace();
        try {
            await expect(
                execFileAsync(PNPM_COMMAND, ["dev", "safari"], { cwd: workspace.root }),
            ).rejects.toMatchObject({ code: 2 });
            expect(existsSync(`${workspace.root}/dist`)).toBe(false);
        } finally {
            workspace.cleanup();
        }
    });

    it("builds all development targets and one release target", async () => {
        const workspace = createBuildWorkspace();
        try {
            await execFileAsync(PNPM_COMMAND, ["dev"], {
                cwd: workspace.root,
                timeout: 120_000,
            });
            expect(readdirSync(`${workspace.root}/dist/dev`).sort()).toEqual(
                BROWSERS.flatMap((browser) => [browser, `${browser}.zip`]).sort(),
            );
            for (const browser of BROWSERS) {
                const directory = `${workspace.root}/dist/dev/${browser}`;
                const manifestText = readFileSync(`${directory}/manifest.json`, "utf8");
                const manifest = JSON.parse(manifestText) as Record<string, unknown>;
                const background = manifest.background as Record<string, unknown>;
                expect(manifest.manifest_version).toBe(3);
                expect(manifest.version).toBe("0.1.0");
                expect(manifest.permissions).toEqual([
                    "scripting",
                    "storage",
                    "webNavigation",
                ]);
                expect(manifest.host_permissions).toEqual(["<all_urls>"]);
                expect(background[browser === "firefox" ? "scripts" : "service_worker"])
                    .toBeDefined();
                if (browser === "firefox") {
                    expect(manifest.browser_specific_settings).toEqual({
                        gecko: { strict_min_version: "128.0" },
                    });
                    expect(manifest.minimum_chrome_version).toBeUndefined();
                } else {
                    expect(manifest.minimum_chrome_version).toBe("111");
                }
                expect(existsSync(`${directory}/background.js.map`)).toBe(true);
                expect(manifest.icons).toEqual(Object.fromEntries(
                    EXTENSION_ICON_SIZES.map((size) => [
                        String(size),
                        `icons/${EXTENSION_ICON_BASENAME}-${String(size)}.png`,
                    ]),
                ));
                for (const size of EXTENSION_ICON_SIZES) {
                    const icon = `${directory}/icons/${EXTENSION_ICON_BASENAME}-`
                        + `${String(size)}.png`;
                    expect(existsSync(icon)).toBe(true);
                    expect(pngDimensions(readFileSync(icon)))
                        .toEqual({ width: size, height: size });
                }
                expect(readdirSync(`${directory}/icons`)).toHaveLength(EXTENSION_ICON_SIZES.length);
                expect(existsSync(`${directory}/${FACEBOOK_PAYLOAD_BRIDGE_SCRIPT_FILE}`))
                    .toBe(true);
                expect(existsSync(
                    `${directory}/${FACEBOOK_PAYLOAD_BRIDGE_SCRIPT_FILE}.map`,
                )).toBe(true);
                const zip = unzipSync(readFileSync(`${workspace.root}/dist/dev/${browser}.zip`));
                const zippedManifest = zip["manifest.json"];
                expect(zippedManifest && strFromU8(zippedManifest)).toBe(manifestText);
                expect(zip[FACEBOOK_PAYLOAD_BRIDGE_SCRIPT_FILE]).toBeDefined();
                expect(zip[`${FACEBOOK_PAYLOAD_BRIDGE_SCRIPT_FILE}.map`]).toBeDefined();
            }

            await execFileAsync(PNPM_COMMAND, ["release", "chrome"], {
                cwd: workspace.root,
                timeout: 120_000,
            });
            expect(readdirSync(`${workspace.root}/dist/release`).sort()).toEqual([
                "chrome",
                "chrome.zip",
            ]);
            expect(existsSync(`${workspace.root}/dist/release/chrome/background.js.map`))
                .toBe(false);
            expect(existsSync(
                `${workspace.root}/dist/release/chrome/${FACEBOOK_PAYLOAD_BRIDGE_SCRIPT_FILE}`,
            )).toBe(true);
            expect(existsSync(
                `${workspace.root}/dist/release/chrome/`
                + `${FACEBOOK_PAYLOAD_BRIDGE_SCRIPT_FILE}.map`,
            )).toBe(false);
            const releaseZip = unzipSync(readFileSync(
                `${workspace.root}/dist/release/chrome.zip`,
            ));
            expect(releaseZip[FACEBOOK_PAYLOAD_BRIDGE_SCRIPT_FILE]).toBeDefined();
            expect(releaseZip[`${FACEBOOK_PAYLOAD_BRIDGE_SCRIPT_FILE}.map`]).toBeUndefined();
        } finally {
            workspace.cleanup();
        }
    }, 180_000);
});
