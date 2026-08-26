/**
 * @file Exercises incremental watch builds and atomic artifact publication.
 */

import { execFile } from "node:child_process";
import {
    appendFileSync,
    existsSync,
    readFileSync,
    readdirSync,
    rmSync,
    statSync,
    symlinkSync,
    writeFileSync,
} from "node:fs";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { unzipSync } from "fflate";
import {
    artifactBytes,
    hasNoBuildResidue,
    hashPath,
    makeWorkspace,
    removeWorkspace,
    startBuild,
    startInjectedBuild,
    type BuildEvent,
} from "./build-workspace";
import { createArtifactServices } from "../../scripts/build/artifacts.ts";

const execFileAsync = promisify(execFile);
const browsers = ["chrome", "firefox", "edge"] as const;

/**
 * Runs one package-manager build command in an isolated workspace.
 *
 * @param workspace - Isolated workspace used as the process directory.
 * @param args - Package-manager arguments for the command.
 */
async function command(workspace: string, args: string[]): Promise<void> {
    await execFileAsync(process.platform === "win32" ? "pnpm.cmd" : "pnpm", args, {
        cwd: workspace,
        timeout: 60_000,
    });
}

describe("selected browser watch lifecycle", () => {
    it.each(browsers)(
        "rebuilds only %s and exits without residue",
        async (browser) => {
            const workspace = makeWorkspace();
            try {
                await command(workspace, ["dev"]);
                await command(workspace, ["release"]);
                const paths = new Map<string, string>();
                for (const mode of ["dev", "release"]) {
                    for (const target of browsers) {
                        paths.set(
                            `${mode}/${target}`,
                            hashPath(`${workspace}/dist/${mode}/${target}`),
                        );
                        paths.set(
                            `${mode}/${target}.zip`,
                            hashPath(`${workspace}/dist/${mode}/${target}.zip`),
                        );
                    }
                }
                const launchSentinel = `${workspace}/launch-sentinel`;
                writeFileSync(launchSentinel, "untouched");
                let running: ReturnType<typeof startBuild> | undefined;
                let knownPid: number | undefined;
                let ready: Record<string, unknown> | undefined;
                try {
                    running = startBuild(workspace, ["dev", browser, "--watch"]);
                    ready = await running.waitFor((event) => event.type === "ready");
                    knownPid = Number(ready.pid);
                    expect(ready.pid).toBeTypeOf("number");
                    await running.waitFor(
                        (event) => event.type === "build" && event.status === "success",
                    );
                    expect(
                        readFileSync(`${workspace}/dist/dev/${browser}/manifest.json`, "utf8"),
                    ).toContain(browser === "firefox" ? '"scripts"' : '"service_worker"');
                    const beforeDirectory = hashPath(`${workspace}/dist/dev/${browser}`);
                    const beforeZip = hashPath(`${workspace}/dist/dev/${browser}.zip`);
                    const beforeInventory = artifactBytes(`${workspace}/dist/dev/${browser}`);
                    appendFileSync(
                        `${workspace}/src/content/main.ts`,
                        `\nglobalThis.__watchMarker_${browser} = "${browser}";\n`,
                    );
                    await running.waitFor(
                        (event) =>
                            event.type === "build" &&
                            event.status === "success" &&
                            Number(event.sequence) > 1,
                    );
                    expect(hashPath(`${workspace}/dist/dev/${browser}`)).not.toBe(beforeDirectory);
                    expect(hashPath(`${workspace}/dist/dev/${browser}.zip`)).not.toBe(beforeZip);
                    expect(
                        readFileSync(`${workspace}/dist/dev/${browser}/content.js`, "utf8"),
                    ).toContain(`__watchMarker_${browser}`);
                    const zipped = unzipSync(
                        new Uint8Array(readFileSync(`${workspace}/dist/dev/${browser}.zip`)),
                    );
                    expect(Buffer.from(zipped["content.js"] ?? []).toString("utf8")).toContain(
                        `__watchMarker_${browser}`,
                    );
                    createArtifactServices().validatePair(
                        `${workspace}/dist/dev/${browser}`,
                        readFileSync(`${workspace}/dist/dev/${browser}.zip`),
                    );
                    expect(artifactBytes(`${workspace}/dist/dev/${browser}`)).toEqual(
                        beforeInventory,
                    );
                    for (const [key, value] of paths) {
                        if (key !== `dev/${browser}` && key !== `dev/${browser}.zip`) {
                            expect(hashPath(`${workspace}/dist/${key}`)).toBe(value);
                        }
                    }
                    expect(readFileSync(launchSentinel, "utf8")).toBe("untouched");
                    await running.stop(knownPid);
                } finally {
                    if (running) {
                        await running.stop(knownPid);
                    }
                }
                expect(hasNoBuildResidue(workspace)).toBe(true);
            } finally {
                removeWorkspace(workspace);
            }
        },
        180_000,
    );

    it("tracks maintained inputs and retains the last good generation", async () => {
        const workspace = makeWorkspace();
        try {
            await command(workspace, ["dev"]);
            await command(workspace, ["release"]);
            const otherPairs = new Map<string, string>();
            for (const mode of ["dev", "release"]) {
                for (const target of ["firefox", "edge"]) {
                    otherPairs.set(
                        `${mode}/${target}`,
                        hashPath(`${workspace}/dist/${mode}/${target}`),
                    );
                    otherPairs.set(
                        `${mode}/${target}.zip`,
                        hashPath(`${workspace}/dist/${mode}/${target}.zip`),
                    );
                }
            }
            otherPairs.set("release/chrome", hashPath(`${workspace}/dist/release/chrome`));
            otherPairs.set("release/chrome.zip", hashPath(`${workspace}/dist/release/chrome.zip`));
            let running: ReturnType<typeof startBuild> | undefined;
            let knownPid: number | undefined;
            let ready: BuildEvent | undefined;
            try {
                const activeBuild = startBuild(workspace, ["dev", "chrome", "--watch"]);
                running = activeBuild;
                ready = await activeBuild.waitFor((event) => event.type === "ready");
                knownPid = Number(ready.pid);
                await running.waitFor(
                    (event) => event.type === "build" && event.status === "success",
                );
                const originalPackage = readFileSync(`${workspace}/package.json`, "utf8");
                const originalCommon = readFileSync(
                    `${workspace}/src/manifest/common.json`,
                    "utf8",
                );
                const originalVariant = readFileSync(
                    `${workspace}/src/manifest/chrome.json`,
                    "utf8",
                );
                const originalSource = readFileSync(`${workspace}/src/content/main.ts`, "utf8");
                const originalPopupApp = readFileSync(`${workspace}/src/popup/app.tsx`, "utf8");
                const originalPopupCss = readFileSync(`${workspace}/src/popup/styles.css`, "utf8");
                const originalPopupHtml = readFileSync(`${workspace}/src/popup/popup.html`, "utf8");
                const originalOptionsApp = readFileSync(`${workspace}/src/options/app.tsx`, "utf8");
                const originalOptionsCss = readFileSync(
                    `${workspace}/src/options/styles.css`,
                    "utf8",
                );
                const originalOptionsHtml = readFileSync(
                    `${workspace}/src/options/options.html`,
                    "utf8",
                );
                let sequence = 1;
                const change = async (
                    file: string,
                    content: string | Buffer,
                    expected?: string,
                ): Promise<number> => {
                    const before = hashPath(`${workspace}/dist/dev/chrome`);
                    const beforeZip = hashPath(`${workspace}/dist/dev/chrome.zip`);
                    const previousSequence = sequence;
                    writeFileSync(file, content);
                    const event = await activeBuild.waitFor(
                        (candidate) =>
                            candidate.type === "build" &&
                            candidate.status === "success" &&
                            Number(candidate.sequence) > previousSequence,
                    );
                    const nextSequence = Number(event.sequence);
                    expect(nextSequence).toBeGreaterThan(previousSequence);
                    sequence = nextSequence;
                    expect(hashPath(`${workspace}/dist/dev/chrome`), file).not.toBe(before);
                    expect(hashPath(`${workspace}/dist/dev/chrome.zip`), file).not.toBe(beforeZip);
                    if (expected) {
                        expect(
                            readFileSync(`${workspace}/dist/dev/chrome/manifest.json`, "utf8"),
                        ).toContain(expected);
                    }
                    return nextSequence;
                };
                const assertPopupArtifact = (
                    file: "popup.js" | "popup.css" | "popup.html",
                    marker: string,
                ): void => {
                    const directory = `${workspace}/dist/dev/chrome`;
                    const emitted = readFileSync(`${directory}/${file}`);
                    expect(emitted.toString("utf8")).toContain(marker);
                    const archive = unzipSync(
                        new Uint8Array(readFileSync(`${workspace}/dist/dev/chrome.zip`)),
                    );
                    expect(Buffer.from(archive[file] ?? [])).toEqual(emitted);
                    createArtifactServices().validatePair(
                        directory,
                        readFileSync(`${workspace}/dist/dev/chrome.zip`),
                    );
                };
                const assertOptionsArtifact = (
                    file: "options.js" | "options.css" | "options.html",
                    marker: string,
                ): void => {
                    const directory = `${workspace}/dist/dev/chrome`;
                    const emitted = readFileSync(`${directory}/${file}`);
                    expect(emitted.toString("utf8")).toContain(marker);
                    const archive = unzipSync(
                        new Uint8Array(readFileSync(`${workspace}/dist/dev/chrome.zip`)),
                    );
                    expect(Buffer.from(archive[file] ?? [])).toEqual(emitted);
                    createArtifactServices().validatePair(
                        directory,
                        readFileSync(`${workspace}/dist/dev/chrome.zip`),
                    );
                };
                await change(
                    `${workspace}/package.json`,
                    originalPackage.replace('"version": "0.1.0"', '"version": "0.1.1"'),
                    '"version": "0.1.1"',
                );
                await change(
                    `${workspace}/src/manifest/common.json`,
                    originalCommon.replace(
                        "Replace trusted relative timestamps with exact dates.",
                        "Changed build description.",
                    ),
                );
                await change(
                    `${workspace}/src/manifest/chrome.json`,
                    `${originalVariant.slice(0, -2)},\n  "optional_permissions": []\n}\n`,
                );
                const changeIcon = async (size: number): Promise<void> => {
                    const file = `${workspace}/src/assets/icons/clock-${String(size)}.png`;
                    const next = addPngText(readFileSync(file), `watch-icon-${String(size)}`);
                    await change(file, next);
                    expect(
                        readFileSync(
                            `${workspace}/dist/dev/chrome/icons/clock-${String(size)}.png`,
                        ),
                    ).toEqual(next);
                    const zipped = unzipSync(
                        new Uint8Array(readFileSync(`${workspace}/dist/dev/chrome.zip`)),
                    )[`icons/clock-${String(size)}.png`];
                    expect(Buffer.from(zipped ?? [])).toEqual(next);
                };
                for (const size of [16, 32, 48, 128]) {
                    await changeIcon(size);
                }
                await change(
                    `${workspace}/src/popup/app.tsx`,
                    originalPopupApp.replace(
                        "<Title order={3}>No More Ago</Title>",
                        "<Title order={3}>No More Ago popup-tsx-watch-marker</Title>",
                    ),
                );
                assertPopupArtifact("popup.js", "popup-tsx-watch-marker");
                await change(
                    `${workspace}/src/popup/styles.css`,
                    `${originalPopupCss}\n.popup-watch-marker { outline: 1px solid #123456; }\n`,
                );
                assertPopupArtifact("popup.css", "popup-watch-marker");
                await change(
                    `${workspace}/src/popup/popup.html`,
                    originalPopupHtml.replace(
                        "<title>No More Ago</title>",
                        "<title>No More Ago popup-html-watch-marker</title>",
                    ),
                );
                assertPopupArtifact("popup.html", "popup-html-watch-marker");
                await change(
                    `${workspace}/src/options/app.tsx`,
                    originalOptionsApp.replace(
                        "<Title order={2}>Settings</Title>",
                        "<Title order={2}>Settings options-tsx-watch-marker</Title>",
                    ),
                );
                assertOptionsArtifact("options.js", "options-tsx-watch-marker");
                await change(
                    `${workspace}/src/options/styles.css`,
                    `${originalOptionsCss}\n`
                        + ".options-watch-marker { outline: 1px solid #123456; }\n",
                );
                assertOptionsArtifact("options.css", "options-watch-marker");
                await change(
                    `${workspace}/src/options/options.html`,
                    originalOptionsHtml.replace(
                        "<title>No More Ago Settings</title>",
                        "<title>No More Ago options-html-watch-marker</title>",
                    ),
                );
                assertOptionsArtifact("options.html", "options-html-watch-marker");
                await change(
                    `${workspace}/src/content/main.ts`,
                    `${originalSource}\nexport const maintainedInput = "chrome";\n`,
                );
                const retainedDirectory = hashPath(`${workspace}/dist/dev/chrome`);
                const retainedZip = hashPath(`${workspace}/dist/dev/chrome.zip`);
                writeFileSync(
                    `${workspace}/src/content/main.ts`,
                    `${originalSource}\nconst broken = ;\n`,
                );
                const failed = await running.waitFor(
                    (event) =>
                        event.type === "build" &&
                        event.status === "failed" &&
                        Number(event.sequence) > sequence,
                );
                sequence = Number(failed.sequence);
                expect(hashPath(`${workspace}/dist/dev/chrome`)).toBe(retainedDirectory);
                expect(hashPath(`${workspace}/dist/dev/chrome.zip`)).toBe(retainedZip);
                await new Promise<void>((resolve) => setTimeout(resolve, 200));
                await change(
                    `${workspace}/src/content/main.ts`,
                    `${originalSource}\nexport const repairedInput = "chrome";\n`,
                );
                for (const [key, value] of otherPairs) {
                    expect(hashPath(`${workspace}/dist/${key}`)).toBe(value);
                }
                await running.stop(knownPid);
            } finally {
                if (running) {
                    await running.stop(knownPid);
                }
            }
        } finally {
            removeWorkspace(workspace);
        }
    }, 180_000);

    it.each(["compile", "package", "promotion", "post-cleanup"])(
        "closes safely during injected %s phase",
        async (phase) => {
            const workspace = makeWorkspace();
            try {
                await command(workspace, ["dev"]);
                await command(workspace, ["release"]);
                const launchSentinel = `${workspace}/launch-sentinel`;
                writeFileSync(launchSentinel, "untouched");
                const external = `${workspace}/external-sentinel`;
                writeFileSync(external, "untouched");
                const unselected = new Map<string, string>();
                for (const mode of ["dev", "release"]) {
                    for (const target of browsers) {
                        if (!(mode === "dev" && target === "chrome")) {
                            unselected.set(
                                `${mode}/${target}`,
                                hashPath(`${workspace}/dist/${mode}/${target}`),
                            );
                            unselected.set(
                                `${mode}/${target}.zip`,
                                hashPath(`${workspace}/dist/${mode}/${target}.zip`),
                            );
                        }
                    }
                }
                let running: ReturnType<typeof startInjectedBuild> | undefined;
                let knownPid: number | undefined;
                try {
                    running = startInjectedBuild(workspace, phase);
                    const ready = await running.waitFor((event) => event.type === "ready");
                    expect(ready.pid).not.toBe(running.child.pid);
                    const buildPid = await running.waitFor((event) => event.type === "build-pid");
                    expect(buildPid.pid).not.toBe(running.child.pid);
                    knownPid = Number(buildPid.pid);
                    if (phase === "post-cleanup") {
                        await running.waitFor(
                            (event) => event.type === "build" && event.status === "success",
                        );
                    } else if (phase !== "compile") {
                        await running.waitFor(
                            (event) => event.type === "phase" && event.phase === phase,
                        );
                    }
                    await running.stop(knownPid, phase === "post-cleanup" ? 50 : 5_000);
                    expectModeRoot(workspace, "dev");
                    expect(readFileSync(launchSentinel, "utf8")).toBe("untouched");
                    expect(readFileSync(external, "utf8")).toBe("untouched");
                    for (const [key, value] of unselected) {
                        expect(hashPath(`${workspace}/dist/${key}`)).toBe(value);
                    }
                    expect(hasNoBuildResidue(workspace)).toBe(true);
                } finally {
                    if (running) {
                        await running.stop(knownPid, phase === "post-cleanup" ? 50 : 5_000);
                    }
                }
            } finally {
                removeWorkspace(workspace);
            }
        },
        120_000,
    );

    it("cleans recoverable candidates after repeated guarded publication failures", async () => {
        const workspace = makeWorkspace();
        try {
            await command(workspace, ["dev"]);
            const external = `${workspace}/external-sentinel`;
            writeFileSync(external, "untouched");
            rmSync(`${workspace}/dist/dev`, { recursive: true, force: true });
            symlinkSync(`${workspace}/external-sentinel`, `${workspace}/dist/dev`);
            let running: ReturnType<typeof startBuild> | undefined;
            let knownPid: number | undefined;
            try {
                running = startBuild(workspace, ["dev", "chrome", "--watch"]);
                const ready = await running.waitFor((event) => event.type === "ready");
                knownPid = Number(ready.pid);
                await running.waitFor(
                    (event) => event.type === "build" && event.status === "failed",
                );
                appendFileSync(
                    `${workspace}/src/content/main.ts`,
                    "\nexport const repeatedFailure = true;\n",
                );
                await running.waitFor(
                    (event) =>
                        event.type === "build" &&
                        event.status === "failed" &&
                        Number(event.sequence) > 1,
                );
                await running.stop(knownPid);
            } finally {
                if (running) {
                    await running.stop(knownPid);
                }
            }
            expect(readFileSync(external, "utf8")).toBe("untouched");
            expect(
                readdirSync(`${workspace}/dist`).some(
                    (name) => name.startsWith(".candidate-") || name.startsWith(".task-"),
                ),
            ).toBe(false);
            expect(hasNoBuildResidue(workspace)).toBe(true);
        } finally {
            removeWorkspace(workspace);
        }
    }, 120_000);

    it("coalesces a rapid maintained-input burst to a consistent final generation", async () => {
        const workspace = makeWorkspace();
        try {
            await command(workspace, ["dev"]);
            await command(workspace, ["release"]);
            const otherPairs = new Map<string, string>();
            for (const mode of ["dev", "release"]) {
                for (const target of browsers) {
                    if (!(mode === "dev" && target === "chrome")) {
                        otherPairs.set(
                            `${mode}/${target}`,
                            hashPath(`${workspace}/dist/${mode}/${target}`),
                        );
                        otherPairs.set(
                            `${mode}/${target}.zip`,
                            hashPath(`${workspace}/dist/${mode}/${target}.zip`),
                        );
                    }
                }
            }
            let running: ReturnType<typeof startInjectedBuild> | undefined;
            let knownPid: number | undefined;
            let ready: BuildEvent | undefined;
            const sampledResidue: Array<{ generation: number; candidate: number }> = [];
            let residueSampler: ReturnType<typeof setInterval> | undefined;
            try {
                const activeBuild = startInjectedBuild(workspace, "rapid");
                running = activeBuild;
                ready = await activeBuild.waitFor((event) => event.type === "ready");
                knownPid = Number(ready.pid);
                residueSampler = setInterval(
                    () => sampledResidue.push(countResidueKinds(workspace)),
                    10,
                );
                await running.waitFor(
                    (event) => event.type === "build" && event.status === "success",
                );
                const oldDirectory = hashPath(`${workspace}/dist/dev/chrome`);
                const oldZip = hashPath(`${workspace}/dist/dev/chrome.zip`);
                const originalPackage = readFileSync(`${workspace}/package.json`, "utf8");
                const originalCommon = readFileSync(
                    `${workspace}/src/manifest/common.json`,
                    "utf8",
                );
                const packagePhaseCount = running.events.filter(
                    (event) => event.type === "phase" && event.phase === "package",
                ).length;
                writeFileSync(
                    `${workspace}/package.json`,
                    originalPackage.replace('"version": "0.1.0"', '"version": "0.2.0"'),
                );
                await activeBuild.waitFor(
                    (event) =>
                        event.type === "phase" &&
                        event.phase === "package" &&
                        activeBuild.events.filter(
                            (candidate) =>
                                candidate.type === "phase" && candidate.phase === "package",
                        ).length > packagePhaseCount,
                );
                expect(hashPath(`${workspace}/dist/dev/chrome`)).toBe(oldDirectory);
                expect(hashPath(`${workspace}/dist/dev/chrome.zip`)).toBe(oldZip);
                writeFileSync(
                    `${workspace}/src/manifest/common.json`,
                    originalCommon.replace(
                        "Replace trusted relative timestamps with exact dates.",
                        "Burst final value.",
                    ),
                );
                writeFileSync(
                    `${workspace}/src/manifest/chrome.json`,
                    "{\n"
                        + '  "background": { "service_worker": "background.js" },\n'
                        + '  "optional_permissions": ["tabs"]\n'
                        + "}\n",
                );
                appendFileSync(
                    `${workspace}/src/content/main.ts`,
                    '\nglobalThis.__noMoreAgoBurstFinal = "final";\n',
                );
                for (const size of [16, 32, 48, 128]) {
                    const file = `${workspace}/src/assets/icons/clock-${String(size)}.png`;
                    writeFileSync(
                        file,
                        addPngText(readFileSync(file), `burst-final-${String(size)}`),
                    );
                }
                const finalEvent = await running.waitFor((event) => {
                    if (
                        event.type !== "build" ||
                        event.status !== "success" ||
                        Number(event.sequence) <= 1
                    ) {
                        return false;
                    }
                    try {
                        const manifest = readFileSync(
                            `${workspace}/dist/dev/chrome/manifest.json`,
                            "utf8",
                        );
                        const content = readFileSync(
                            `${workspace}/dist/dev/chrome/content.js`,
                            "utf8",
                        );
                        return (
                            manifest.includes('"version": "0.2.0"') &&
                            manifest.includes("Burst final value.") &&
                            manifest.includes('"tabs"') &&
                            content.includes("__noMoreAgoBurstFinal")
                        );
                    } catch {
                        return false;
                    }
                });
                expect(finalEvent.sequence).toBeTypeOf("number");
                expect(
                    readFileSync(`${workspace}/dist/dev/chrome/manifest.json`, "utf8"),
                ).toContain('"version": "0.2.0"');
                expect(
                    readFileSync(`${workspace}/dist/dev/chrome/manifest.json`, "utf8"),
                ).toContain("Burst final value.");
                expect(
                    readFileSync(`${workspace}/dist/dev/chrome/manifest.json`, "utf8"),
                ).toContain('"tabs"');
                expect(readFileSync(`${workspace}/dist/dev/chrome/content.js`, "utf8")).toContain(
                    "__noMoreAgoBurstFinal",
                );
                for (const size of [16, 32, 48, 128]) {
                    expect(
                        readFileSync(
                            `${workspace}/dist/dev/chrome/icons/clock-${String(size)}.png`,
                        ),
                    ).toEqual(
                        readFileSync(`${workspace}/src/assets/icons/clock-${String(size)}.png`),
                    );
                }
                const active = { generation: 0, candidate: 0, maxGeneration: 0, maxCandidate: 0 };
                for (const event of running.events) {
                    if (event.type === "allocation") {
                        const delta = event.action === "start" ? 1 : -1;
                        if (event.resource === "generation") {
                            active.generation += delta;
                            active.maxGeneration = Math.max(
                                active.maxGeneration,
                                active.generation,
                            );
                        } else {
                            active.candidate += delta;
                            active.maxCandidate = Math.max(active.maxCandidate, active.candidate);
                        }
                    }
                }
                expect(active.maxGeneration).toBeLessThanOrEqual(1);
                expect(active.maxCandidate).toBeLessThanOrEqual(1);
                const successfulSequences = running.events
                    .filter((event) => event.type === "build" && event.status === "success")
                    .map((event) => Number(event.sequence));
                expect(
                    successfulSequences.every((sequence, index) => {
                        const previous = successfulSequences[index - 1];
                        return index === 0 || (previous !== undefined && sequence > previous);
                    }),
                ).toBe(true);
                createArtifactServices().validatePair(
                    `${workspace}/dist/dev/chrome`,
                    readFileSync(`${workspace}/dist/dev/chrome.zip`),
                );
                expect(
                    Math.max(0, ...sampledResidue.map((sample) => sample.generation)),
                ).toBeLessThanOrEqual(1);
                expect(
                    Math.max(0, ...sampledResidue.map((sample) => sample.candidate)),
                ).toBeLessThanOrEqual(1);
                for (const [key, value] of otherPairs) {
                    expect(hashPath(`${workspace}/dist/${key}`)).toBe(value);
                }
                const session = String(ready.session);
                await running.stop(knownPid);
                expect(existsSync(session)).toBe(false);
                expect(countResidue(workspace)).toBe(0);
            } finally {
                if (residueSampler) {
                    clearInterval(residueSampler);
                }
                if (running) {
                    await running.stop(knownPid);
                }
            }
        } finally {
            removeWorkspace(workspace);
        }
    }, 120_000);
});

/**
 * Asserts that one build mode contains a complete Chrome artifact pair.
 *
 * @param workspace - Isolated build workspace.
 * @param mode - Build output mode to inspect.
 */
function expectModeRoot(workspace: string, mode: string): void {
    const root = `${workspace}/dist/${mode}`;
    expect(existsSync(root)).toBe(true);
    const entries = readdirSync(root);
    expect(entries).toContain("chrome");
    expect(entries).toContain("chrome.zip");
    const manifest = JSON.parse(readFileSync(`${root}/chrome/manifest.json`, "utf8")) as Record<
        string,
        unknown
    >;
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.version).toBeTypeOf("string");
}

/**
 * Counts transient generation and candidate directories below dist.
 *
 * @param workspace - Isolated build workspace to inspect.
 * @returns - Total transient directory count.
 */
function countResidue(workspace: string): number {
    const kinds = countResidueKinds(workspace);
    return kinds.generation + kinds.candidate;
}

/**
 * Counts transient build directories by lifecycle kind.
 *
 * @param workspace - Isolated build workspace to inspect.
 * @returns - Separate generation and candidate counts.
 */
function countResidueKinds(workspace: string): { generation: number; candidate: number } {
    const result = { generation: 0, candidate: 0 };
    const visit = (directory: string): void => {
        let names: string[];
        try {
            if (!existsSync(directory)) {
                return;
            }
            names = readdirSync(directory);
        } catch {
            return;
        }
        for (const name of names) {
            const file = `${directory}/${name}`;
            if (name.startsWith(".generation-")) {
                result.generation += 1;
            }
            if (name.startsWith(".candidate-")) {
                result.candidate += 1;
            }
            try {
                if (statSync(file).isDirectory()) {
                    visit(file);
                }
            } catch {
                /* atomic rename/removal raced the sampler */
            }
        }
    };
    visit(`${workspace}/dist`);
    return result;
}

/**
 * Inserts a PNG text chunk before the terminal IEND chunk.
 *
 * @param png - Source PNG file bytes.
 * @param value - Text payload that makes a rebuild observable.
 * @returns - PNG bytes containing the added text chunk.
 */
function addPngText(png: Buffer, value: string): Buffer {
    const marker = Buffer.from("IEND");
    const iend = png.lastIndexOf(marker) - 4;
    const text = Buffer.from(`watch\0${value}`);
    const type = Buffer.from("tEXt");
    const body = Buffer.concat([type, text]);
    const chunk = Buffer.alloc(text.length + 12);
    chunk.writeUInt32BE(text.length, 0);
    body.copy(chunk, 4);
    chunk.writeUInt32BE(pngCrc32(body), text.length + 8);
    return Buffer.concat([png.subarray(0, iend), chunk, png.subarray(iend)]);
}

/**
 * Calculates the CRC-32 checksum used by generated PNG chunks.
 *
 * @param buffer - PNG chunk type and data bytes covered by the checksum.
 * @returns - Unsigned CRC-32 checksum.
 */
function pngCrc32(buffer: Buffer): number {
    let crc = ~0;
    for (const byte of buffer) {
        crc ^= byte;
        for (let i = 0; i < 8; i += 1) {
            crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
        }
    }
    return ~crc >>> 0;
}
