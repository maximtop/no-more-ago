/**
 * @file Exercises public listing commands and their process exit behavior.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

const cli = path.resolve(import.meta.dirname, "../../../scripts/store/cli.ts");

describe("store CLI", () => {
    it("prints paste-ready text and separates review notices", () => {
        const result = spawnSync(process.execPath, [cli, "render", "chrome", "ru"], {
            encoding: "utf8",
        });
        expect(result.status).toBe(0);
        expect(result.stdout).toContain("No More Ago");
        expect(result.stdout).toContain("Source locale: ru");
        expect(result.stdout).not.toContain("Review:");
        expect(result.stderr).toMatch(/Review: (reviewed|unreviewed|stale|findings)/u);
    });

    it.each([["firefox", "en"], ["chrome", "xx"], ["chrome"]])(
        "rejects unsupported render arguments %j",
        (...args) => {
            const result = spawnSync(process.execPath, [cli, "render", ...args], {
                encoding: "utf8",
            });
            expect(result.status).toBe(1);
            expect(result.stdout).toBe("");
            expect(result.stderr).toMatch(/Usage:|Unknown locale/u);
        },
    );
});
