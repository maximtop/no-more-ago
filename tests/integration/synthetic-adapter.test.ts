/**
 * @file Exercises adapter extensibility through a synthetic-site integration flow.
 */

/* eslint-disable @typescript-eslint/require-await */
import { readFileSync } from "node:fs";

import { describe, expect, it, vi, type Mock } from "vitest";

import { BackgroundApplication } from "../../src/background/application";
import { installContentRuntime } from "../../src/content/runtime";
import {
    DocumentTransformationController,
} from "../../src/core/document-transformation-controller";
import { processDocument } from "../../src/core/process-document";
import { DIAGNOSTICS_STORAGE_KEY, DiagnosticJournal } from "../../src/diagnostics/journal";
import { AdapterActivationCoordinator } from "../../src/runtime/adapter-activation";
import { TEARDOWN_DOCUMENT_MESSAGE } from "../../src/runtime/messages";
import { githubRuntimeDefinition } from "../../src/runtime/register-github";
import type { RegisteredContentScriptSpec } from "../../src/runtime/scripting";
import { SettingsService } from "../../src/settings/settings-service";
import {
    createSettingsSnapshot,
    isSettingsSnapshotV5,
    SETTINGS_PREVIOUS_STORAGE_KEY,
    SETTINGS_STORAGE_KEY,
    type DisplaySettings,
    type SettingsSnapshotV5,
} from "../../src/settings/snapshot";
import {
    createSyntheticRegistry,
    SYNTHETIC_HOSTNAME,
    syntheticRuntimeDefinition,
} from "../fixtures/synthetic/adapter";

/**
 * Content-runtime message listener retained for one simulated browser tab.
 */
type Listener = (
    message: unknown,
    sender?: unknown,
    sendResponse?: (response: unknown) => void,
) => unknown;

const SYNTHETIC_FIXTURE = readFileSync("tests/fixtures/synthetic/site.html", "utf8");
const SYNTHETIC_URL = "https://synthetic.test/activity?private=secret#fragment";
const PRIMARY_INSTANT = "2026-08-25T10:15:00Z";
const CUSTOM_UTC: DisplaySettings = {
    formatMode: "custom",
    pattern: "yyyy-MM-dd HH:mm 'UTC'",
    timeZone: { mode: "utc" },
};

/**
 * Creates a ready document populated from the synthetic site fixture.
 *
 * @returns - Ready synthetic-site document.
 */
function syntheticDocument(): Document {
    const page = document.implementation.createHTMLDocument("Synthetic activity");
    Object.defineProperty(page, "defaultView", { configurable: true, value: window });
    Object.defineProperty(page, "readyState", { configurable: true, value: "complete" });
    page.body.innerHTML = SYNTHETIC_FIXTURE;
    return page;
}

/**
 * Finds the authoritative synthetic timestamp source.
 *
 * @param page - Synthetic fixture document.
 * @returns - Trusted source element.
 */
function source(page: Document): Element {
    const current = page.querySelector("time-ago.synthetic-event");
    if (!current) {
        throw new Error("Synthetic authoritative source missing");
    }
    return current;
}

/**
 * Collects generated exact-time output elements in a document.
 *
 * @param page - Document to inspect.
 * @returns - Current extension-owned output elements.
 */
function outputs(page: Document): HTMLTimeElement[] {
    return [...page.querySelectorAll<HTMLTimeElement>("time[data-no-more-ago-output]")];
}

/**
 * Drains the bounded sequence of microtasks used by mutation reconciliation.
 */
async function settleMutations(): Promise<void> {
    for (let turn = 0; turn < 6; turn += 1) {
        await Promise.resolve();
    }
}

/**
 * Creates connected GitHub and synthetic runtimes over shared background services.
 *
 * @returns - Cross-site runtime fixture and observable test controls.
 */
function createConnectedFixture() {
    let stored: SettingsSnapshotV5 = createSettingsSnapshot(0, true);
    let previous: SettingsSnapshotV5 = createSettingsSnapshot(0, true);
    let diagnostics: unknown;
    let rejectDiagnosticWrite = false;
    const registrations = new Map<string, RegisteredContentScriptSpec>();
    const listeners = new Map<number, Listener>();
    const additions = new Map<number, Mock<(listener: Listener) => void>>();
    const hydrations = new Map<number, Mock<() => Promise<unknown>>>();
    const reports = vi.fn<(event: Record<string, unknown>, tabId: number) => void>();
    const syntheticPage = syntheticDocument();
    const githubPage = document.implementation.createHTMLDocument("GitHub activity");
    Object.defineProperty(githubPage, "defaultView", { configurable: true, value: window });
    Object.defineProperty(githubPage, "readyState", { configurable: true, value: "complete" });
    githubPage.body.innerHTML =
        '<relative-time datetime="2026-08-23T10:15:00Z">GitHub relative text</relative-time>';
    const pages = new Map<number, Document>([
        [11, githubPage],
        [21, syntheticPage],
    ]);
    const browserTabs = [
        { id: 11, url: "https://github.com/example/repository" },
        { id: 21, url: SYNTHETIC_URL },
    ] as const;
    const registry = createSyntheticRegistry();

    const storage = {
        get: vi.fn(async (keys?: string | readonly string[] | Record<string, unknown>) => {
            if (keys === DIAGNOSTICS_STORAGE_KEY) {
                return diagnostics === undefined ? {} : { [DIAGNOSTICS_STORAGE_KEY]: diagnostics };
            }
            return { [SETTINGS_STORAGE_KEY]: stored, [SETTINGS_PREVIOUS_STORAGE_KEY]: previous };
        }),
        set: vi.fn(async (items: Record<string, unknown>) => {
            if (Object.hasOwn(items, DIAGNOSTICS_STORAGE_KEY)) {
                if (rejectDiagnosticWrite) {
                    rejectDiagnosticWrite = false;
                    throw new Error("diagnostic storage unavailable");
                }
                diagnostics = items[DIAGNOSTICS_STORAGE_KEY];
                return;
            }
            const next = items[SETTINGS_STORAGE_KEY];
            const old = items[SETTINGS_PREVIOUS_STORAGE_KEY];
            if (!isSettingsSnapshotV5(next) || !isSettingsSnapshotV5(old)) {
                throw new Error("Atomic settings snapshot required");
            }
            stored = next;
            previous = old;
        }),
        remove: vi.fn(async (keys: string | readonly string[]) => {
            if (
                keys === DIAGNOSTICS_STORAGE_KEY ||
                (Array.isArray(keys) && keys.includes(DIAGNOSTICS_STORAGE_KEY))
            ) {
                diagnostics = undefined;
            }
        }),
    };

    const tabs = {
        query: vi.fn(
            async (query: { readonly active?: boolean; readonly url?: readonly string[] }) => {
                if (query.active) {
                    return [browserTabs[1]];
                }
                if (!query.url) {
                    return [];
                }
                return browserTabs.filter((tab) =>
                    query.url?.some((pattern) => pattern.includes(`${new URL(tab.url).hostname}/`)),
                );
            },
        ),
        sendMessage: vi.fn(
            async (tabId: number, message: unknown, options: { readonly frameId: 0 }) => {
                expect(options).toEqual({ frameId: 0 });
                const listener = listeners.get(tabId);
                if (!listener) {
                    throw new Error("Content runtime not installed");
                }
                let response: unknown;
                const result = listener(message, undefined, (value) => {
                    response = value;
                });
                return response ?? result;
            },
        ),
    };

    const scripting = {
        getRegisteredContentScripts: vi.fn(async ({ ids }: { readonly ids: readonly string[] }) =>
            ids.flatMap((id) => {
                const registration = registrations.get(id);
                return registration === undefined ? [] : [registration];
            }),
        ),
        registerContentScripts: vi.fn(async (scripts: readonly RegisteredContentScriptSpec[]) => {
            for (const script of scripts) {
                registrations.set(script.id, script);
            }
        }),
        updateContentScripts: vi.fn(async (scripts: readonly RegisteredContentScriptSpec[]) => {
            for (const script of scripts) {
                registrations.set(script.id, script);
            }
        }),
        unregisterContentScripts: vi.fn(async ({ ids }: { readonly ids: readonly string[] }) => {
            for (const id of ids) {
                registrations.delete(id);
            }
        }),
        executeScript: vi.fn(
            async ({
                target,
            }: {
                readonly target: { readonly tabId: number; readonly allFrames: false };
            }) => {
                const page = pages.get(target.tabId);
                const browserTab = browserTabs.find((tab) => tab.id === target.tabId);
                if (!page || !browserTab) {
                    throw new Error("Unknown browser tab");
                }
                const listener =
                    additions.get(target.tabId) ??
                    vi.fn<(next: Listener) => void>((next) => {
                        listeners.set(target.tabId, next);
                    });
                additions.set(target.tabId, listener);
                const load =
                    hydrations.get(target.tabId) ??
                    vi.fn<() => Promise<unknown>>(() => app.getDisplayState());
                hydrations.set(target.tabId, load);
                installContentRuntime({
                    document: page,
                    url: new URL(browserTab.url),
                    locales: ["en-US"],
                    registry,
                    loadDisplayState: load,
                    reportDiagnostic: (event) => {
                        reports(event, target.tabId);
                        return app.recordDocumentEvent(event, {
                            url: browserTab.url,
                            frameId: 0,
                            tab: { incognito: target.tabId === 21 },
                        });
                    },
                    messages: { onMessage: { addListener: listener } },
                });
            },
        ),
    };

    const definitions = [githubRuntimeDefinition, syntheticRuntimeDefinition];
    const coordinator = new AdapterActivationCoordinator({
        adapters: definitions,
        scripting,
        tabs,
    });
    const journal = new DiagnosticJournal(storage);
    const app = new BackgroundApplication({
        settings: new SettingsService(storage),
        coordinator,
        tabs,
        adapters: definitions,
        journal,
        diagnosticEnvironment: { extensionVersion: "0.1.0", browserFamily: "chromium" },
    });

    /**
     * Waits for content hydration and mutation reconciliation to settle.
     */
    async function settle(): Promise<void> {
        await Promise.all(
            [...hydrations.values()].flatMap((load) =>
                load.mock.results.map((result) => result.value as Promise<unknown>),
            ),
        );
        await settleMutations();
    }

    /**
     * Sends teardown to every simulated document runtime.
     */
    function teardown(): void {
        for (const listener of listeners.values()) {
            listener({ type: TEARDOWN_DOCUMENT_MESSAGE });
        }
    }

    return {
        app,
        storage,
        tabs,
        scripting,
        registrations,
        additions,
        hydrations,
        reports,
        githubPage,
        syntheticPage,
        settle,
        teardown,
        rejectNextDiagnosticWrite: () => {
            rejectDiagnosticWrite = true;
        },
        get stored() {
            return stored;
        },
        get previous() {
            return previous;
        },
        get diagnostics() {
            return diagnostics;
        },
    };
}

describe("synthetic adapter through shared document processing", () => {
    it.each(["en-US", "de-DE"])(
        "uses the existing localized System formatter and semantic ownership for %s",
        (locale) => {
            const page = syntheticDocument();
            const result = processDocument({
                url: new URL(SYNTHETIC_URL),
                root: page,
                locales: [locale],
                registry: createSyntheticRegistry(),
            });
            expect(result).toHaveLength(2);
            expect(outputs(page)).toHaveLength(2);
            expect(source(page).hasAttribute("hidden")).toBe(true);
            expect(source(page).textContent).toBe("2 hours ago");
            expect(result[0]?.dateTime).toBe(PRIMARY_INSTANT);
            expect(result[0]?.textContent).toBe(
                new Intl.DateTimeFormat([locale], {
                    dateStyle: "medium",
                    timeStyle: "short",
                }).format(new Date(PRIMARY_INSTANT)),
            );
            expect(page.querySelector("#missing-datetime")?.hasAttribute("hidden")).toBe(false);
            expect(page.querySelector("#relative-datetime")?.hasAttribute("hidden")).toBe(false);
            expect(page.querySelector("#ambiguous-datetime")?.hasAttribute("hidden")).toBe(false);
            expect(page.querySelector("time-ago:not([class])")?.hasAttribute("hidden")).toBe(false);
        },
    );

    it("uses the shared custom UTC presentation without parsing undeclared metadata", () => {
        const page = syntheticDocument();
        const result = processDocument({
            url: new URL(SYNTHETIC_URL),
            root: page,
            locales: ["en-US"],
            display: CUSTOM_UTC,
            registry: createSyntheticRegistry(),
        });
        expect(result.map((output) => output.textContent)).toEqual([
            "2026-08-25 10:15 UTC",
            "2026-08-24 08:15 UTC",
        ]);
        expect(page.querySelector("[data-datetime]")?.textContent).toMatch(
            /metadata only|relative text only/u,
        );
        expect(
            page.querySelectorAll('time[data-no-more-ago-output][datetime="2026-08-25T10:15:00Z"]'),
        ).toHaveLength(1);
    });

    it("reuses one observer for additions, changes, invalidation, and restoration", async () => {
        const page = syntheticDocument();
        const observe = vi.spyOn(MutationObserver.prototype, "observe");
        const events: unknown[] = [];
        const controller = new DocumentTransformationController({
            url: new URL(SYNTHETIC_URL),
            root: page,
            locales: ["en-US"],
            display: CUSTOM_UTC,
            registry: createSyntheticRegistry(),
            diagnosticSink: (event) => {
                events.push(event);
            },
        });
        try {
            const first = controller.start();
            expect(controller.start()).toBe(first);
            expect(observe).toHaveBeenCalledTimes(1);
            expect(observe.mock.calls[0]?.[1]).toMatchObject({ attributeFilter: ["datetime"] });
            expect(outputs(page)).toHaveLength(2);

            const beforeUnrelated = events.length;
            source(page).setAttribute("title", "2026-08-31T00:00:00Z");
            source(page).setAttribute("aria-label", "2026-08-31T00:00:00Z");
            source(page).setAttribute("data-datetime", "2026-08-31T00:00:00Z");
            await settleMutations();
            expect(events).toHaveLength(beforeUnrelated);
            expect(outputs(page)[0]?.textContent).toBe("2026-08-25 10:15 UTC");

            const region = page.createElement("section");
            region.innerHTML = '<time-ago class="synthetic-event" '
                + 'datetime="2026-08-26T11:16:00Z">new relative activity</time-ago>';
            page.body.append(region);
            await settleMutations();
            expect(outputs(page)).toHaveLength(3);
            expect(outputs(page)[2]?.textContent).toBe("2026-08-26 11:16 UTC");

            const primary = source(page);
            primary.setAttribute("datetime", "2026-08-27T12:17:00Z");
            await settleMutations();
            expect(outputs(page)[0]?.textContent).toBe("2026-08-27 12:17 UTC");

            primary.setAttribute("datetime", "yesterday");
            await settleMutations();
            expect(outputs(page)).toHaveLength(2);
            expect(primary.hasAttribute("hidden")).toBe(false);
            expect(primary.textContent).toBe("2 hours ago");

            primary.setAttribute("datetime", "2026-08-28T13:18:00Z");
            await settleMutations();
            expect(outputs(page)).toHaveLength(3);
            expect(primary.hasAttribute("hidden")).toBe(true);
            const removed = region.querySelector("time-ago");
            region.remove();
            await settleMutations();
            expect(outputs(page)).toHaveLength(2);
            expect(region.querySelector("time[data-no-more-ago-output]")).toBeNull();
            expect(removed?.hasAttribute("hidden")).toBe(false);
            expect(observe).toHaveBeenCalledTimes(1);
            controller.teardown();
            expect(outputs(page)).toHaveLength(0);
            expect(primary.hasAttribute("hidden")).toBe(false);
        } finally {
            controller.teardown();
            observe.mockRestore();
        }
    });
});

describe("synthetic adapter through real settings, activation, diagnostics, and content", () => {
    it("registers adapters, activates documents, and exposes synthetic policy", async () => {
        const fixture = createConnectedFixture();
        try {
            await fixture.app.ensureReady("startup");
            await fixture.settle();
            expect([...fixture.registrations.keys()].sort()).toEqual([
                "no-more-ago-github",
                "no-more-ago-synthetic",
            ]);
            expect(fixture.registrations.get("no-more-ago-synthetic")?.matches).toEqual([
                "http://synthetic.test/*",
                "https://synthetic.test/*",
            ]);
            expect(outputs(fixture.githubPage)).toHaveLength(1);
            expect(outputs(fixture.syntheticPage)).toHaveLength(2);
            expect(fixture.additions.get(11)).toHaveBeenCalledTimes(1);
            expect(fixture.additions.get(21)).toHaveBeenCalledTimes(1);
            await expect(fixture.app.getPopupState()).resolves.toMatchObject({
                availability: "ready",
                hostname: SYNTHETIC_HOSTNAME,
                hasAdapter: true,
                siteEnabled: true,
                status: "active",
            });
            await expect(fixture.app.getSitesState()).resolves.toMatchObject({
                availability: "ready",
                sites: [
                    { hostname: "github.com", enabled: true, hasAdapter: true },
                    { hostname: SYNTHETIC_HOSTNAME, enabled: true, hasAdapter: true },
                ],
            });
            expect(fixture.diagnostics).toBeUndefined();
        } finally {
            fixture.teardown();
        }
    });

    it("applies custom UTC settings to existing and future synthetic sources", async () => {
        const fixture = createConnectedFixture();
        try {
            await fixture.app.ensureReady("startup");
            await fixture.settle();
            await expect(fixture.app.setDisplaySettings(CUSTOM_UTC)).resolves.toMatchObject({
                ok: true,
                acceptedRevision: 1,
                refreshFailures: [],
            });
            expect(outputs(fixture.syntheticPage).map((output) => output.textContent)).toEqual([
                "2026-08-25 10:15 UTC",
                "2026-08-24 08:15 UTC",
            ]);
            expect(outputs(fixture.githubPage)[0]?.textContent).toBe("2026-08-23 10:15 UTC");
            expect(fixture.stored.display).toEqual(CUSTOM_UTC);
            expect(fixture.previous.revision).toBe(0);
            const future = fixture.syntheticPage.createElement("time-ago");
            future.className = "synthetic-event";
            future.setAttribute("datetime", "2026-08-29T14:19:00+02:00");
            future.textContent = "future relative content";
            fixture.syntheticPage.body.append(future);
            await settleMutations();
            expect(outputs(fixture.syntheticPage)[2]?.textContent).toBe("2026-08-29 12:19 UTC");
            expect(fixture.additions.get(21)).toHaveBeenCalledTimes(1);
        } finally {
            fixture.teardown();
        }
    });

    it.each(["site", "global"] as const)(
        "restores exact originals on %s disable and rehydrates the same runtime on enable",
        async (policy) => {
            const fixture = createConnectedFixture();
            try {
                await fixture.app.ensureReady("startup");
                await fixture.settle();
                expect(outputs(fixture.syntheticPage)).toHaveLength(2);
                if (policy === "site") {
                    await fixture.app.setSiteEnabled(SYNTHETIC_HOSTNAME, false, "popup");
                } else {
                    await fixture.app.setGlobalEnabled(false);
                }
                expect(outputs(fixture.syntheticPage)).toHaveLength(0);
                expect(source(fixture.syntheticPage).hasAttribute("hidden")).toBe(false);
                expect(source(fixture.syntheticPage).textContent).toBe("2 hours ago");
                expect(outputs(fixture.githubPage)).toHaveLength(policy === "site" ? 1 : 0);
                if (policy === "site") {
                    await fixture.app.setSiteEnabled(SYNTHETIC_HOSTNAME, true, "popup");
                } else {
                    await fixture.app.setGlobalEnabled(true);
                }
                await fixture.settle();
                expect(outputs(fixture.syntheticPage)).toHaveLength(2);
                expect(outputs(fixture.githubPage)).toHaveLength(1);
                expect(fixture.additions.get(21)).toHaveBeenCalledTimes(1);
                expect(fixture.hydrations.get(21)).toHaveBeenCalledTimes(2);
            } finally {
                fixture.teardown();
            }
        },
    );

    it("collects opted-in synthetic diagnostics and isolates journal failures", async () => {
        const fixture = createConnectedFixture();
        try {
            await fixture.app.ensureReady("startup");
            await fixture.settle();
            const primary = source(fixture.syntheticPage);
            primary.setAttribute("datetime", "2026-08-26T11:16:00Z");
            await settleMutations();
            expect(fixture.reports).not.toHaveBeenCalled();
            expect(fixture.diagnostics).toBeUndefined();

            await expect(fixture.app.setDebugEnabled(true)).resolves.toMatchObject({
                ok: true,
                acceptedRevision: 1,
                state: { enabled: true },
            });
            const dynamic = fixture.syntheticPage.createElement("time-ago");
            dynamic.className = "synthetic-event";
            dynamic.setAttribute("datetime", "2026-08-27T12:17:00Z");
            dynamic.textContent = "sensitive synthetic document content";
            fixture.syntheticPage.body.append(dynamic);
            await settleMutations();
            const snapshot = await fixture.app.getDiagnosticsSnapshot();
            if (!snapshot.ok) {
                throw new Error(`Synthetic diagnostic snapshot unavailable: ${snapshot.error}`);
            }
            expect(snapshot.snapshot.environment).toEqual({
                extensionVersion: "0.1.0",
                browserFamily: "chromium",
            });
            expect(
                snapshot.snapshot.entries.some(
                    (event) =>
                        event.hostname === SYNTHETIC_HOSTNAME &&
                        event.incognito &&
                        event.extensionVersion === "0.1.0" &&
                        event.browserFamily === "chromium",
                ),
            ).toBe(true);
            const sensitiveData = new RegExp(
                [
                    "private=secret",
                    "fragment",
                    "2026-08-27",
                    "sensitive synthetic document content",
                    "synthetic\\.test/activity",
                ].join("|"),
                "u",
            );
            expect(JSON.stringify(fixture.diagnostics)).not.toMatch(sensitiveData);

            fixture.rejectNextDiagnosticWrite();
            primary.setAttribute("datetime", "2026-08-28T13:18:00Z");
            await settleMutations();
            expect(outputs(fixture.syntheticPage)[0]?.dateTime).toBe("2026-08-28T13:18:00Z");
            expect(fixture.additions.get(21)).toHaveBeenCalledTimes(1);
            await expect(fixture.app.setDebugEnabled(false)).resolves.toMatchObject({
                ok: true,
                state: { enabled: false },
            });
            expect(fixture.diagnostics).toBeUndefined();
            fixture.reports.mockClear();
            dynamic.setAttribute("datetime", "2026-08-29T14:19:00Z");
            await settleMutations();
            expect(fixture.reports).not.toHaveBeenCalled();
            expect(fixture.diagnostics).toBeUndefined();
            expect(outputs(fixture.syntheticPage)).toHaveLength(3);
        } finally {
            fixture.teardown();
        }
    });
});
