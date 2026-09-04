/**
 * @file Verifies the audit reports hardcoded copy and orphaned catalog keys.
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
 * Copies the audit's inputs into a scratch project.
 *
 * @returns - Absolute path to the scratch project root.
 */
function scratchProject(): string {
    const root = mkdtempSync(path.join(tmpdir(), "no-more-ago-audit-"));
    created.push(root);
    cpSync(path.join(process.cwd(), "package.json"), path.join(root, "package.json"));
    cpSync(path.join(process.cwd(), "src"), path.join(root, "src"), { recursive: true });
    mkdirSync(path.join(root, "scripts"), { recursive: true });
    for (const name of ["audit-locales.ts", "validate-locales.ts"]) {
        cpSync(path.join(process.cwd(), "scripts", name), path.join(root, "scripts", name));
    }
    symlinkSync(path.join(process.cwd(), "node_modules"), path.join(root, "node_modules"));
    return root;
}

/**
 * Runs one package script in a scratch project.
 *
 * @param root - Scratch project root.
 * @param script - Package script to run.
 * @returns - Whether it exited zero, plus everything it printed.
 */
async function run(root: string, script: string): Promise<{ ok: boolean; output: string }> {
    try {
        const result = await execFileAsync(PNPM_COMMAND, [script], { cwd: root });
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

describe("locale audit", () => {
    it("passes on the committed sources", async () => {
        expect((await run(scratchProject(), "locales:audit")).ok).toBe(true);
    }, 60_000);

    it("reports a hardcoded user-facing string", async () => {
        const root = scratchProject();
        const file = path.join(root, "src/options/reset-control.tsx");
        writeFileSync(
            file,
            readFileSync(file, "utf8").replace(
                '{t("reset_heading")}',
                "This heading was never translated",
            ),
        );
        const result = await run(root, "locales:audit");
        expect(result.ok).toBe(false);
        expect(result.output).toContain("reset-control.tsx");
        expect(result.output).toContain("This heading was never translated");
    }, 60_000);

    it.each([
        ['const label = `Fixed fixture · ${instant}`;', "Fixed fixture"],
        ['const view = <input placeholder="Enter your hostname here" />;', "Enter your hostname"],
        ["const view = <input placeholder='Hostname' />;", "Hostname"],
    ])("reports untranslated syntax: %s", async (source, expected) => {
        const root = scratchProject();
        writeFileSync(path.join(root, "src/options/audit-fixture.tsx"), source);
        const result = await run(root, "locales:audit");
        expect(result.ok).toBe(false);
        expect(result.output).toContain("audit-fixture.tsx");
        expect(result.output).toContain(expected);
    }, 60_000);

    it("reports an orphaned catalog key", async () => {
        const root = scratchProject();
        const file = path.join(root, "src/_locales/en/messages.json");
        const catalog = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
        catalog.orphaned_key = { message: "Nothing uses this", description: "Orphan" };
        writeFileSync(file, `${JSON.stringify(catalog, null, 2)}\n`);
        const result = await run(root, "locales:audit");
        expect(result.ok).toBe(false);
        expect(result.output).toContain("orphaned_key");
    }, 60_000);

    it("does not report technical literals the UI must not translate", async () => {
        const result = await run(scratchProject(), "locales:audit");
        expect(result.output).not.toContain("America/New_York");
        expect(result.output).not.toContain("example.com");
    }, 60_000);
});
