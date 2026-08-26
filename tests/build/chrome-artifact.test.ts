/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await */
import { execFile } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import vm from "node:vm";
// @ts-expect-error jsdom is a test-only runtime dependency without bundled declarations.
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { unzipSync, zipSync } from "fflate";
import { DIAGNOSTICS_MAX_BYTES } from "../../src/diagnostics/journal";
import { artifactBytes, hashPath, makeWorkspace, removeWorkspace } from "./build-workspace";
import { createArtifactServices } from "../../scripts/build/artifacts.ts";

const execFileAsync = promisify(execFile);
const browsers = ["chrome", "firefox", "edge"] as const;

const settingsV5 = (revision: number, globalEnabled: boolean, sitePreferences: Record<string, boolean> = {}) => ({
    schemaVersion: 5 as const,
    revision,
    globalEnabled,
    sitePreferences,
    display: { formatMode: "system" as const, timeZone: { mode: "system" as const } },
    debugEnabled: false
});

function manifestFor(workspace: string, mode: string, browser: string): Record<string, unknown> {
    return JSON.parse(readFileSync(`${workspace}/dist/${mode}/${browser}/manifest.json`, "utf8")) as Record<string, unknown>;
}

describe("fresh browser artifacts", () => {
    it.each(browsers)("builds a clean isolated %s development artifact", async (browser) => {
        const workspace = makeWorkspace();
        try {
            await execFileAsync(process.platform === "win32" ? "pnpm.cmd" : "pnpm", ["dev", browser], { cwd: workspace, timeout: 60_000 });
            const manifest = manifestFor(workspace, "dev", browser); const background = manifest.background as Record<string, unknown>;
            expect(manifest.manifest_version).toBe(3); expect(manifest.version).toBe("0.1.0"); expect(background[browser === "firefox" ? "scripts" : "service_worker"]).toBeDefined();
            expect(artifactBytes(`${workspace}/dist/dev/${browser}`)).toContain("background.js"); expect(artifactBytes(`${workspace}/dist/dev/${browser}`)).toContain("content.js");
            expect(manifest.options_ui).toEqual({ page: "options.html", open_in_tab: true });
            expect(artifactBytes(`${workspace}/dist/dev/${browser}`)).toEqual(expect.arrayContaining(["options.html", "options.js", "options.css"]));
            for (const size of [16, 32, 48, 128]) { const icon = `${workspace}/dist/dev/${browser}/icons/clock-${String(size)}.png`; expect(statSync(icon).size).toBeGreaterThan(24); }
            expect(artifactBytes(`${workspace}/dist/dev/${browser}`)).toContain("manifest.json");
        } finally { removeWorkspace(workspace); }
    });

    it("produces all release browser pairs in a fresh workspace", async () => {
        const workspace = makeWorkspace();
        try {
            await execFileAsync(process.platform === "win32" ? "pnpm.cmd" : "pnpm", ["release"], { cwd: workspace, timeout: 60_000 });
            for (const browser of browsers) { expect(manifestFor(workspace, "release", browser).version).toBe("0.1.0"); expect(artifactBytes(`${workspace}/dist/release/${browser}`)).not.toContain("background.js.map"); for (const size of [16, 32, 48, 128]) expect(pngDimensions(`${workspace}/dist/release/${browser}/icons/clock-${String(size)}.png`)).toEqual([size, size]); }
        } finally { removeWorkspace(workspace); }
    });

    it("executes every emitted background against a fake scripting runtime without navigation", async () => {
        const workspace = makeWorkspace();
        try {
            await execFileAsync(process.platform === "win32" ? "pnpm.cmd" : "pnpm", ["dev"], { cwd: workspace, timeout: 60_000 }); await execFileAsync(process.platform === "win32" ? "pnpm.cmd" : "pnpm", ["release"], { cwd: workspace, timeout: 60_000 });
            for (const mode of ["dev", "release"]) for (const browser of browsers) {
                const calls: string[] = []; const chrome = { scripting: { getRegisteredContentScripts: () => Promise.resolve([]), registerContentScripts: () => { calls.push("register"); return Promise.resolve(); }, updateContentScripts: () => { calls.push("update"); return Promise.resolve(); } }, tabs: { create: () => { calls.push("tabs"); return Promise.resolve(); } }, windows: { create: () => { calls.push("windows"); return Promise.resolve(); } }, runtime: { openOptionsPage: () => { calls.push("options"); return Promise.resolve(); } } };
                vm.runInNewContext(readFileSync(`${workspace}/dist/${mode}/${browser}/background.js`, "utf8"), { chrome, console: { error: () => calls.push("error") } }); await new Promise<void>((resolve) => setImmediate(resolve)); expect(calls).toEqual(["register"]);
            }
        } finally { removeWorkspace(workspace); }
    }, 180_000);

    it("smoke-tests emitted background readiness, disabled restart, and invalid fail-closed cleanup", async () => {
        const workspace = makeWorkspace();
        try {
            await execFileAsync(process.platform === "win32" ? "pnpm.cmd" : "pnpm", ["dev"], { cwd: workspace, timeout: 60_000 });
            await execFileAsync(process.platform === "win32" ? "pnpm.cmd" : "pnpm", ["release"], { cwd: workspace, timeout: 60_000 });
            for (const mode of ["dev", "release"] as const) for (const browser of browsers) {
                const expected = { id: "no-more-ago-github", matches: ["http://github.com/*", "https://github.com/*"], js: ["content.js"], runAt: "document_start", allFrames: false, persistAcrossSessions: true };
                const lifecycle = () => { let listener: ((...args: unknown[]) => void) | undefined; return { addListener: (next: (...args: unknown[]) => void) => { listener = next; }, fire: (...args: unknown[]) => listener?.(...args) }; };
                const onMessage = lifecycle(); const onStartup = lifecycle(); const onInstalled = lifecycle();
                let releaseLoad: ((value: Record<string, unknown>) => void) | undefined;
                const load = new Promise<Record<string, unknown>>((resolve) => { releaseLoad = resolve; });
                let loadCalls = 0;
                let deferredLoadCalls = 0;
                const calls: string[] = [];
                const chrome = {
                    storage: { local: { get: () => { loadCalls += 1; if (loadCalls === 1) { deferredLoadCalls += 1; return load; } return Promise.resolve({ settings: settingsV5(2, true) }); }, set: async () => undefined, remove: async () => undefined } },
                    scripting: {
                        getRegisteredContentScripts: async () => [expected],
                        registerContentScripts: async () => { calls.push("register"); },
                        updateContentScripts: async () => { calls.push("update"); },
                        unregisterContentScripts: async () => { calls.push("unregister"); },
                        executeScript: async () => { calls.push("execute"); }
                    },
                    tabs: {
                        query: async () => [{ id: 7, url: "https://github.com/example" }],
                        sendMessage: async (_id: number, message: unknown) => { if (message && typeof message === "object" && "type" in message && message.type === "no-more-ago:teardown") calls.push("teardown"); return { type: "no-more-ago:status", phase: "active" }; }
                    },
                    runtime: { onMessage, onStartup, onInstalled }
                };
                vm.runInNewContext(readFileSync(`${workspace}/dist/${mode}/${browser}/background.js`, "utf8"), { chrome, URL, console: { error: (...args: unknown[]) => { calls.push(`error:${String(args[0])}`); } } }, { contextCodeGeneration: { strings: false, wasm: false } });
                const responseCounts = { get: 0, set: 0 };
                const earlyGet = new Promise<unknown>((resolve) => {
                    onMessage.fire({ type: "no-more-ago:get-popup-state" }, {}, (response: unknown) => { responseCounts.get += 1; resolve(response); });
                });
                const earlySet = new Promise<unknown>((resolve) => {
                    onMessage.fire({ type: "no-more-ago:set-global-enabled", enabled: false }, {}, (response: unknown) => { responseCounts.set += 1; resolve(response); });
                });
                onStartup.fire(); onInstalled.fire();
                releaseLoad?.({ settings: settingsV5(2, true) });
                const [getResponse, setResponse] = await Promise.all([earlyGet, earlySet]);
                expect(deferredLoadCalls).toBe(1);
                expect(loadCalls).toBe(2);
                expect(responseCounts).toEqual({ get: 1, set: 1 });
                expect(getResponse).toMatchObject({ availability: "ready", revision: expect.any(Number), hostname: "github.com" });
                const getState = getResponse as { globalEnabled: boolean; status: string; revision: number };
                expect(getState.revision).toBeGreaterThanOrEqual(2);
                expect(getState.status).toBe(getState.globalEnabled ? "active" : "global-disabled");
                expect(setResponse).toMatchObject({ ok: true, acceptedRevision: 3, state: { availability: "ready", revision: 3, globalEnabled: false, status: "global-disabled" } });
                expect(calls).not.toContain("update");
                expect(calls.filter((call) => call === "execute")).toHaveLength(1);
                expect(calls).toContain("unregister");
                expect(calls).toContain("teardown");

                const coldCalls: string[] = [];
                const coldChrome = {
                    storage: { local: { get: async () => ({ settings: settingsV5(2, true) }), set: async () => undefined, remove: async () => undefined } },
                    scripting: { getRegisteredContentScripts: async () => [expected], registerContentScripts: async () => { coldCalls.push("register"); }, updateContentScripts: async () => { coldCalls.push("update"); }, unregisterContentScripts: async () => { coldCalls.push("unregister"); }, executeScript: async () => { coldCalls.push("execute"); } },
                    tabs: { query: async () => [{ id: 7, url: "https://github.com/example" }], sendMessage: async () => ({ type: "no-more-ago:status", phase: "active" }) },
                    runtime: { onMessage: lifecycle(), onStartup: lifecycle(), onInstalled: lifecycle() }
                };
                vm.runInNewContext(readFileSync(`${workspace}/dist/${mode}/${browser}/background.js`, "utf8"), { chrome: coldChrome, URL, console: { error: () => undefined } }, { contextCodeGeneration: { strings: false, wasm: false } });
                await new Promise<void>((resolve) => setTimeout(resolve, 100));
                expect(coldCalls).toEqual([]);

                const disabledCalls: string[] = [];
                const disabledChrome = {
                    storage: { local: { get: async () => ({ settings: settingsV5(3, false) }), set: async () => undefined, remove: async () => undefined } },
                    scripting: { getRegisteredContentScripts: async () => [expected], registerContentScripts: async () => undefined, updateContentScripts: async () => undefined, unregisterContentScripts: async () => { disabledCalls.push("unregister"); }, executeScript: async () => { disabledCalls.push("execute"); } },
                    tabs: { query: async () => [{ id: 7, url: "https://github.com/example" }], sendMessage: async (_id: number, message: unknown) => { if (message && typeof message === "object" && "type" in message) disabledCalls.push(String(message.type)); return { type: "no-more-ago:status", phase: "active" }; } },
                    runtime: { onMessage: lifecycle(), onStartup: lifecycle(), onInstalled: lifecycle() }
                };
                vm.runInNewContext(readFileSync(`${workspace}/dist/${mode}/${browser}/background.js`, "utf8"), { chrome: disabledChrome, URL, console: { error: () => undefined } }, { contextCodeGeneration: { strings: false, wasm: false } });
                await new Promise<void>((resolve) => setTimeout(resolve, 100));
                expect(disabledCalls).toContain("unregister");
                expect(disabledCalls).toContain("no-more-ago:teardown");

                let pairCurrent: unknown = { schemaVersion: 3, revision: 4 };
                let pairPrevious: unknown = settingsV5(8, false);
                let pairWrites = 0;
                let rejectReset = false;
                const pairStorage = {
                    get: async () => ({ settings: structuredClone(pairCurrent), "settings.previous": structuredClone(pairPrevious) }),
                    set: async (items: Record<string, unknown>) => {
                        if (rejectReset) throw new Error("disk full");
                        pairWrites += 1;
                        pairCurrent = structuredClone(items.settings);
                        pairPrevious = structuredClone(items["settings.previous"]);
                    }
                };
                const startPairRuntime = () => {
                    const calls: string[] = [];
                    const onMessage = lifecycle();
                    const runtime = {
                        storage: { local: pairStorage },
                        scripting: { getRegisteredContentScripts: async () => [expected], registerContentScripts: async () => { calls.push("register"); }, updateContentScripts: async () => { calls.push("update"); }, unregisterContentScripts: async () => { calls.push("unregister"); }, executeScript: async () => { calls.push("execute"); } },
                        tabs: { query: async () => [{ id: 7, url: "https://github.com/example" }], sendMessage: async (_id: number, message: unknown) => { calls.push(message && typeof message === "object" && "type" in message ? String(message.type) : "unknown"); return { type: "no-more-ago:status", phase: "active" }; } },
                        runtime: { onMessage, onStartup: lifecycle(), onInstalled: lifecycle() }
                    };
                    vm.runInNewContext(readFileSync(`${workspace}/dist/${mode}/${browser}/background.js`, "utf8"), { chrome: runtime, URL, structuredClone, console: { error: () => undefined } }, { contextCodeGeneration: { strings: false, wasm: false } });
                    return { calls, onMessage };
                };

                const mountPairOptions = async (runtime: ReturnType<typeof startPairRuntime>) => {
                    const origin = browser === "firefox" ? "moz-extension://11111111-1111-4111-8111-111111111111" : "chrome-extension://abcdefghijklmnopabcdefghijklmnop";
                    const dom = new JSDOM(readFileSync(`${workspace}/dist/${mode}/${browser}/options.html`, "utf8"), { runScripts: "outside-only", url: `${origin}/options.html`, pretendToBeVisual: true });
                    Object.defineProperty(dom.window, "matchMedia", { value: () => ({ matches: false, media: "", onchange: null, addListener: () => undefined, removeListener: () => undefined, addEventListener: () => undefined, removeEventListener: () => undefined, dispatchEvent: () => false }) });
                    const resetResponses: unknown[] = [];
                    const transport = {
                        sendMessage: (message: unknown) => new Promise<unknown>((resolve) => {
                            runtime.onMessage.fire(message, {}, (response: unknown) => {
                                if (message && typeof message === "object" && "type" in message && message.type === "no-more-ago:reset-all-settings") resetResponses.push(response);
                                resolve(response);
                            });
                        })
                    };
                    vm.runInContext(readFileSync(`${workspace}/dist/${mode}/${browser}/options.js`, "utf8"), createCspDomContext(dom, { runtime: transport }));
                    await new Promise<void>((resolve) => setTimeout(resolve, 60));
                    const actions = [...dom.window.document.querySelectorAll("button")].filter((button) => button.textContent === "Reset all settings");
                    expect(actions).toHaveLength(1);
                    const action = actions[0];
                    if (!action) throw new Error("Recovery reset action is missing");
                    return { dom, action, resetResponses };
                };

                const recoveredRuntime = startPairRuntime();
                await new Promise<void>((resolve) => setTimeout(resolve, 250));
                expect(pairCurrent).toEqual(pairPrevious);
                expect(pairWrites).toBe(1);
                expect(recoveredRuntime.calls).toContain("unregister");

                pairCurrent = { schemaVersion: 6, revision: 99, globalEnabled: true };
                pairPrevious = settingsV5(8, true);
                const futureRuntime = startPairRuntime();
                await new Promise<void>((resolve) => setTimeout(resolve, 250));
                expect(pairWrites).toBe(1);
                expect(futureRuntime.calls).toContain("unregister");
                expect(pairCurrent).toMatchObject({ schemaVersion: 6, revision: 99 });

                pairCurrent = { schemaVersion: 3 };
                pairPrevious = { schemaVersion: 2 };
                const dualRuntime = startPairRuntime();
                await new Promise<void>((resolve) => setTimeout(resolve, 250));
                expect(pairWrites).toBe(1);
                expect(dualRuntime.calls).toContain("unregister");
                expect(dualRuntime.calls).toContain("no-more-ago:teardown");
                const recoveryOptions = await mountPairOptions(dualRuntime);
                recoveryOptions.action.click();
                for (let turn = 0; turn < 30 && recoveryOptions.resetResponses.length === 0; turn += 1) await new Promise<void>((resolve) => setImmediate(resolve));
                expect(recoveryOptions.resetResponses).toHaveLength(1);
                expect(recoveryOptions.resetResponses[0]).toMatchObject({ ok: true, acceptedRevision: 0, state: { availability: "ready" } });
                expect(pairWrites).toBe(2);
                expect(pairCurrent).toMatchObject({ schemaVersion: 5, revision: 0, globalEnabled: true, debugEnabled: false });
                expect(pairPrevious).toEqual(pairCurrent);
                for (let turn = 0; turn < 30 && !recoveryOptions.dom.window.document.body.textContent?.includes("github.com"); turn += 1) await new Promise<void>((resolve) => setImmediate(resolve));
                expect(recoveryOptions.dom.window.document.body.textContent).toContain("github.com");
                recoveryOptions.dom.window.close();

                pairCurrent = { schemaVersion: 3 };
                pairPrevious = { schemaVersion: 2 };
                rejectReset = true;
                const rejectedRuntime = startPairRuntime();
                await new Promise<void>((resolve) => setTimeout(resolve, 250));
                const beforeRejectedPair = { current: pairCurrent, previous: pairPrevious };
                const rejectedResult = await new Promise<unknown>((resolve) => {
                    let count = 0;
                    rejectedRuntime.onMessage.fire({ type: "no-more-ago:reset-all-settings" }, {}, (response: unknown) => { count += 1; resolve({ response, count }); });
                });
                expect(rejectedResult).toMatchObject({ count: 1, response: { ok: false, state: { availability: "unavailable" } } });
                expect(["save-failed", "settings-unavailable"]).toContain((rejectedResult as { response: { error: string } }).response.error);
                expect(pairWrites).toBe(2);
                expect(pairCurrent).toBe(beforeRejectedPair.current);
                expect(pairPrevious).toBe(beforeRejectedPair.previous);
                const rejectedOptions = await mountPairOptions(rejectedRuntime);
                rejectedOptions.action.click();
                for (let turn = 0; turn < 30 && !rejectedOptions.dom.window.document.body.textContent?.includes("Processing remains disabled"); turn += 1) await new Promise<void>((resolve) => setImmediate(resolve));
                expect(rejectedOptions.resetResponses).toHaveLength(1);
                expect(rejectedOptions.resetResponses[0]).toMatchObject({ ok: false, error: "save-failed", state: { availability: "unavailable" } });
                expect(rejectedOptions.dom.window.document.body.textContent).toContain("Processing remains disabled");
                expect(pairWrites).toBe(2);
                expect(pairCurrent).toBe(beforeRejectedPair.current);
                expect(pairPrevious).toBe(beforeRejectedPair.previous);
                rejectedOptions.dom.window.close();
            }
        } finally { removeWorkspace(workspace); }
    }, 240_000);

    it("keeps ZIP output deterministic across time zones and rejects malformed pairs", async () => {
        const workspace = makeWorkspace();
        try {
            await execFileAsync(process.platform === "win32" ? "pnpm.cmd" : "pnpm", ["dev", "chrome"], { cwd: workspace, env: { ...process.env, TZ: "UTC" }, timeout: 60_000 }); const utc = readFileSync(`${workspace}/dist/dev/chrome.zip`);
            await execFileAsync(process.platform === "win32" ? "pnpm.cmd" : "pnpm", ["dev", "chrome"], { cwd: workspace, env: { ...process.env, TZ: "Pacific/Kiritimati" }, timeout: 60_000 }); expect(readFileSync(`${workspace}/dist/dev/chrome.zip`)).toEqual(utc);
            const copy = mkdtempSync(path.join(tmpdir(), "no-more-ago-invalid-artifact-")); cpSync(`${workspace}/dist/dev/chrome`, copy, { recursive: true }); const services = createArtifactServices();
            const outside = mkdtempSync(path.join(tmpdir(), "no-more-ago-outside-")); writeFileSync(`${outside}/sentinel`, "safe"); symlinkSync(`${outside}/sentinel`, `${copy}/unsafe-link`); expect(() => services.createZip(copy)).toThrow(/Symlink/); rmSync(`${copy}/unsafe-link`, { force: true }); rmSync(outside, { recursive: true, force: true });
            const pinned = createArtifactServices({ zipSync }); const pinnedZip = pinned.createZip(`${workspace}/dist/dev/chrome`); expect(pinned.validatePair(`${workspace}/dist/dev/chrome`, pinnedZip).files).toEqual(services.listFiles(`${workspace}/dist/dev/chrome`));
            let capturedEntries: Record<string, Uint8Array> | undefined; let capturedOptions: Parameters<typeof zipSync>[1] | undefined; const capturing = createArtifactServices({ zipSync: (entries: Record<string, Uint8Array>, options: Parameters<typeof zipSync>[1]) => { capturedEntries = entries; capturedOptions = options; return zipSync(entries, options); } }); const capturedZip = capturing.createZip(`${workspace}/dist/dev/chrome`); expect(capturedEntries && Object.keys(capturedEntries)).toEqual(services.listFiles(`${workspace}/dist/dev/chrome`)); expect(capturedOptions?.level).toBe(0); expect(capturedOptions?.mtime).toBeInstanceOf(Date); expect((capturedOptions?.mtime as Date).getFullYear()).toBe(1980); expect(capturing.validatePair(`${workspace}/dist/dev/chrome`, capturedZip).files).toEqual(services.listFiles(`${workspace}/dist/dev/chrome`)); expect(() => createArtifactServices({ zipSync: () => { throw new Error("encoder fault"); } }).createZip(`${workspace}/dist/dev/chrome`)).toThrow("encoder fault");
            expect(() => services.validatePair(copy, Buffer.from("not a zip"))).toThrow();
            writeFileSync(`${copy}/icons/clock-16.png`, Buffer.from("fake png")); expect(() => services.validatePair(copy, utc)).toThrow();
            cpSync(`${workspace}/dist/dev/chrome`, copy, { recursive: true, force: true }); writeFileSync(`${copy}/icons/clock-16.png`, shellPng(16)); expect(() => services.validatePair(copy, utc)).toThrow();
            cpSync(`${workspace}/dist/dev/chrome`, copy, { recursive: true, force: true }); writeFileSync(`${copy}/background.js`, "const = ;"); expect(() => services.validatePair(copy, utc)).toThrow();
            cpSync(`${workspace}/dist/dev/chrome`, copy, { recursive: true, force: true }); const manifest = JSON.parse(readFileSync(`${copy}/manifest.json`, "utf8")) as Record<string, unknown>; (manifest.icons as Record<string, string>)["16"] = "icons/missing.png"; writeFileSync(`${copy}/manifest.json`, JSON.stringify(manifest)); expect(() => services.validatePair(copy, utc)).toThrow();
            cpSync(`${workspace}/dist/dev/chrome`, copy, { recursive: true, force: true }); writeFileSync(`${copy}/extra.bin`, "extra"); expect(() => services.validatePair(copy, utc)).toThrow(/inventory/);
            rmSync(`${copy}/extra.bin`, { force: true }); const canonical = services.createZip(copy); const alteredArchive: Record<string, Uint8Array> = {}; for (const name of services.listFiles(copy)) alteredArchive[name] = new Uint8Array(readFileSync(`${copy}/${name}`)); const background = alteredArchive["background.js"]; if (!background) throw new Error("background missing from test archive"); alteredArchive["background.js"] = new Uint8Array(Buffer.from(`${Buffer.from(background).toString("utf8")}\n`)); const parityServices = createArtifactServices({ unzipSync: () => alteredArchive }); expect(() => parityServices.validatePair(copy, canonical)).toThrow(/bytes differ/);
            expect(() => services.validatePair(`${workspace}/dist/dev/chrome`, utc.subarray(0, utc.length - 1))).toThrow();
        } finally { removeWorkspace(workspace); }
    }, 120_000);

    it("delivers emitted Sites reads and site writes exactly once under the V2 background boundary", async () => {
        const workspace = makeWorkspace();
        try {
            await execFileAsync(process.platform === "win32" ? "pnpm.cmd" : "pnpm", ["dev"], { cwd: workspace, timeout: 60_000 });
            await execFileAsync(process.platform === "win32" ? "pnpm.cmd" : "pnpm", ["release"], { cwd: workspace, timeout: 60_000 });
            for (const mode of ["dev", "release"] as const) for (const browser of browsers) {
                const expected = { id: "no-more-ago-github", matches: ["http://github.com/*", "https://github.com/*"], js: ["content.js"], runAt: "document_start", allFrames: false, persistAcrossSessions: true };
                const lifecycle = (): { addListener: (next: (...args: unknown[]) => void) => void; fire: (...args: unknown[]) => void } => {
                    let listener: ((...args: unknown[]) => void) | undefined;
                    return { addListener: (next) => { listener = next; }, fire: (...args) => listener?.(...args) };
                };
                const onMessage = lifecycle(); const onStartup = lifecycle(); const onInstalled = lifecycle();
                let stored: Record<string, unknown> = settingsV5(0, true);
                let previousStored: Record<string, unknown> = settingsV5(0, true);
                let storageSets = 0;
                const calls: string[] = [];
                const chrome = {
                    storage: { local: {
                        get: async () => ({ settings: structuredClone(stored), "settings.previous": structuredClone(previousStored) }),
                        set: async (items: Record<string, unknown>) => {
                            storageSets += 1;
                            if (!items.settings || !items["settings.previous"]) throw new Error("atomic pair required");
                            stored = structuredClone(items.settings) as Record<string, unknown>;
                            previousStored = structuredClone(items["settings.previous"]) as Record<string, unknown>;
                        },
                        remove: async () => undefined
                    } },
                    scripting: {
                        getRegisteredContentScripts: async () => [expected],
                        registerContentScripts: async () => { calls.push("register"); },
                        updateContentScripts: async () => { calls.push("update"); },
                        unregisterContentScripts: async () => { calls.push("unregister"); },
                        executeScript: async () => { calls.push("execute"); }
                    },
                    tabs: {
                        query: async () => { calls.push("query"); return [{ id: 7, url: "https://github.com/example" }]; },
                        sendMessage: async (_id: number, message: unknown) => {
                            if (message && typeof message === "object" && "type" in message && message.type === "no-more-ago:teardown") calls.push("teardown");
                            return { type: "no-more-ago:status", phase: "active" };
                        }
                    },
                    runtime: { onMessage, onStartup, onInstalled }
                };
                vm.runInNewContext(readFileSync(`${workspace}/dist/${mode}/${browser}/background.js`, "utf8"), { chrome, URL, structuredClone, console: { error: () => undefined } }, { contextCodeGeneration: { strings: false, wasm: false } });
                await new Promise<void>((resolve) => setTimeout(resolve, 75));
                const responses = { get: 0, noAdapter: 0, github: 0, invalidPopup: 0, invalidSites: 0 };
                const getResponse = new Promise<unknown>((resolve) => { onMessage.fire({ type: "no-more-ago:get-sites-state" }, {}, (value: unknown) => { responses.get += 1; resolve(value); }); });
                const noAdapterResponse = new Promise<unknown>((resolve) => { onMessage.fire({ type: "no-more-ago:set-site-enabled", hostname: "example.test", enabled: false, surface: "sites" }, {}, (value: unknown) => { responses.noAdapter += 1; resolve(value); }); });
                expect(await getResponse).toMatchObject({ availability: "ready", revision: 0, sites: [{ hostname: "github.com", enabled: true, hasAdapter: true }] });
                expect(await noAdapterResponse).toMatchObject({ ok: true, surface: "sites", acceptedRevision: 1, state: { availability: "ready", revision: 1, globalEnabled: true } });
                expect((stored.sitePreferences as Record<string, boolean>)["example.test"]).toBe(false);
                const beforeInvalid = storageSets;
                const beforeInvalidCalls = calls.length;
                const invalidPopup = new Promise<unknown>((resolve) => { onMessage.fire({ type: "no-more-ago:set-site-enabled", hostname: "EXAMPLE.TEST", enabled: false, surface: "popup" }, {}, (value: unknown) => { responses.invalidPopup += 1; resolve(value); }); });
                const invalidSites = new Promise<unknown>((resolve) => { onMessage.fire({ type: "no-more-ago:set-site-enabled", hostname: "example.test:443", enabled: false, surface: "sites" }, {}, (value: unknown) => { responses.invalidSites += 1; resolve(value); }); });
                expect(await invalidPopup).toEqual({ ok: false, error: "invalid-hostname", surface: "popup", state: { availability: "ready", revision: 1, globalEnabled: true, hostname: "github.com", siteEnabled: true, hasAdapter: true, status: "active" } });
                expect(await invalidSites).toEqual({ ok: false, error: "invalid-hostname", surface: "sites", state: { availability: "ready", revision: 1, globalEnabled: true, sites: [{ hostname: "example.test", enabled: false, hasAdapter: false }, { hostname: "github.com", enabled: true, hasAdapter: true }] } });
                expect(responses).toEqual({ get: 1, noAdapter: 1, github: 0, invalidPopup: 1, invalidSites: 1 });
                expect(storageSets).toBe(beforeInvalid);
                expect(calls.length).toBe(beforeInvalidCalls);
                const githubResponse = new Promise<unknown>((resolve) => { onMessage.fire({ type: "no-more-ago:set-site-enabled", hostname: "github.com", enabled: false, surface: "sites" }, {}, (value: unknown) => { responses.github += 1; resolve(value); }); });
                expect(await githubResponse).toMatchObject({ ok: true, surface: "sites", acceptedRevision: 2, state: { availability: "ready", revision: 2 } });
                expect(responses).toEqual({ get: 1, noAdapter: 1, github: 1, invalidPopup: 1, invalidSites: 1 });
                expect(calls).toContain("unregister");
                expect(calls).toContain("teardown");
            }
        } finally { removeWorkspace(workspace); }
    }, 240_000);

    it("covers all public mode/browser combinations and archive version propagation", async () => {
        const workspace = makeWorkspace();
        try {
            const packagePath = `${workspace}/package.json`; const packageJson = JSON.parse(readFileSync(packagePath, "utf8")) as { version: string }; packageJson.version = "9.8.7"; writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
            for (const args of [["dev"], ["release"]]) await execFileAsync(process.platform === "win32" ? "pnpm.cmd" : "pnpm", args, { cwd: workspace, timeout: 60_000 });
            const initial = new Map<string, string>();
            for (const mode of ["dev", "release"]) for (const browser of browsers) {
                const directory = `${workspace}/dist/${mode}/${browser}`; const archivePath = `${workspace}/dist/${mode}/${browser}.zip`; const manifest = manifestFor(workspace, mode, browser); const archive = readFileSync(archivePath); const unpacked = unzipSync(new Uint8Array(archive));
                const archivedManifest = unpacked["manifest.json"]; if (!archivedManifest) throw new Error("archive manifest missing"); expect(manifest.version).toBe("9.8.7"); expect(JSON.parse(Buffer.from(archivedManifest).toString("utf8")).version).toBe("9.8.7"); expect(Object.keys(unpacked).sort()).toEqual(artifactBytes(directory)); expect(dosDates(archive).length).toBeGreaterThan(0); expect(dosDates(archive).every((date) => date.year === 1980 && date.month === 1 && date.day === 1)).toBe(true);
                initial.set(`${mode}/${browser}`, hashPath(directory)); initial.set(`${mode}/${browser}.zip`, hashPath(archivePath)); if (mode === "release") expect(artifactBytes(directory)).not.toContain("background.js.map");
            }
            packageJson.version = "9.8.8"; writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`); await execFileAsync(process.platform === "win32" ? "pnpm.cmd" : "pnpm", ["dev", "edge"], { cwd: workspace, timeout: 60_000 });
            expect(hashPath(`${workspace}/dist/dev/edge`)).not.toBe(initial.get("dev/edge")); expect(hashPath(`${workspace}/dist/dev/edge.zip`)).not.toBe(initial.get("dev/edge.zip"));
            const selectedManifest = manifestFor(workspace, "dev", "edge"); const selectedArchive = unzipSync(new Uint8Array(readFileSync(`${workspace}/dist/dev/edge.zip`))); const selectedArchivedManifest = selectedArchive["manifest.json"]; if (!selectedArchivedManifest) throw new Error("selected archive manifest missing"); expect(selectedManifest.version).toBe("9.8.8"); expect(JSON.parse(Buffer.from(selectedArchivedManifest).toString("utf8")).version).toBe("9.8.8");
            for (const [key, value] of initial) if (!key.startsWith("dev/edge")) expect(hashPath(`${workspace}/dist/${key}`)).toBe(value);
        } finally { removeWorkspace(workspace); }
    });

    it("runs the emitted display protocol, policy gates, and content hydration in every browser artifact", async () => {
        const workspace = makeWorkspace();
        try {
            await execFileAsync(process.platform === "win32" ? "pnpm.cmd" : "pnpm", ["dev"], { cwd: workspace, timeout: 60_000 });
            await execFileAsync(process.platform === "win32" ? "pnpm.cmd" : "pnpm", ["release"], { cwd: workspace, timeout: 60_000 });
            for (const mode of ["dev", "release"] as const) for (const browser of browsers) {
                const directory = `${workspace}/dist/${mode}/${browser}`;
                const expectedRegistration = { id: "no-more-ago-github", matches: ["http://github.com/*", "https://github.com/*"], js: ["content.js"], runAt: "document_start", allFrames: false, persistAcrossSessions: true };
                const lifecycle = (): { addListener: (next: (...args: unknown[]) => void) => void; fire: (...args: unknown[]) => void } => {
                    let listener: ((...args: unknown[]) => void) | undefined;
                    return { addListener: (next) => { listener = next; }, fire: (...args) => listener?.(...args) };
                };
                const onMessage = lifecycle(); const onStartup = lifecycle(); const onInstalled = lifecycle();
                let stored: Record<string, unknown> = settingsV5(2, true);
                let previousStored: Record<string, unknown> = settingsV5(1, true);
                let diagnosticsStored: unknown;
                let storageSets = 0;
                const storageKinds: string[] = [];
                const diagnosticsAccesses: string[] = [];
                let acknowledgement: "correct" | "missing" | "stale" = "correct";
                const updates: Array<{ readonly message: unknown; readonly options: unknown }> = [];
                const debugUpdates: Array<{ readonly message: unknown; readonly options: unknown }> = [];
                let diagnosticsContentListener: ((...args: unknown[]) => unknown) | undefined;
                const diagnosticContentContext: { current?: vm.Context } = {};
                let rejectNextDiagnosticWrite = false;
                let rejectNextSettingsWrite = false;
                let activeTabUrl = "https://github.com/example/repo";
                const requestedRegistrationIds: string[][] = [];
                const executedContentTargets: number[] = [];
                const extensionId = browser === "firefox" ? "no-more-ago@example.test" : "abcdefghijklmnopabcdefghijklmnop";
                const extensionOrigin = browser === "firefox"
                    ? "moz-extension://11111111-1111-4111-8111-111111111111"
                    : `chrome-extension://${extensionId}`;
                const optionsUrl = `${extensionOrigin}/options.html`;
                const optionsSender = { url: optionsUrl, id: extensionId };
                const chrome = {
                    storage: { local: {
                        get: async (keys?: unknown) => {
                            if (keys === "diagnostics") diagnosticsAccesses.push("get");
                            return { settings: structuredClone(stored), "settings.previous": structuredClone(previousStored), ...(diagnosticsStored === undefined ? {} : { diagnostics: structuredClone(diagnosticsStored) }) };
                        },
                        set: async (items: Record<string, unknown>) => {
                            storageKinds.push(Object.keys(items).join(","));
                            if (Object.hasOwn(items, "diagnostics")) {
                                if (rejectNextDiagnosticWrite) { rejectNextDiagnosticWrite = false; throw new Error("diagnostic storage unavailable"); }
                                diagnosticsStored = structuredClone(items.diagnostics);
                                return;
                            }
                            if (rejectNextSettingsWrite) { rejectNextSettingsWrite = false; throw new Error("settings storage unavailable"); }
                            storageSets += 1;
                            if (!items.settings || !items["settings.previous"]) throw new Error("atomic pair required");
                            stored = structuredClone(items.settings) as Record<string, unknown>;
                            previousStored = structuredClone(items["settings.previous"]) as Record<string, unknown>;
                        },
                        remove: async (keys: string | readonly string[]) => {
                            if (keys === "diagnostics" || (Array.isArray(keys) && keys.includes("diagnostics"))) {
                                diagnosticsAccesses.push("remove");
                                diagnosticsStored = undefined;
                            }
                        }
                    } },
                    scripting: {
                        getRegisteredContentScripts: async ({ ids }: { readonly ids: readonly string[] }) => {
                            requestedRegistrationIds.push([...ids]);
                            return [expectedRegistration];
                        },
                        registerContentScripts: async () => undefined,
                        updateContentScripts: async () => undefined,
                        unregisterContentScripts: async () => undefined,
                        executeScript: async ({ target }: { readonly target: { readonly tabId: number } }) => {
                            executedContentTargets.push(target.tabId);
                            if (diagnosticContentContext.current) vm.runInContext(readFileSync(`${directory}/content.js`, "utf8"), diagnosticContentContext.current);
                        }
                    },
                    tabs: {
                        query: async (query: { readonly active?: boolean }) => [{ id: 17, url: query.active ? activeTabUrl : "https://github.com/example/repo" }],
                        sendMessage: async (_tabId: number, message: unknown, options?: unknown) => {
                            if (message && typeof message === "object" && "type" in message && message.type === "no-more-ago:update-presentation") {
                                updates.push({ message, options });
                                if (acknowledgement === "missing") return undefined;
                                if (acknowledgement === "stale") return { type: "no-more-ago:presentation-updated", revision: 1 };
                                if (diagnosticsContentListener) return diagnosticsContentListener(message, {}, () => undefined);
                                return { type: "no-more-ago:presentation-updated", revision: (message as unknown as { revision: number }).revision };
                            }
                            if (message && typeof message === "object" && "type" in message && message.type === "no-more-ago:update-debug-policy" && "revision" in message) {
                                debugUpdates.push({ message, options });
                                if (diagnosticsContentListener) return diagnosticsContentListener(message, {}, () => undefined);
                                return { type: "no-more-ago:debug-policy-updated", revision: message.revision };
                            }
                            if (diagnosticsContentListener && message && typeof message === "object" && "type" in message
                && (message.type === "no-more-ago:status" || message.type === "no-more-ago:teardown")) {
                                return diagnosticsContentListener(message, {}, () => undefined);
                            }
                            return { type: "no-more-ago:status", phase: "active" };
                        }
                    },
                    runtime: {
                        onMessage,
                        onStartup,
                        onInstalled,
                        id: extensionId,
                        getURL: (entry: string) => `${extensionOrigin}/${entry}`,
                        getManifest: () => manifestFor(workspace, mode, browser)
                    }
                };
                const expectedBrowserFamily = browser === "firefox" ? "firefox" : "chromium";
                const browserNavigator = {
                    userAgent: browser === "firefox"
                        ? "Mozilla/5.0 Firefox/142.0"
                        : browser === "edge" ? "Mozilla/5.0 Chrome/139.0.0.0 Edg/139.0" : "Mozilla/5.0 Chrome/139.0.0.0"
                };
                const expectedReportBrowser = browser === "firefox" ? "Firefox" : browser === "edge" ? "Edge" : "Chrome";
                vm.runInNewContext(readFileSync(`${directory}/background.js`, "utf8"), { chrome, URL, TextEncoder, structuredClone, navigator: browserNavigator, console: { error: () => undefined } }, { contextCodeGeneration: { strings: false, wasm: false } });
                await new Promise<void>((resolve) => setTimeout(resolve, 100));

                const dispatch = (message: unknown, sender: unknown = {}): Promise<unknown> => new Promise((resolve) => {
                    let count = 0;
                    onMessage.fire(message, sender, (response: unknown) => { count += 1; resolve({ response, count }); });
                });
                const initialRead = await dispatch({ type: "no-more-ago:get-display-state" });
                expect(initialRead).toEqual({ count: 1, response: { availability: "ready", revision: 2, display: { formatMode: "system", timeZone: { mode: "system" } }, debugEnabled: false } });

                const beforeInvalidWrites = storageSets;
                const beforeInvalidUpdates = updates.length;
                const invalid = await dispatch({ type: "no-more-ago:set-display-settings", display: { formatMode: "system", timeZone: { mode: "iana", identifier: "No/SuchZone" } } });
                expect(invalid).toMatchObject({ count: 1, response: { ok: false, error: "invalid-time-zone", state: { availability: "ready", revision: 2 } } });
                expect(storageSets).toBe(beforeInvalidWrites);
                expect(updates.length).toBe(beforeInvalidUpdates);

                const invalidCustom = await dispatch({ type: "no-more-ago:set-display-settings", display: { formatMode: "custom", pattern: "YYYY-MM-dd", timeZone: { mode: "utc" } } });
                expect(invalidCustom).toMatchObject({ count: 1, response: { ok: false, error: "invalid-format", state: { availability: "ready", revision: 2 } } });
                expect(storageSets).toBe(beforeInvalidWrites);
                expect(updates.length).toBe(beforeInvalidUpdates);
                const invalidEmpty = await dispatch({ type: "no-more-ago:set-display-settings", display: { formatMode: "custom", pattern: "", timeZone: { mode: "utc" } } });
                expect(invalidEmpty).toMatchObject({ count: 1, response: { ok: false, error: "invalid-format", state: { availability: "ready", revision: 2 } } });
                expect(storageSets).toBe(beforeInvalidWrites);
                expect(updates.length).toBe(beforeInvalidUpdates);

                const utc = await dispatch({ type: "no-more-ago:set-display-settings", display: { formatMode: "system", timeZone: { mode: "utc" } } });
                expect(utc).toMatchObject({ count: 1, response: { ok: true, acceptedRevision: 3, state: { availability: "ready", revision: 3 }, refreshFailures: [] } });
                expect(stored).toMatchObject({ schemaVersion: 5, revision: 3, debugEnabled: false, display: { timeZone: { mode: "utc" } } });
                expect(updates).toHaveLength(1);
                expect(updates[0]).toMatchObject({ message: { type: "no-more-ago:update-presentation", revision: 3, display: { timeZone: { mode: "utc" } } }, options: { frameId: 0 } });

                const custom = await dispatch({ type: "no-more-ago:set-display-settings", display: { formatMode: "custom", pattern: "yyyy-MM-dd HH:mm 'UTC'", timeZone: { mode: "utc" } } });
                expect(custom).toMatchObject({ count: 1, response: { ok: true, acceptedRevision: 4, state: { availability: "ready", revision: 4, display: { formatMode: "custom", pattern: "yyyy-MM-dd HH:mm 'UTC'" } }, refreshFailures: [] } });
                expect(stored).toMatchObject({ schemaVersion: 5, revision: 4, debugEnabled: false, display: { formatMode: "custom", pattern: "yyyy-MM-dd HH:mm 'UTC'" } });

                acknowledgement = "missing";
                const partial = await dispatch({ type: "no-more-ago:set-display-settings", display: { formatMode: "system", timeZone: { mode: "iana", identifier: "America/New_York" } } });
                expect(partial).toMatchObject({ count: 1, response: { ok: true, acceptedRevision: 5, state: { availability: "ready", revision: 5 }, refreshFailures: [{ hostname: "github.com", tabId: 17, reason: "tab-update" }] } });
                expect(stored).toMatchObject({ revision: 5, display: { timeZone: { identifier: "America/New_York" } } });

                const updatesBeforeGlobalOff = updates.length;
                await dispatch({ type: "no-more-ago:set-global-enabled", enabled: false });
                acknowledgement = "correct";
                const disabledSave = await dispatch({ type: "no-more-ago:set-display-settings", display: { formatMode: "system", timeZone: { mode: "utc" } } });
                expect(disabledSave).toMatchObject({ count: 1, response: { ok: true, acceptedRevision: 7, refreshFailures: [] } });
                expect(updates.length).toBe(updatesBeforeGlobalOff);

                const contentDom = new JSDOM("<relative-time datetime=\"2026-08-23T10:15:00Z\">yesterday</relative-time>", { runScripts: "outside-only", url: "https://github.com/example/repo" });
                Object.defineProperty(contentDom.window.navigator, "languages", { configurable: true, value: ["en-US"] });
                let contentListener: ((...args: unknown[]) => unknown) | undefined;
                let contentReads = 0;
                const contentRuntime = {
                    sendMessage: (message: unknown) => {
                        if (message && typeof message === "object" && "type" in message && message.type === "no-more-ago:get-display-state") {
                            contentReads += 1;
                            return Promise.resolve({ availability: "ready", revision: 1, display: { formatMode: "custom", pattern: "yyyy-MM-dd HH:mm XXX", timeZone: { mode: "iana", identifier: "America/New_York" } }, debugEnabled: false });
                        }
                        return Promise.resolve(undefined);
                    },
                    onMessage: { addListener: (listener: (...args: unknown[]) => unknown) => { contentListener = listener; } }
                };
                const contentContext = createCspDomContext(contentDom, { runtime: contentRuntime });
                vm.runInContext(readFileSync(`${directory}/content.js`, "utf8"), contentContext);
                await new Promise<void>((resolve) => setTimeout(resolve, 25));
                contentDom.window.document.dispatchEvent(new contentDom.window.Event("DOMContentLoaded"));
                await new Promise<void>((resolve) => setTimeout(resolve, 100));
                expect(contentReads).toBe(1);
                const source = contentDom.window.document.querySelector("relative-time");
                const output = contentDom.window.document.querySelector("time[data-no-more-ago-output]");
                if (!source || !output) throw new Error("content timestamp ownership pair missing");
                const contentStatus = contentListener?.({ type: "no-more-ago:status" }, {}, () => undefined);
                expect(contentStatus).toMatchObject({ phase: "active" });
                expect(source.hasAttribute("hidden")).toBe(true);
                expect(output.textContent).toBe("2026-08-23 06:15 -04:00");
                const updateMessage = { type: "no-more-ago:update-presentation", revision: 2, display: { formatMode: "custom", pattern: "yyyy-MM-dd HH:mm 'UTC'", timeZone: { mode: "utc" } } };
                const updateResponse = contentListener?.(updateMessage, {}, () => undefined);
                expect(updateResponse).toEqual({ type: "no-more-ago:presentation-updated", revision: 2 });
                expect(output.textContent).toBe("2026-08-23 10:15 UTC");
                Object.defineProperty(contentDom.window.navigator, "languages", { configurable: true, value: ["de-DE"] });
                const germanResponse = contentListener?.({ type: "no-more-ago:update-presentation", revision: 3, display: { formatMode: "custom", pattern: "EEEE, d MMMM yyyy", timeZone: { mode: "utc" } } }, {}, () => undefined);
                expect(germanResponse).toEqual({ type: "no-more-ago:presentation-updated", revision: 3 });
                expect(output.textContent).toBe("Sonntag, 23 August 2026");
                Object.defineProperty(contentDom.window.navigator, "languages", { configurable: true, value: ["zz-ZZ"] });
                const fallbackResponse = contentListener?.({ type: "no-more-ago:update-presentation", revision: 4, display: { formatMode: "custom", pattern: "EEEE, d MMMM yyyy", timeZone: { mode: "utc" } } }, {}, () => undefined);
                expect(fallbackResponse).toEqual({ type: "no-more-ago:presentation-updated", revision: 4 });
                expect(output.textContent).toBe("Sunday, 23 August 2026");
                contentDom.window.close();

                const beforeResetWrites = storageSets;
                let malformedResetResponses = 0;
                onMessage.fire({ type: "no-more-ago:reset-all-settings", extra: true }, {}, () => { malformedResetResponses += 1; });
                await new Promise<void>((resolve) => setTimeout(resolve, 20));
                expect(malformedResetResponses).toBe(0);
                expect(storageSets).toBe(beforeResetWrites);
                const reset = await dispatch({ type: "no-more-ago:reset-all-settings" });
                expect(reset).toMatchObject({ count: 1, response: { ok: true, acceptedRevision: 0, state: { availability: "ready", revision: 0, globalEnabled: true } } });
                expect(storageSets).toBe(beforeResetWrites + 1);
                expect(stored).toMatchObject({ schemaVersion: 5, revision: 0, globalEnabled: true, sitePreferences: {}, display: { formatMode: "system", timeZone: { mode: "system" } }, debugEnabled: false });
                expect(previousStored).toEqual(stored);

                const diagnosticsDom = new JSDOM('<relative-time datetime="2026-08-23T10:15:00Z">private initial text</relative-time>', {
                    runScripts: "outside-only",
                    url: "https://github.com/example/repo?token=secret#private"
                });
                Object.defineProperty(diagnosticsDom.window.navigator, "languages", { configurable: true, value: ["en-US"] });
                let diagnosticListenerCount = 0;
                let diagnosticHydrationReads = 0;
                let emittedDiagnosticEvents = 0;
                const diagnosticSender = { url: "https://github.com/example/repo?token=secret#private", tab: { incognito: true }, frameId: 0 };
                const diagnosticContentRuntime = {
                    sendMessage: (message: unknown) => new Promise<unknown>((resolve) => {
                        if (message && typeof message === "object" && "type" in message && message.type === "no-more-ago:get-display-state") diagnosticHydrationReads += 1;
                        if (message && typeof message === "object" && "type" in message && message.type === "no-more-ago:diagnostic-event") emittedDiagnosticEvents += 1;
                        onMessage.fire(message, diagnosticSender, resolve);
                    }),
                    onMessage: {
                        addListener: (listener: (...args: unknown[]) => unknown) => {
                            diagnosticListenerCount += 1;
                            diagnosticsContentListener = listener;
                        }
                    }
                };
                diagnosticContentContext.current = createCspDomContext(diagnosticsDom, { runtime: diagnosticContentRuntime });
                vm.runInContext(readFileSync(`${directory}/content.js`, "utf8"), diagnosticContentContext.current);
                await new Promise<void>((resolve) => setTimeout(resolve, 25));
                diagnosticsDom.window.document.dispatchEvent(new diagnosticsDom.window.Event("DOMContentLoaded"));
                await new Promise<void>((resolve) => setTimeout(resolve, 25));
                expect(diagnosticListenerCount).toBe(1);
                expect(diagnosticHydrationReads).toBe(1);
                expect(diagnosticsDom.window.document.querySelectorAll("time[data-no-more-ago-output]")).toHaveLength(1);
                expect(emittedDiagnosticEvents).toBe(0);
                expect(diagnosticsStored).toBeUndefined();

                const debugRead = await dispatch({ type: "no-more-ago:get-debug-state" });
                expect(debugRead).toEqual({ count: 1, response: { availability: "ready", revision: 0, enabled: false } });
                await expect(dispatch({ type: "no-more-ago:get-diagnostics-snapshot" }, optionsSender)).resolves.toEqual({ count: 1, response: { ok: false, error: "disabled" } });
                await expect(dispatch({ type: "no-more-ago:clear-diagnostics" }, optionsSender)).resolves.toEqual({ count: 1, response: { ok: false, error: "disabled" } });
                const debugOn = await dispatch({ type: "no-more-ago:set-debug-enabled", enabled: true });
                expect(debugOn).toMatchObject({ count: 1, response: { ok: true, acceptedRevision: 1, state: { availability: "ready", revision: 1, enabled: true } } });
                expect(stored).toMatchObject({ schemaVersion: 5, revision: 1, debugEnabled: true });
                expect(debugUpdates).toEqual([{ message: { type: "no-more-ago:update-debug-policy", revision: 1, enabled: true }, options: { frameId: 0 } }]);
                expect(diagnosticsContentListener?.({ type: "no-more-ago:update-debug-policy", revision: 0, enabled: false }, {}, () => undefined)).toBeUndefined();

                rejectNextDiagnosticWrite = true;
                const dynamic = diagnosticsDom.window.document.createElement("relative-time");
                dynamic.setAttribute("datetime", "2026-08-24T11:16:00Z");
                dynamic.textContent = "private dynamic content";
                diagnosticsDom.window.document.body.append(dynamic);
                await new Promise<void>((resolve) => setTimeout(resolve, 20));
                expect(diagnosticsDom.window.document.querySelectorAll("time[data-no-more-ago-output]")).toHaveLength(2);
                expect(emittedDiagnosticEvents).toBeGreaterThan(0);
                let malformedEventResponses = 0;
                onMessage.fire({ type: "no-more-ago:diagnostic-event", event: { category: "mutation", count: 1, reason: "adapter-matched", datetime: "secret" } }, { url: "https://github.com/example/repo?token=secret#hash", tab: { incognito: true }, frameId: 0 }, () => { malformedEventResponses += 1; });
                await new Promise<void>((resolve) => setTimeout(resolve, 20));
                expect(malformedEventResponses).toBe(0);
                const safeEvent = await dispatch({ type: "no-more-ago:diagnostic-event", event: { category: "mutation", count: 1, reason: "adapter-matched" } }, { url: "https://github.com/example/repo?token=secret#hash", tab: { incognito: true }, frameId: 0 });
                expect(safeEvent).toMatchObject({ count: 1, response: { ok: true } });
                if (diagnosticsStored === undefined) throw new Error(`diagnostics missing; writes=${storageKinds.join("|")}`);
                expect(JSON.stringify(diagnosticsStored)).not.toMatch(/token|hash|datetime|github\.com\/example|private dynamic content|2026-08-24/u);
                expect(diagnosticsStored).toMatchObject({
                    entries: expect.arrayContaining([
                        expect.objectContaining({ hostname: "github.com", incognito: true, category: "mutation", extensionVersion: "0.1.0", browserFamily: expectedBrowserFamily }),
                        expect.objectContaining({ hostname: "github.com", incognito: true, category: "timing", extensionVersion: "0.1.0", browserFamily: expectedBrowserFamily }),
                        expect.objectContaining({ hostname: "github.com", incognito: false, category: "settings", extensionVersion: "0.1.0", browserFamily: expectedBrowserFamily })
                    ])
                });

                const unauthorizedSenders: unknown[] = [
                    {},
                    diagnosticSender,
                    { url: "https://github.com/example/repo", id: extensionId },
                    { url: `${extensionOrigin}/popup.html`, id: extensionId },
                    { url: `${optionsUrl}?private=true`, id: extensionId },
                    { url: `${optionsUrl}#private`, id: extensionId },
                    { url: optionsUrl },
                    { url: optionsUrl, id: "foreign-extension" },
                    { url: `${browser === "firefox" ? "moz-extension" : "chrome-extension"}://foreign/options.html`, id: extensionId },
                    Object.assign(Object.create({ url: optionsUrl }) as Record<string, unknown>, { id: extensionId }),
                    Object.assign(Object.create({ id: extensionId }) as Record<string, unknown>, { url: optionsUrl })
                ];
                for (const type of ["no-more-ago:get-diagnostics-snapshot", "no-more-ago:clear-diagnostics"]) {
                    for (const sender of unauthorizedSenders) {
                        const beforeAccess = diagnosticsAccesses.length;
                        let callbacks = 0;
                        onMessage.fire({ type }, sender, () => { callbacks += 1; });
                        expect(callbacks).toBe(0);
                        expect(diagnosticsAccesses).toHaveLength(beforeAccess);
                    }
                }
                const authorizedSnapshot = await dispatch({ type: "no-more-ago:get-diagnostics-snapshot" }, optionsSender);
                expect(authorizedSnapshot).toMatchObject({
                    count: 1,
                    response: {
                        ok: true,
                        snapshot: {
                            environment: { extensionVersion: "0.1.0", browserFamily: expectedBrowserFamily },
                            entries: expect.arrayContaining([expect.objectContaining({ hostname: "github.com", incognito: true })])
                        }
                    }
                });
                expect(JSON.parse(JSON.stringify(authorizedSnapshot))).toEqual(authorizedSnapshot);

                const reportQueries: Array<{ readonly active: true; readonly currentWindow: true }> = [];
                const reportNavigations: Array<{ readonly url: string; readonly windowId?: number }> = [];
                let reportTab: { readonly url: string; readonly incognito: boolean; readonly windowId?: number } = {
                    url: "https://github.com/example/repo?filter=recent#comment",
                    incognito: false
                };
                let reportManifestReads = 0;
                let reportCreateAttempts = 0;
                let rejectNextReportNavigation = false;
                const reportTabs = {
                    query: async (query: { readonly active: true; readonly currentWindow: true }) => {
                        reportQueries.push(query);
                        return [reportTab];
                    },
                    create: async (properties: { readonly url: string; readonly windowId?: number }) => {
                        reportCreateAttempts += 1;
                        if (rejectNextReportNavigation) { rejectNextReportNavigation = false; throw new Error("tab creation unavailable"); }
                        reportNavigations.push(structuredClone(properties));
                    }
                };
                const reportManifest = (): Record<string, unknown> => {
                    reportManifestReads += 1;
                    return manifestFor(workspace, mode, browser);
                };

                const optionsDom = new JSDOM(readFileSync(`${directory}/options.html`, "utf8"), { runScripts: "outside-only", url: optionsUrl, pretendToBeVisual: true });
                Object.defineProperty(optionsDom.window, "matchMedia", { value: () => ({ matches: false, media: "", onchange: null, addListener: () => undefined, removeListener: () => undefined, addEventListener: () => undefined, removeEventListener: () => undefined, dispatchEvent: () => false }) });
                Object.defineProperty(optionsDom.window.navigator, "userAgent", { configurable: true, value: browserNavigator.userAgent });
                Object.defineProperty(optionsDom.window, "Blob", { configurable: true, value: Blob });
                const downloadedBlobs: Blob[] = [];
                const validUrls = new Set<string>();
                const revokedUrls: string[] = [];
                const pendingRevocations: Array<() => void> = [];
                let successfulClicks = 0;
                let failNextClick = false;
                Object.defineProperty(optionsDom.window.URL, "createObjectURL", {
                    configurable: true,
                    value: (blob: Blob) => {
                        downloadedBlobs.push(blob);
                        const url = `blob:${extensionOrigin}/${String(downloadedBlobs.length)}`;
                        validUrls.add(url);
                        return url;
                    }
                });
                Object.defineProperty(optionsDom.window.URL, "revokeObjectURL", {
                    configurable: true,
                    value: (url: string) => { revokedUrls.push(url); validUrls.delete(url); }
                });
                Object.defineProperty(optionsDom.window.HTMLAnchorElement.prototype, "click", {
                    configurable: true,
                    value: function click(this: HTMLAnchorElement): void {
                        expect(validUrls.has(this.href)).toBe(true);
                        expect(this.download).toBe("no-more-ago-diagnostics.zip");
                        if (failNextClick) { failNextClick = false; throw new Error("download unavailable"); }
                        successfulClicks += 1;
                    }
                });
                let forgedSnapshot: unknown;
                const optionsRuntime = {
                    getManifest: reportManifest,
                    sendMessage: (message: unknown) => {
                        if (forgedSnapshot !== undefined && message && typeof message === "object" && "type" in message && message.type === "no-more-ago:get-diagnostics-snapshot") {
                            const snapshot = forgedSnapshot;
                            forgedSnapshot = undefined;
                            return Promise.resolve({ ok: true, snapshot });
                        }
                        return new Promise<unknown>((resolve) => { onMessage.fire(message, optionsSender, resolve); });
                    }
                };
                const optionsContext = createCspDomContext(optionsDom, { runtime: optionsRuntime, tabs: reportTabs });
                vm.runInContext(readFileSync(`${directory}/options.js`, "utf8"), optionsContext);
                await new Promise<void>((resolve) => setTimeout(resolve, 60));
                expect(optionsDom.window.document.body.textContent).toContain("Debug logs");
                expect(optionsDom.window.document.body.textContent).toContain("Download logs");
                expect(optionsDom.window.document.body.textContent).toContain("Clear logs");
                expect(optionsDom.window.document.body.textContent).toContain("Open GitHub issue");
                expect(successfulClicks).toBe(0);
                expect(reportQueries).toEqual([]);
                expect(reportNavigations).toEqual([]);
                expect(reportManifestReads).toBe(0);
                optionsContext.setTimeout = (callback: () => void) => { pendingRevocations.push(callback); return 1; };
                const findAction = (label: string): HTMLButtonElement => {
                    const action = [...optionsDom.window.document.querySelectorAll("button")].find((button) => button.textContent === label);
                    if (!action) throw new Error(`${label} action missing`);
                    return action;
                };
                const accessesBeforeOptionsReport = diagnosticsAccesses.length;
                const writesBeforeOptionsReport = storageSets;
                findAction("Open GitHub issue").click();
                for (let turn = 0; turn < 20 && reportNavigations.length === 0; turn += 1) await new Promise<void>((resolve) => setImmediate(resolve));
                expect(reportCreateAttempts).toBe(1);
                expect(reportNavigations).toHaveLength(1);
                expect(reportQueries).toEqual([]);
                expect(reportManifestReads).toBe(1);
                expect(diagnosticsAccesses).toHaveLength(accessesBeforeOptionsReport);
                expect(storageSets).toBe(writesBeforeOptionsReport);
                expect(downloadedBlobs).toEqual([]);
                expect(successfulClicks).toBe(0);
                const genericReport = new URL(reportNavigations[0]?.url ?? "");
                expect(`${genericReport.origin}${genericReport.pathname}`).toBe("https://github.com/maximtop/no-more-ago/issues/new");
                expect(Object.fromEntries(genericReport.searchParams)).toEqual({ template: "site-report.yml", extension_version: "0.1.0", browser: expectedReportBrowser });
                expect(genericReport.toString()).not.toContain(extensionOrigin);

                findAction("Download logs").click();
                for (let turn = 0; turn < 20 && downloadedBlobs.length === 0; turn += 1) await new Promise<void>((resolve) => setImmediate(resolve));
                expect(successfulClicks).toBe(1);
                expect(downloadedBlobs).toHaveLength(1);
                expect(validUrls.size).toBe(1);
                expect(revokedUrls).toEqual([]);
                expect(pendingRevocations).toHaveLength(1);
                const firstBlob = downloadedBlobs[0];
                if (!firstBlob) throw new Error("diagnostics archive missing");
                const unpackedDiagnostics = unzipSync(new Uint8Array(await firstBlob.arrayBuffer()));
                expect(Object.keys(unpackedDiagnostics)).toEqual(["diagnostics.json"]);
                const packedEntries = unpackedDiagnostics["diagnostics.json"];
                if (!packedEntries) throw new Error("diagnostics member missing");
                const archiveSnapshot = JSON.parse(Buffer.from(packedEntries).toString("utf8")) as { entries: readonly unknown[]; environment: Record<string, unknown> };
                expect(archiveSnapshot.environment).toEqual({ extensionVersion: "0.1.0", browserFamily: expectedBrowserFamily });
                expect(archiveSnapshot.entries).toEqual((diagnosticsStored as { entries: readonly unknown[] }).entries);
                expect(JSON.stringify(archiveSnapshot)).not.toMatch(/token|hash|datetime|private dynamic content/u);
                pendingRevocations[0]?.();
                expect(validUrls.size).toBe(0);
                expect(revokedUrls).toHaveLength(1);

                const serializer = Object.defineProperty({}, "toJSON", {
                    value: () => ({ entries: archiveSnapshot.entries, environment: archiveSnapshot.environment, url: "https://github.com/private?token=secret", datetime: "2026-08-23T10:15:00Z", dom: "<secret>" })
                });
                forgedSnapshot = Object.assign(Object.create(serializer) as Record<string, unknown>, { entries: archiveSnapshot.entries, environment: archiveSnapshot.environment });
                for (let turn = 0; turn < 20 && findAction("Download logs").disabled; turn += 1) await new Promise<void>((resolve) => setImmediate(resolve));
                findAction("Download logs").click();
                for (let turn = 0; turn < 20 && !optionsDom.window.document.body.textContent?.includes("unavailable"); turn += 1) await new Promise<void>((resolve) => setImmediate(resolve));
                expect(optionsDom.window.document.body.textContent).toContain("unavailable");
                expect(downloadedBlobs).toHaveLength(1);
                expect(successfulClicks).toBe(1);

                const preservedDiagnostics = diagnosticsStored;
                const retainedEvent = (diagnosticsStored as { entries: readonly Record<string, unknown>[] }).entries[0];
                if (!retainedEvent) throw new Error("retained diagnostic event missing");
                diagnosticsStored = { entries: [{ ...retainedEvent, stack: [`frame:${"1".repeat(DIAGNOSTICS_MAX_BYTES)}`] }] };
                expect(await dispatch({ type: "no-more-ago:get-diagnostics-snapshot" }, optionsSender)).toEqual({ count: 1, response: { ok: false, error: "invalid-journal" } });
                for (let turn = 0; turn < 20 && findAction("Download logs").disabled; turn += 1) await new Promise<void>((resolve) => setImmediate(resolve));
                findAction("Download logs").click();
                for (let turn = 0; turn < 20 && !optionsDom.window.document.body.textContent?.includes("invalid"); turn += 1) await new Promise<void>((resolve) => setImmediate(resolve));
                expect(optionsDom.window.document.body.textContent).toContain("invalid");
                expect(downloadedBlobs).toHaveLength(1);
                expect(diagnosticsDom.window.document.querySelectorAll("time[data-no-more-ago-output]")).toHaveLength(2);
                diagnosticsStored = preservedDiagnostics;

                const revisionBeforeClear = (stored as { revision: number }).revision;
                const settingsWritesBeforeClear = storageSets;
                for (let turn = 0; turn < 20 && findAction("Clear logs").disabled; turn += 1) await new Promise<void>((resolve) => setImmediate(resolve));
                expect(findAction("Clear logs").disabled).toBe(false);
                findAction("Clear logs").click();
                const hasDiagnostics = (): boolean => diagnosticsStored !== undefined;
                for (let turn = 0; turn < 20 && hasDiagnostics(); turn += 1) await new Promise<void>((resolve) => setImmediate(resolve));
                expect(diagnosticsStored).toBeUndefined();
                expect(storageSets).toBe(settingsWritesBeforeClear);
                expect(stored).toMatchObject({ revision: revisionBeforeClear, debugEnabled: true });
                expect(await dispatch({ type: "no-more-ago:get-diagnostics-snapshot" }, optionsSender)).toEqual({ count: 1, response: { ok: false, error: "empty" } });
                const liveSource = diagnosticsDom.window.document.querySelector("relative-time");
                if (!liveSource) throw new Error("live diagnostic source missing");
                liveSource.setAttribute("datetime", "2026-08-23T10:16:00Z");
                await new Promise<void>((resolve) => setTimeout(resolve, 20));
                expect(diagnosticsStored).toBeDefined();
                liveSource.setAttribute("datetime", "2026-08-23T10:15:00Z");
                await new Promise<void>((resolve) => setTimeout(resolve, 20));
                expect(diagnosticsDom.window.document.querySelectorAll("time[data-no-more-ago-output]")).toHaveLength(2);

                failNextClick = true;
                for (let turn = 0; turn < 20 && findAction("Download logs").disabled; turn += 1) await new Promise<void>((resolve) => setImmediate(resolve));
                findAction("Download logs").click();
                for (let turn = 0; turn < 20 && downloadedBlobs.length < 2; turn += 1) await new Promise<void>((resolve) => setImmediate(resolve));
                expect(downloadedBlobs).toHaveLength(2);
                expect(successfulClicks).toBe(1);
                expect(validUrls.size).toBe(0);
                expect(revokedUrls).toHaveLength(2);
                expect(pendingRevocations).toHaveLength(1);
                for (let turn = 0; turn < 20 && !optionsDom.window.document.body.textContent?.includes("could not be downloaded"); turn += 1) await new Promise<void>((resolve) => setImmediate(resolve));
                expect(optionsDom.window.document.body.textContent).toContain("could not be downloaded");
                optionsDom.window.close();

                const debugOff = await dispatch({ type: "no-more-ago:set-debug-enabled", enabled: false });
                expect(debugOff).toMatchObject({ count: 1, response: { ok: true, state: { availability: "ready", enabled: false } } });
                expect(debugUpdates).toHaveLength(2);
                expect(debugUpdates[1]).toMatchObject({ message: { type: "no-more-ago:update-debug-policy", revision: 2, enabled: false }, options: { frameId: 0 } });
                const eventsBeforeDisable = emittedDiagnosticEvents;
                const afterDisable = diagnosticsDom.window.document.createElement("relative-time");
                afterDisable.setAttribute("datetime", "2026-08-25T12:17:00Z");
                diagnosticsDom.window.document.body.append(afterDisable);
                await new Promise<void>((resolve) => setTimeout(resolve, 20));
                expect(diagnosticsStored).toBeUndefined();
                expect(emittedDiagnosticEvents).toBe(eventsBeforeDisable);
                expect(diagnosticsDom.window.document.querySelectorAll("time[data-no-more-ago-output]")).toHaveLength(3);
                expect(diagnosticListenerCount).toBe(1);

                const activeCustom = await dispatch({ type: "no-more-ago:set-display-settings", display: { formatMode: "custom", pattern: "yyyy-MM-dd", timeZone: { mode: "iana", identifier: "America/New_York" } } });
                expect(activeCustom).toMatchObject({ count: 1, response: { ok: true, acceptedRevision: 3, refreshFailures: [] } });
                expect([...diagnosticsDom.window.document.querySelectorAll("time[data-no-more-ago-output]")].map((output) => output.textContent)).toEqual([
                    "2026-08-23", "2026-08-24", "2026-08-25"
                ]);
                const activeDebug = await dispatch({ type: "no-more-ago:set-debug-enabled", enabled: true });
                expect(activeDebug).toMatchObject({ count: 1, response: { ok: true, acceptedRevision: 4 } });
                await dispatch({ type: "no-more-ago:diagnostic-event", event: { category: "mutation", count: 1 } }, diagnosticSender);
                expect(diagnosticsStored).toBeDefined();
                await dispatch({ type: "no-more-ago:set-site-enabled", hostname: "managed-enabled.test", enabled: true, surface: "sites" });
                await dispatch({ type: "no-more-ago:set-site-enabled", hostname: "managed-disabled.test", enabled: false, surface: "sites" });
                if (mode === "release") await dispatch({ type: "no-more-ago:set-global-enabled", enabled: false });
                else await dispatch({ type: "no-more-ago:set-site-enabled", hostname: "github.com", enabled: false, surface: "sites" });
                expect(diagnosticsDom.window.document.querySelectorAll("time[data-no-more-ago-output]")).toHaveLength(0);
                expect(stored).toMatchObject({ debugEnabled: true, display: { formatMode: "custom", timeZone: { mode: "iana", identifier: "America/New_York" } }, sitePreferences: { "managed-enabled.test": true, "managed-disabled.test": false } });

                const resetDom = new JSDOM(readFileSync(`${directory}/options.html`, "utf8"), { runScripts: "outside-only", url: optionsUrl, pretendToBeVisual: true });
                Object.defineProperty(resetDom.window, "matchMedia", { value: () => ({ matches: false, media: "", onchange: null, addListener: () => undefined, removeListener: () => undefined, addEventListener: () => undefined, removeEventListener: () => undefined, dispatchEvent: () => false }) });
                Object.defineProperty(resetDom.window.navigator, "userAgent", { configurable: true, value: browserNavigator.userAgent });
                let confirmations = 0;
                Object.defineProperty(resetDom.window, "confirm", { value: () => { confirmations += 1; return true; } });
                const resetMessages: string[] = [];
                const resetResponses: unknown[] = [];
                let interruptNextResetResponse = false;
                const resetRuntime = {
                    getManifest: reportManifest,
                    sendMessage: (message: unknown) => new Promise<unknown>((resolve) => {
                        const type = message && typeof message === "object" && "type" in message ? String(message.type) : "unknown";
                        resetMessages.push(type);
                        onMessage.fire(message, optionsSender, (response: unknown) => {
                            if (type === "no-more-ago:reset-all-settings") {
                                resetResponses.push(response);
                                if (interruptNextResetResponse) { interruptNextResetResponse = false; resolve({ interrupted: true }); return; }
                            }
                            resolve(response);
                        });
                    })
                };
                vm.runInContext(readFileSync(`${directory}/options.js`, "utf8"), createCspDomContext(resetDom, { runtime: resetRuntime, tabs: reportTabs }));
                await new Promise<void>((resolve) => setTimeout(resolve, 70));
                expect(reportNavigations).toHaveLength(1);
                expect(reportQueries).toEqual([]);
                const resetButtons = [...resetDom.window.document.querySelectorAll("button")].filter((button) => button.textContent === "Reset all settings");
                expect(resetButtons).toHaveLength(1);
                const resetButton = resetButtons[0];
                if (!resetButton) throw new Error("Healthy Options reset action is missing");
                expect(resetDom.window.document.querySelector<HTMLSelectElement>('select[aria-label="Date format"]')?.value).toBe("custom");
                expect(resetDom.window.document.querySelector<HTMLSelectElement>('select[aria-label="Time zone"]')?.value).toBe("iana");
                expect(resetDom.window.document.querySelector<HTMLInputElement>('input[aria-label="Debug logs"]')?.checked).toBe(true);
                expect(resetDom.window.document.body.textContent).toContain("managed-enabled.test");
                expect(resetDom.window.document.body.textContent).toContain("managed-disabled.test");

                const preservedCurrent = structuredClone(stored);
                const preservedPrevious = structuredClone(previousStored);
                const preservedJournal = structuredClone(diagnosticsStored);
                const beforeHealthyResetWrites = storageSets;
                rejectNextSettingsWrite = true;
                resetButton.click();
                for (let turn = 0; turn < 40 && !resetDom.window.document.body.textContent?.includes("current settings remain active"); turn += 1) await new Promise<void>((resolve) => setImmediate(resolve));
                expect(resetResponses).toHaveLength(1);
                expect(resetResponses[0]).toMatchObject({ ok: false, error: "save-failed", state: { availability: "ready" } });
                expect(resetDom.window.document.body.textContent).toContain("current settings remain active");
                expect(stored).toEqual(preservedCurrent);
                expect(previousStored).toEqual(preservedPrevious);
                expect(diagnosticsStored).toEqual(preservedJournal);
                expect(storageSets).toBe(beforeHealthyResetWrites);
                expect(diagnosticsDom.window.document.querySelectorAll("time[data-no-more-ago-output]")).toHaveLength(0);

                const reportsBeforeActiveReset = emittedDiagnosticEvents;
                for (let turn = 0; turn < 20 && resetButton.disabled; turn += 1) await new Promise<void>((resolve) => setImmediate(resolve));
                resetButton.click();
                resetButton.click();
                for (let turn = 0; turn < 50 && resetDom.window.document.querySelector<HTMLInputElement>('input[aria-label="Debug logs"]')?.checked !== false; turn += 1) await new Promise<void>((resolve) => setImmediate(resolve));
                expect(resetResponses).toHaveLength(2);
                expect(resetResponses[1]).toMatchObject({ ok: true, acceptedRevision: 0, state: { availability: "ready", revision: 0, sites: [{ hostname: "github.com", enabled: true, hasAdapter: true }] } });
                expect(resetMessages.filter((message) => message === "no-more-ago:reset-all-settings")).toHaveLength(2);
                expect(resetMessages.filter((message) => message === "no-more-ago:get-display-state")).toHaveLength(2);
                expect(resetMessages.filter((message) => message === "no-more-ago:get-debug-state")).toHaveLength(2);
                expect(confirmations).toBe(0);
                expect(storageSets).toBe(beforeHealthyResetWrites + 1);
                expect(stored).toEqual(settingsV5(0, true));
                expect(previousStored).toEqual(stored);
                expect(diagnosticsStored).toBeUndefined();
                expect(resetDom.window.document.querySelector<HTMLSelectElement>('select[aria-label="Date format"]')?.value).toBe("system");
                expect(resetDom.window.document.querySelector<HTMLSelectElement>('select[aria-label="Time zone"]')?.value).toBe("system");
                expect(resetDom.window.document.querySelector<HTMLInputElement>('input[aria-label="Debug logs"]')?.checked).toBe(false);
                expect(resetDom.window.document.querySelector<HTMLInputElement>('input[aria-label="Enabled on github.com"]')?.checked).toBe(true);
                expect(resetDom.window.document.body.textContent).not.toContain("managed-enabled.test");
                expect(resetDom.window.document.body.textContent).not.toContain("managed-disabled.test");
                expect(resetDom.window.document.body.textContent).not.toContain("current settings remain active");
                const resetLogActions = [...resetDom.window.document.querySelectorAll("button")].filter((button) => button.textContent === "Download logs" || button.textContent === "Clear logs");
                expect(resetLogActions).toHaveLength(2);
                expect(resetLogActions.every((button) => button.disabled)).toBe(true);
                const resetReportAction = [...resetDom.window.document.querySelectorAll("button")].find((button) => button.textContent === "Open GitHub issue");
                if (!resetReportAction) throw new Error("Generic reporting is unavailable after resetting debug logs");
                expect(resetReportAction.disabled).toBe(false);
                const accessesBeforeDisabledReport = diagnosticsAccesses.length;
                const writesBeforeDisabledReport = storageSets;
                resetReportAction.click();
                for (let turn = 0; turn < 20 && reportNavigations.length < 2; turn += 1) await new Promise<void>((resolve) => setImmediate(resolve));
                expect(reportNavigations).toHaveLength(2);
                expect(reportQueries).toEqual([]);
                expect(diagnosticsAccesses).toHaveLength(accessesBeforeDisabledReport);
                expect(storageSets).toBe(writesBeforeDisabledReport);
                expect(Object.fromEntries(new URL(reportNavigations[1]?.url ?? "").searchParams)).toEqual({
                    template: "site-report.yml", extension_version: "0.1.0", browser: expectedReportBrowser
                });
                expect(diagnosticHydrationReads).toBe(2);
                expect(diagnosticListenerCount).toBe(1);
                const systemOutput = new Intl.DateTimeFormat(["en-US"], { dateStyle: "medium", timeStyle: "short" });
                expect([...diagnosticsDom.window.document.querySelectorAll("time[data-no-more-ago-output]")].map((output) => output.textContent)).toEqual([
                    systemOutput.format(new Date("2026-08-23T10:15:00Z")),
                    systemOutput.format(new Date("2026-08-24T11:16:00Z")),
                    systemOutput.format(new Date("2026-08-25T12:17:00Z"))
                ]);
                const afterReset = diagnosticsDom.window.document.createElement("relative-time");
                afterReset.setAttribute("datetime", "2026-08-26T13:18:00Z");
                diagnosticsDom.window.document.body.append(afterReset);
                await new Promise<void>((resolve) => setTimeout(resolve, 20));
                expect(emittedDiagnosticEvents).toBe(reportsBeforeActiveReset);
                expect(diagnosticsStored).toBeUndefined();
                const postResetOutputs = [...diagnosticsDom.window.document.querySelectorAll("time[data-no-more-ago-output]")];
                expect(postResetOutputs).toHaveLength(4);
                expect(postResetOutputs[3]?.textContent).toBe(systemOutput.format(new Date("2026-08-26T13:18:00Z")));
                expect(diagnosticListenerCount).toBe(1);

                const popupDom = new JSDOM(readFileSync(`${directory}/popup.html`, "utf8"), { runScripts: "outside-only", url: `${extensionOrigin}/popup.html`, pretendToBeVisual: true });
                Object.defineProperty(popupDom.window, "matchMedia", { value: () => ({ matches: false, media: "", onchange: null, addListener: () => undefined, removeListener: () => undefined, addEventListener: () => undefined, removeEventListener: () => undefined, dispatchEvent: () => false }) });
                Object.defineProperty(popupDom.window.navigator, "userAgent", { configurable: true, value: browserNavigator.userAgent });
                vm.runInContext(readFileSync(`${directory}/popup.js`, "utf8"), createCspDomContext(popupDom, {
                    tabs: reportTabs,
                    runtime: { getManifest: reportManifest, sendMessage: (message: unknown) => new Promise<unknown>((resolve) => { onMessage.fire(message, {}, resolve); }) }
                }));
                await new Promise<void>((resolve) => setTimeout(resolve, 55));
                expect(popupDom.window.document.body.textContent).toContain("Active on github.com");
                expect([...popupDom.window.document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].every((control) => control.checked)).toBe(true);
                expect(reportQueries).toEqual([]);
                expect(reportNavigations).toHaveLength(2);
                const popupReport = [...popupDom.window.document.querySelectorAll("button")].filter((button) => button.textContent === "Report this site");
                expect(popupReport).toHaveLength(1);
                const reportButton = popupReport[0];
                if (!reportButton) throw new Error("Popup reporting action missing");
                const diagnosticAccessesBeforeSiteReport = diagnosticsAccesses.length;
                const settingsWritesBeforeSiteReport = storageSets;
                reportButton.click();
                for (let turn = 0; turn < 20 && reportNavigations.length < 3; turn += 1) await new Promise<void>((resolve) => setImmediate(resolve));
                expect(reportQueries).toEqual([{ active: true, currentWindow: true }]);
                expect(reportCreateAttempts).toBe(3);
                expect(reportNavigations).toHaveLength(3);
                expect(diagnosticsAccesses).toHaveLength(diagnosticAccessesBeforeSiteReport);
                expect(storageSets).toBe(settingsWritesBeforeSiteReport);
                expect(Object.fromEntries(new URL(reportNavigations[2]?.url ?? "").searchParams)).toEqual({
                    template: "site-report.yml",
                    reason: "Dates are not working correctly",
                    hostname: "github.com",
                    current_url: "https://github.com/example/repo?filter=recent#comment",
                    extension_version: "0.1.0",
                    browser: expectedReportBrowser
                });

                reportTab = { url: "https://github.com/private/repository?view=issues#private", incognito: true, windowId: 41 };
                for (let turn = 0; turn < 20 && reportButton.disabled; turn += 1) await new Promise<void>((resolve) => setImmediate(resolve));
                reportButton.click();
                for (let turn = 0; turn < 20 && reportNavigations.length < 4; turn += 1) await new Promise<void>((resolve) => setImmediate(resolve));
                expect(reportNavigations[3]?.windowId).toBe(41);
                expect(new URL(reportNavigations[3]?.url ?? "").searchParams.get("current_url")).toBe("https://github.com/private/repository?view=issues#private");

                reportTab = { url: "https://github.com/private/repository", incognito: true };
                for (let turn = 0; turn < 20 && reportButton.disabled; turn += 1) await new Promise<void>((resolve) => setImmediate(resolve));
                reportButton.click();
                for (let turn = 0; turn < 20 && !popupDom.window.document.body.textContent?.includes("private window"); turn += 1) await new Promise<void>((resolve) => setImmediate(resolve));
                expect(reportNavigations).toHaveLength(4);
                expect(reportCreateAttempts).toBe(4);
                expect(popupDom.window.document.body.textContent).toContain("Could not safely open the report in this private window.");
                expect(popupDom.window.document.body.textContent).toContain("Active on github.com");
                popupDom.window.close();

                const noAdapterDom = new JSDOM(readFileSync(`${directory}/popup.html`, "utf8"), { runScripts: "outside-only", url: `${extensionOrigin}/popup.html`, pretendToBeVisual: true });
                Object.defineProperty(noAdapterDom.window, "matchMedia", { value: () => ({ matches: false, media: "", onchange: null, addListener: () => undefined, removeListener: () => undefined, addEventListener: () => undefined, removeEventListener: () => undefined, dispatchEvent: () => false }) });
                Object.defineProperty(noAdapterDom.window.navigator, "userAgent", { configurable: true, value: browserNavigator.userAgent });
                reportTab = { url: "https://news.example/articles/42?category=technology#comments", incognito: false };
                const noAdapterState = { availability: "ready", revision: 0, globalEnabled: false, hostname: "news.example", siteEnabled: false, hasAdapter: false, status: "global-disabled" };
                const queriesBeforeNoAdapterMount = reportQueries.length;
                vm.runInContext(readFileSync(`${directory}/popup.js`, "utf8"), createCspDomContext(noAdapterDom, {
                    tabs: reportTabs,
                    runtime: { getManifest: reportManifest, sendMessage: () => Promise.resolve(noAdapterState) }
                }));
                await new Promise<void>((resolve) => setTimeout(resolve, 55));
                expect(reportQueries).toHaveLength(queriesBeforeNoAdapterMount);
                expect(reportNavigations).toHaveLength(4);
                expect(noAdapterDom.window.document.body.textContent).toContain("Extension is off");
                const noAdapterReport = [...noAdapterDom.window.document.querySelectorAll("button")].find((button) => button.textContent === "Report this site");
                if (!noAdapterReport) throw new Error("Disabled no-adapter Popup report action missing");
                noAdapterReport.click();
                for (let turn = 0; turn < 20 && reportNavigations.length < 5; turn += 1) await new Promise<void>((resolve) => setImmediate(resolve));
                expect(Object.fromEntries(new URL(reportNavigations[4]?.url ?? "").searchParams)).toEqual({
                    template: "site-report.yml",
                    reason: "Add support for this site",
                    hostname: "news.example",
                    current_url: "https://news.example/articles/42?category=technology#comments",
                    extension_version: "0.1.0",
                    browser: expectedReportBrowser
                });

                rejectNextReportNavigation = true;
                for (let turn = 0; turn < 20 && noAdapterReport.disabled; turn += 1) await new Promise<void>((resolve) => setImmediate(resolve));
                noAdapterReport.click();
                for (let turn = 0; turn < 20 && !noAdapterDom.window.document.body.textContent?.includes("Could not open the GitHub report"); turn += 1) await new Promise<void>((resolve) => setImmediate(resolve));
                expect(reportCreateAttempts).toBe(6);
                expect(reportNavigations).toHaveLength(5);
                expect(noAdapterDom.window.document.body.textContent).toContain("Could not open the GitHub report. Try again.");
                expect(noAdapterDom.window.document.body.textContent).toContain("Extension is off");
                noAdapterDom.window.close();

                await dispatch({ type: "no-more-ago:set-site-enabled", hostname: "interrupted.test", enabled: true, surface: "sites" });
                const writesBeforeInterruptedReset = storageSets;
                interruptNextResetResponse = true;
                resetButton.click();
                const ambiguousResetNotice = "Could not confirm whether settings were reset. Reopen Settings to check their current state.";
                for (let turn = 0; turn < 40 && !resetDom.window.document.body.textContent?.includes(ambiguousResetNotice); turn += 1) await new Promise<void>((resolve) => setImmediate(resolve));
                expect(resetResponses).toHaveLength(3);
                expect(resetMessages.filter((message) => message === "no-more-ago:reset-all-settings")).toHaveLength(3);
                expect(storageSets).toBe(writesBeforeInterruptedReset + 1);
                expect(stored).toEqual(settingsV5(0, true));
                expect(previousStored).toEqual(stored);
                expect(resetDom.window.document.body.textContent).toContain(ambiguousResetNotice);
                expect(resetDom.window.document.body.textContent).not.toContain("current settings remain active");
                expect(resetDom.window.document.body.textContent).not.toContain("Processing remains disabled");
                expect(diagnosticsStored).toBeUndefined();
                const outputsAfterInterruptedReset = [...diagnosticsDom.window.document.querySelectorAll("time[data-no-more-ago-output]")];
                expect(outputsAfterInterruptedReset).toHaveLength(4);
                expect(outputsAfterInterruptedReset[3]?.textContent).toBe(systemOutput.format(new Date("2026-08-26T13:18:00Z")));
                expect(diagnosticListenerCount).toBe(1);

                const shippedSites = await dispatch({ type: "no-more-ago:get-sites-state" });
                expect(shippedSites).toEqual({
                    count: 1,
                    response: { availability: "ready", revision: 0, globalEnabled: true, sites: [{ hostname: "github.com", enabled: true, hasAdapter: true }] }
                });
                const injectionsBeforeForeignHost = executedContentTargets.length;
                activeTabUrl = "https://synthetic.test/example/events?filter=recent";
                const foreignPopup = await dispatch({ type: "no-more-ago:get-popup-state" });
                expect(foreignPopup).toMatchObject({
                    count: 1,
                    response: { availability: "ready", globalEnabled: true, hostname: "synthetic.test", siteEnabled: true, hasAdapter: false, status: "no-rules" }
                });
                activeTabUrl = "https://sub.github.com/example";
                expect(await dispatch({ type: "no-more-ago:get-popup-state" })).toMatchObject({
                    count: 1,
                    response: { availability: "ready", hostname: "sub.github.com", hasAdapter: false, status: "no-rules" }
                });
                activeTabUrl = "file:///private/synthetic.html";
                expect(await dispatch({ type: "no-more-ago:get-popup-state" })).toMatchObject({
                    count: 1,
                    response: { availability: "ready", hostname: null, hasAdapter: false, status: "inaccessible" }
                });
                activeTabUrl = "https://synthetic.test/example/events";
                const syntheticPreference = await dispatch({ type: "no-more-ago:set-site-enabled", hostname: "synthetic.test", enabled: false, surface: "sites" });
                expect(syntheticPreference).toMatchObject({
                    count: 1,
                    response: {
                        ok: true,
                        state: {
                            availability: "ready",
                            sites: [
                                { hostname: "github.com", enabled: true, hasAdapter: true },
                                { hostname: "synthetic.test", enabled: false, hasAdapter: false }
                            ]
                        }
                    }
                });
                expect(stored).toMatchObject({ sitePreferences: { "synthetic.test": false } });
                expect(executedContentTargets).toHaveLength(injectionsBeforeForeignHost);
                expect(requestedRegistrationIds.length).toBeGreaterThan(0);
                expect(requestedRegistrationIds.every((ids) => ids.length === 1 && ids[0] === "no-more-ago-github")).toBe(true);

                const unsupportedDom = new JSDOM('<time-ago class="synthetic-event" datetime="2026-08-23T10:15:00Z" title="2026-08-23T10:15:00Z">three hours ago</time-ago>', {
                    runScripts: "outside-only",
                    url: "https://synthetic.test/example/events"
                });
                Object.defineProperty(unsupportedDom.window.navigator, "languages", { configurable: true, value: ["en-US"] });
                let unsupportedListener: ((...args: unknown[]) => unknown) | undefined;
                const unsupportedRuntime = {
                    sendMessage: (message: unknown) => new Promise<unknown>((resolve) => { onMessage.fire(message, {}, resolve); }),
                    onMessage: { addListener: (listener: (...args: unknown[]) => unknown) => { unsupportedListener = listener; } }
                };
                const unsupportedContext = createCspDomContext(unsupportedDom, { runtime: unsupportedRuntime });
                vm.runInContext(readFileSync(`${directory}/content.js`, "utf8"), unsupportedContext);
                await new Promise<void>((resolve) => setTimeout(resolve, 20));
                unsupportedDom.window.document.dispatchEvent(new unsupportedDom.window.Event("DOMContentLoaded"));
                await new Promise<void>((resolve) => setTimeout(resolve, 20));
                expect(unsupportedListener?.({ type: "no-more-ago:status" }, {}, () => undefined)).toMatchObject({ phase: "active" });
                expect(unsupportedDom.window.document.querySelector("time[data-no-more-ago-output]")).toBeNull();
                const unsupportedSource = unsupportedDom.window.document.querySelector("time-ago");
                expect(unsupportedSource?.textContent).toBe("three hours ago");
                expect(unsupportedSource?.hasAttribute("hidden")).toBe(false);
                unsupportedDom.window.close();

                resetDom.window.close();
                diagnosticsDom.window.close();
            }
        } finally { removeWorkspace(workspace); }
    }, 300_000);

    it("boots every emitted popup under a local CSP-constrained VM and validates local-only HTML", async () => {
        const workspace = makeWorkspace();
        try {
            await execFileAsync(process.platform === "win32" ? "pnpm.cmd" : "pnpm", ["dev"], { cwd: workspace, timeout: 60_000 });
            await execFileAsync(process.platform === "win32" ? "pnpm.cmd" : "pnpm", ["release"], { cwd: workspace, timeout: 60_000 });
            for (const mode of ["dev", "release"] as const) for (const browser of browsers) {
                const directory = `${workspace}/dist/${mode}/${browser}`;
                const manifest = manifestFor(workspace, mode, browser);
                expect((manifest.action as Record<string, unknown>).default_popup).toBe("popup.html");
                expect(manifest.options_ui).toEqual({ page: "options.html", open_in_tab: true });
                const html = readFileSync(`${directory}/popup.html`, "utf8");
                const optionsHtml = readFileSync(`${directory}/options.html`, "utf8");
                expect(html).toMatch(/<script[^>]+src=["']popup\.js["']/);
                expect(html).toMatch(/<link[^>]+href=["']popup\.css["']/);
                expect(html).not.toMatch(/<script(?![^>]+\bsrc=)[^>]*>/i);
                expect(html).not.toMatch(/<style\b|\son[a-z]+\s*=/i);
                expect(optionsHtml).toMatch(/<script[^>]+src=["']options\.js["']/);
                expect(optionsHtml).toMatch(/<link[^>]+href=["']options\.css["']/);
                expect(optionsHtml).not.toMatch(/<script(?![^>]+\bsrc=)[^>]*>/i);
                expect(optionsHtml).not.toMatch(/<style\b|\son[a-z]+\s*=/i);
                const dom = new JSDOM(html, { runScripts: "outside-only", url: "https://github.com/example" });
                Object.defineProperty(dom.window, "matchMedia", { value: () => ({ matches: false, media: "", onchange: null, addListener: () => undefined, removeListener: () => undefined, addEventListener: () => undefined, removeEventListener: () => undefined, dispatchEvent: () => false }) });
                const context = createCspDomContext(dom, {
                    runtime: {
                        sendMessage: (message: unknown) => message && typeof message === "object" && "type" in message && message.type === "no-more-ago:get-sites-state"
                            ? Promise.resolve({ availability: "ready", revision: 4, globalEnabled: true, sites: [{ hostname: "github.com", enabled: true, hasAdapter: true }] })
                            : Promise.resolve({ availability: "ready", revision: 4, globalEnabled: true, hostname: "github.com", siteEnabled: true, hasAdapter: true, status: "active" })
                    }
                });
                expect(() => vm.runInContext("eval('1 + 1')", context)).toThrow(/disallowed/i);
                vm.runInContext(readFileSync(`${directory}/popup.js`, "utf8"), context);
                await new Promise<void>((resolve) => setTimeout(resolve, 50));
                expect(dom.window.document.body.textContent).toContain("github.com");
                expect(dom.window.document.body.textContent).toContain("Active on github.com");
                expect(dom.window.document.querySelector("input[type=checkbox]")).not.toBeNull();
                dom.window.close();

                const optionsDom = new JSDOM(optionsHtml, { runScripts: "outside-only", url: "chrome-extension://test/options.html" });
                Object.defineProperty(optionsDom.window, "matchMedia", { value: () => ({ matches: false, media: "", onchange: null, addListener: () => undefined, removeListener: () => undefined, addEventListener: () => undefined, removeEventListener: () => undefined, dispatchEvent: () => false }) });
                const optionsContext = createCspDomContext(optionsDom, {
                    runtime: {
                        sendMessage: (message: unknown) => {
                            if (message && typeof message === "object" && "type" in message && message.type === "no-more-ago:get-display-state") {
                                return Promise.resolve({ availability: "ready", revision: 4, display: { formatMode: "system", timeZone: { mode: "system" } }, debugEnabled: false });
                            }
                            if (message && typeof message === "object" && "type" in message && message.type === "no-more-ago:get-debug-state") {
                                return Promise.resolve({ availability: "ready", revision: 4, enabled: false });
                            }
                            return Promise.resolve({ availability: "ready", revision: 4, globalEnabled: true, sites: [{ hostname: "github.com", enabled: true, hasAdapter: true }] });
                        }
                    }
                });
                expect(() => vm.runInContext("eval('1 + 1')", optionsContext)).toThrow(/disallowed/i);
                vm.runInContext(readFileSync(`${directory}/options.js`, "utf8"), optionsContext);
                await new Promise<void>((resolve) => setTimeout(resolve, 50));
                expect(optionsDom.window.document.body.textContent).toContain("Sites");
                expect(optionsDom.window.document.body.textContent).toContain("github.com");
                expect(optionsDom.window.document.body.textContent).toContain("Display");
                expect(optionsDom.window.document.body.textContent).toContain("Debug logs");
                expect(optionsDom.window.document.querySelector<HTMLInputElement>('input[aria-label="Debug logs"]')?.checked).toBe(false);
                expect(optionsDom.window.document.body.textContent).toContain("Date format");
                expect(optionsDom.window.document.body.textContent).toContain("Custom format");
                expect(optionsDom.window.document.body.textContent).toContain("Time zone");
                expect(optionsDom.window.document.body.textContent).toContain("Save");
                optionsDom.window.close();
            }

            const copy = mkdtempSync(path.join(tmpdir(), "no-more-ago-popup-policy-"));
            try {
                cpSync(`${workspace}/dist/dev/chrome`, copy, { recursive: true });
                writeFileSync(`${copy}/popup.html`, readFileSync(`${copy}/popup.html`, "utf8").replace("popup.js", "https://remote.invalid/popup.js"));
                const services = createArtifactServices();
                expect(() => services.validatePair(copy, services.createZip(copy))).toThrow(/remote|executable/i);
                cpSync(`${workspace}/dist/dev/chrome`, copy, { recursive: true, force: true });
                writeFileSync(`${copy}/options.html`, readFileSync(`${copy}/options.html`, "utf8").replace("options.js", "https://remote.invalid/options.js"));
                expect(() => services.validatePair(copy, services.createZip(copy))).toThrow(/remote|executable/i);
            } finally { rmSync(copy, { recursive: true, force: true }); }
        } finally { removeWorkspace(workspace); }
    }, 240_000);
});

function createCspDomContext(dom: JSDOM, chrome: unknown): vm.Context {
    const sandbox: Record<string, unknown> = {};
    const blockedGlobals = new Set(["eval", "Function", "AsyncFunction", "GeneratorFunction", "AsyncGeneratorFunction", "WebAssembly", "window", "self", "globalThis"]);
    for (const name of Object.getOwnPropertyNames(dom.window)) {
        if (blockedGlobals.has(name)) continue;
        try { sandbox[name] = dom.window[name]; } catch { /* some host globals are intentionally unavailable */ }
    }
    sandbox.window = dom.window;
    sandbox.self = dom.window;
    sandbox.console = console;
    sandbox.TextEncoder = TextEncoder;
    sandbox.chrome = chrome;
    return vm.createContext(sandbox, { codeGeneration: { strings: false, wasm: false } });
}

function dosDates(zip: Buffer): Array<{ year: number; month: number; day: number }> {
    const dates: Array<{ year: number; month: number; day: number }> = [];
    for (let offset = 0; offset + 16 <= zip.length; offset += 1) if (zip.readUInt32LE(offset) === 0x02014b50) {
        const date = zip.readUInt16LE(offset + 14); dates.push({ year: 1980 + ((date >>> 9) & 0x7f), month: (date >>> 5) & 0x0f, day: date & 0x1f });
    }
    return dates;
}

function pngCrc32(buffer: Buffer): number { let crc = ~0; for (const byte of buffer) { crc ^= byte; for (let i = 0; i < 8; i += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); } return (~crc) >>> 0; }
function shellPng(size: number): Buffer {
    const signature = Buffer.from("89504e470d0a1a0a", "hex"); const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
    const chunk = (type: string, data: Buffer): Buffer => { const body = Buffer.concat([Buffer.from(type), data]); const result = Buffer.alloc(data.length + 12); result.writeUInt32BE(data.length, 0); data.copy(result, 4); result.writeUInt32BE(pngCrc32(body), data.length + 8); return result; };
    return Buffer.concat([signature, chunk("IHDR", ihdr), chunk("IEND", Buffer.alloc(0))]);
}

function pngDimensions(file: string): [number, number] { const bytes = readFileSync(file); return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)]; }
