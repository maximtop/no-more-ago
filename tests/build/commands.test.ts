/**
 * @file Exercises build command parsing, packaging, and failure handling.
 */

/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    readdirSync,
    renameSync,
    rmSync,
    symlinkSync,
    writeFileSync,
} from "node:fs";
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { createArtifactServices } from "../../scripts/build/artifacts.ts";
import { parseBuildRequest, runBuildCommand } from "../../scripts/build/pipeline.ts";
import { artifactBytes, hashPath, makeWorkspace, removeWorkspace } from "./build-workspace";

const execFileAsync = promisify(execFile);

describe("build request and publication contracts", () => {
    it.each([
        ["dev", ["safari"]],
        ["dev", ["chrome", "firefox"]],
        ["release", ["chrome", "--watch"]],
        ["dev", ["--watch"]],
        ["dev", ["chrome", "--watc"]],
    ])("rejects invalid request %s %j", (mode, argv) => {
        expect(() => parseBuildRequest(mode, argv)).toThrow(/Usage: pnpm/);
    });

    it("rejects invalid public pnpm input before creating dist", async () => {
        const workspace = makeWorkspace();
        try {
            await expect(
                execFileAsync(
                    process.platform === "win32" ? "pnpm.cmd" : "pnpm",
                    ["dev", "safari"],
                    { cwd: workspace },
                ),
            ).rejects.toMatchObject({ code: 2 });
            expect(existsSync(`${workspace}/dist`)).toBe(false);
        } finally {
            removeWorkspace(workspace);
        }
    });

    it.each([
        ["pnpm", ["dev", "safari"]],
        ["pnpm", ["dev", "chrome", "firefox"]],
        ["pnpm", ["dev", "--watch"]],
        ["pnpm", ["release", "chrome", "--watch"]],
        ["pnpm", ["dev", "chrome", "extra"]],
        ["pnpm", ["dev", "--bogus"]],
        ["pnpm", ["dev", "chrome", "--watch", "extra"]],
        ["make", ["dev", "release", "chrome"]],
        ["pnpm", ["release", "--watch"]],
        ["make", ["chrome"]],
        ["make", ["firefox"]],
        ["make", ["unknown"]],
        ["make", ["watch"]],
        ["make", ["dev", "release"]],
        ["make", ["release", "--watch"]],
    ])(
        "rejects invalid public command %s %j without changing seeded output",
        async (tool, args) => {
            const workspace = makeWorkspace();
            const seed = `${workspace}/dist/dev/seed`;
            mkdirSync(path.dirname(seed), { recursive: true });
            writeFileSync(seed, "external-seed");
            const before = hashPath(`${workspace}/dist`);
            try {
                const command =
                    tool === "pnpm" ? (process.platform === "win32" ? "pnpm.cmd" : "pnpm") : "make";
                let failure: { code?: number; stdout?: string; stderr?: string } | undefined;
                try {
                    await execFileAsync(command, args, { cwd: workspace, timeout: 30_000 });
                } catch (error) {
                    failure = error as { code?: number; stdout?: string; stderr?: string };
                }
                expect(failure?.code).toBe(2);
                expect(`${failure?.stdout ?? ""}${failure?.stderr ?? ""}`).toMatch(
                    /Usage: pnpm|Makefile|browser|mode/i,
                );
                expect(hashPath(`${workspace}/dist`)).toBe(before);
                expect(
                    readdirSync(`${workspace}/dist`).some(
                        (name) => name.startsWith(".task-") || name.startsWith(".candidate-"),
                    ),
                ).toBe(false);
            } finally {
                removeWorkspace(workspace);
            }
        },
        180_000,
    );

    it("rejects browser-only Make goals and ignores injected selector values", async () => {
        const workspace = makeWorkspace();
        const sentinel = `${workspace}/make-sentinel`;
        try {
            await expect(
                execFileAsync("make", ["chrome"], { cwd: workspace }),
            ).rejects.toMatchObject({ code: 2 });
            await expect(
                execFileAsync("make", ["dev", `BROWSER_GOALS=$(shell touch ${sentinel})`], {
                    cwd: workspace,
                }),
            ).resolves.toBeDefined();
            expect(existsSync(sentinel)).toBe(false);
        } finally {
            removeWorkspace(workspace);
        }
    });

    it.each([
        "FIXED_MODES",
        "FIXED_BROWSERS",
        "GOALS",
        "MODE_GOALS",
        "BROWSER_GOALS",
        "OTHER_GOALS",
        "SELECTED_MODE",
        "SELECTED_BROWSER",
        "SELECTED_ARGS",
    ])(
        "does not evaluate injected Make selector %s",
        async (selector) => {
            const workspace = makeWorkspace();
            const sentinel = `${workspace}/selector-sentinel`;
            try {
                await execFileAsync("make", ["dev", `${selector}=$(shell touch ${sentinel})`], {
                    cwd: workspace,
                    timeout: 60_000,
                });
                expect(existsSync(sentinel)).toBe(false);
            } finally {
                removeWorkspace(workspace);
            }
        },
        180_000,
    );

    it("runs the valid Make all and single-target matrix", async () => {
        const allWorkspace = makeWorkspace();
        try {
            for (const args of [["dev"], ["release"]]) {
                await execFileAsync("make", args, { cwd: allWorkspace, timeout: 60_000 });
            }
            for (const mode of ["dev", "release"]) {
                for (const browser of ["chrome", "firefox", "edge"]) {
                    expect(
                        existsSync(`${allWorkspace}/dist/${mode}/${browser}/manifest.json`),
                    ).toBe(true);
                    expect(existsSync(`${allWorkspace}/dist/${mode}/${browser}.zip`)).toBe(true);
                }
            }
        } finally {
            removeWorkspace(allWorkspace);
        }
        for (const [mode, browser] of [
            ["dev", "chrome"],
            ["dev", "firefox"],
            ["dev", "edge"],
            ["release", "chrome"],
            ["release", "firefox"],
            ["release", "edge"],
        ] as const) {
            const workspace = makeWorkspace();
            try {
                await execFileAsync("make", [mode, browser], { cwd: workspace, timeout: 60_000 });
                expect(readdirSync(`${workspace}/dist/${mode}`).sort()).toEqual([
                    browser,
                    `${browser}.zip`,
                ]);
                expect(
                    JSON.parse(
                        readFileSync(`${workspace}/dist/${mode}/${browser}/manifest.json`, "utf8"),
                    ).version,
                ).toBe("0.1.0");
                expect(existsSync(`${workspace}/dist/${mode}/${browser}/background.js.map`)).toBe(
                    mode === "dev",
                );
            } finally {
                removeWorkspace(workspace);
            }
        }
    }, 180_000);

    it("maintains the complete sixteen-command semantic matrix in fresh workspaces", async () => {
        const matrix: Array<["pnpm" | "make", string, string | undefined]> = [
            ["pnpm", "dev", undefined],
            ["pnpm", "release", undefined],
            ["make", "dev", undefined],
            ["make", "release", undefined],
            ...(["chrome", "firefox", "edge"] as const).flatMap(
                (browser) =>
                    [
                        ["pnpm", "dev", browser],
                        ["pnpm", "release", browser],
                        ["make", "dev", browser],
                        ["make", "release", browser],
                    ] as Array<["pnpm" | "make", string, string]>,
            ),
        ];
        for (const [tool, mode, browser] of matrix) {
            const workspace = makeWorkspace();
            const command =
                tool === "pnpm" ? (process.platform === "win32" ? "pnpm.cmd" : "pnpm") : "make";
            const args = browser ? [mode, browser] : [mode];
            try {
                await execFileAsync(command, args, { cwd: workspace, timeout: 60_000 });
                const expectedBrowsers = browser ? [browser] : ["chrome", "firefox", "edge"];
                const root = `${workspace}/dist/${mode}`;
                expect(readdirSync(root).sort()).toEqual(
                    expectedBrowsers.flatMap((name) => [name, `${name}.zip`]).sort(),
                );
                for (const target of expectedBrowsers) {
                    const directory = `${root}/${target}`;
                    const manifest = JSON.parse(
                        readFileSync(`${directory}/manifest.json`, "utf8"),
                    ) as Record<string, unknown>;
                    const background = manifest.background as Record<string, unknown>;
                    expect(manifest.manifest_version).toBe(3);
                    expect(
                        background[target === "firefox" ? "scripts" : "service_worker"],
                    ).toBeDefined();
                    expect(artifactBytes(directory)).toContain("background.js");
                    expect(artifactBytes(directory)).toContain("content.js");
                    createArtifactServices().validatePair(
                        directory,
                        readFileSync(`${root}/${target}.zip`),
                    );
                    expect(existsSync(`${directory}/background.js.map`)).toBe(mode === "dev");
                }
            } finally {
                removeWorkspace(workspace);
            }
        }
    }, 900_000);

    it("removes stale mode-root entries on selected publication", async () => {
        const workspace = makeWorkspace();
        try {
            await execFileAsync(process.platform === "win32" ? "pnpm.cmd" : "pnpm", ["dev"], {
                cwd: workspace,
                timeout: 60_000,
            });
            writeFileSync(`${workspace}/dist/dev/stale-entry`, "stale");
            await execFileAsync(
                process.platform === "win32" ? "pnpm.cmd" : "pnpm",
                ["dev", "chrome"],
                { cwd: workspace, timeout: 60_000 },
            );
            expect(existsSync(`${workspace}/dist/dev/stale-entry`)).toBe(false);
        } finally {
            removeWorkspace(workspace);
        }
    }, 120_000);

    it("publishes a selected pair while preserving unrequested bytes", () => {
        const workspace = mkdtempSync(path.join(tmpdir(), "no-more-ago-publish-"));
        const dist = path.join(workspace, "dist");
        const modeRoot = path.join(dist, "dev");
        const taskRoot = path.join(dist, ".task-test");
        mkdirSync(path.join(modeRoot, "firefox"), { recursive: true });
        mkdirSync(taskRoot, { recursive: true });
        writeFileSync(path.join(modeRoot, "firefox", "sentinel"), "keep");
        writeFileSync(path.join(modeRoot, "firefox.zip"), "zip");
        const selected = path.join(taskRoot, "selected");
        mkdirSync(selected, { recursive: true });
        writeFileSync(path.join(selected, "manifest.json"), "new");
        const services = createArtifactServices();
        const { candidate } = services.buildCandidateModeRoot({
            workspaceRoot: workspace,
            mode: "dev",
            pairs: { chrome: { directory: selected, zipBytes: Buffer.from("zip") } },
            selected: "chrome",
        });
        services.publishModeRoot({ candidate, modeRoot, taskRoot });
        expect(readFileSync(path.join(modeRoot, "firefox", "sentinel"), "utf8")).toBe("keep");
    });

    it("restores exact prior bytes after a failed candidate rename", () => {
        const workspace = mkdtempSync(path.join(tmpdir(), "no-more-ago-rollback-success-"));
        const dist = path.join(workspace, "dist");
        const modeRoot = path.join(dist, "dev");
        const candidate = path.join(dist, "candidate");
        const taskRoot = path.join(dist, ".task-test");
        mkdirSync(path.join(modeRoot, "chrome"), { recursive: true });
        mkdirSync(candidate, { recursive: true });
        mkdirSync(taskRoot, { recursive: true });
        writeFileSync(path.join(modeRoot, "chrome", "old"), "old-exact");
        writeFileSync(path.join(candidate, "new"), "new");
        const oldBytes = readFileSync(path.join(modeRoot, "chrome", "old"));
        let renames = 0;
        const services = createArtifactServices({
            fs: {
                existsSync,
                renameSync: (from: string, to: string) => {
                    renames += 1;
                    if (renames === 2) {
                        throw new Error("candidate rename fault");
                    }
                    renameSync(from, to);
                },
                rmSync,
            },
        });
        expect(() => {
            services.publishModeRoot({ candidate, modeRoot, taskRoot });
        }).toThrow("candidate rename fault");
        expect(readFileSync(path.join(modeRoot, "chrome", "old"))).toEqual(oldBytes);
        expect(existsSync(candidate)).toBe(true);
        rmSync(workspace, { recursive: true, force: true });
    });

    it.each([[[]], [["chrome"]]])(
        "uses exactly one candidate promotion for %j request",
        async (browserArgs: string[]) => {
            const workspace = makeWorkspace();
            let promotions = 0;
            const native = {
                existsSync,
                renameSync: (from: string, to: string) => {
                    if (path.basename(from).startsWith(".candidate-")) {
                        promotions += 1;
                    }
                    renameSync(from, to);
                },
                rmSync,
            };
            try {
                await runBuildCommand({
                    workspaceRoot: workspace,
                    mode: "dev",
                    argv: browserArgs,
                    artifacts: createArtifactServices({ fs: native }),
                });
                expect(promotions).toBe(1);
            } finally {
                removeWorkspace(workspace);
            }
        },
        120_000,
    );

    it.each(["dist", "dist/dev"])("rejects external guarded root %s", async (rootName) => {
        const workspace = makeWorkspace();
        const external = mkdtempSync(path.join(tmpdir(), "no-more-ago-external-"));
        const sentinel = path.join(external, "sentinel");
        writeFileSync(sentinel, "untouched");
        const target = path.join(workspace, rootName);
        if (rootName === "dist/dev") {
            mkdirSync(path.dirname(target), { recursive: true });
        }
        rmSync(target, { recursive: true, force: true });
        symlinkSync(external, target);
        try {
            await expect(
                execFileAsync(
                    process.platform === "win32" ? "pnpm.cmd" : "pnpm",
                    ["dev", "chrome"],
                    { cwd: workspace },
                ),
            ).rejects.toBeDefined();
            expect(readFileSync(sentinel, "utf8")).toBe("untouched");
        } finally {
            removeWorkspace(workspace);
            rmSync(external, { recursive: true, force: true });
        }
    });

    it("keeps backup and candidate paths actionable when restore fails", () => {
        const workspace = mkdtempSync(path.join(tmpdir(), "no-more-ago-rollback-"));
        const dist = path.join(workspace, "dist");
        const modeRoot = path.join(dist, "dev");
        const candidate = path.join(dist, "candidate");
        const taskRoot = path.join(dist, ".task-test");
        mkdirSync(modeRoot, { recursive: true });
        mkdirSync(candidate, { recursive: true });
        mkdirSync(taskRoot, { recursive: true });
        writeFileSync(path.join(modeRoot, "old"), "old");
        writeFileSync(path.join(candidate, "new"), "new");
        let renames = 0;
        const native = {
            existsSync,
            renameSync: (from: string, to: string) => {
                renames += 1;
                if (renames > 1) {
                    throw new Error("injected promotion failure");
                }
                renameSync(from, to);
            },
            rmSync,
        };
        const services = createArtifactServices({ fs: native });
        expect(() => {
            services.publishModeRoot({ candidate, modeRoot, taskRoot });
        }).toThrow(/recovery: rename/);
        expect(readdirSync(taskRoot).length).toBeGreaterThan(0);
    });

    it("retains the no-prior candidate when promotion fails before publication", () => {
        const workspace = mkdtempSync(path.join(tmpdir(), "no-more-ago-no-prior-"));
        const dist = path.join(workspace, "dist");
        const modeRoot = path.join(dist, "dev");
        const candidate = path.join(dist, "candidate");
        const taskRoot = path.join(dist, ".task-test");
        mkdirSync(candidate, { recursive: true });
        mkdirSync(taskRoot, { recursive: true });
        writeFileSync(path.join(candidate, "new"), "new");
        const services = createArtifactServices({
            fs: {
                existsSync,
                renameSync: () => {
                    throw new Error("injected promotion failure");
                },
                rmSync,
            },
        });
        expect(() => {
            services.publishModeRoot({ candidate, modeRoot, taskRoot });
        }).toThrow(/promotion failure/);
        expect(existsSync(candidate)).toBe(true);
        expect(existsSync(modeRoot)).toBe(false);
    });

    it("keeps a valid publication and backup when backup cleanup fails", () => {
        const workspace = mkdtempSync(path.join(tmpdir(), "no-more-ago-cleanup-"));
        const dist = path.join(workspace, "dist");
        const modeRoot = path.join(dist, "dev");
        const candidate = path.join(dist, "candidate");
        const taskRoot = path.join(dist, ".task-test");
        mkdirSync(modeRoot, { recursive: true });
        mkdirSync(candidate, { recursive: true });
        mkdirSync(taskRoot, { recursive: true });
        writeFileSync(path.join(modeRoot, "old"), "old");
        writeFileSync(path.join(candidate, "new"), "new");
        const services = createArtifactServices({
            fs: {
                existsSync,
                renameSync,
                rmSync: () => {
                    throw new Error("injected backup cleanup failure");
                },
            },
        });
        expect(() => {
            services.publishModeRoot({ candidate, modeRoot, taskRoot });
        }).toThrow(/remove backup/);
        expect(readFileSync(path.join(modeRoot, "new"), "utf8")).toBe("new");
        expect(readdirSync(taskRoot).length).toBeGreaterThan(0);
    });
});
