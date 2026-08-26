/* eslint-disable @typescript-eslint/require-await */
import { describe, expect, it, vi, type Mock } from "vitest";

import { BackgroundApplication } from "../../src/background/application";
import { installContentRuntime } from "../../src/content/runtime";
import { DIAGNOSTICS_MAX_BYTES, DIAGNOSTICS_STORAGE_KEY, DiagnosticJournal } from "../../src/diagnostics/journal";
import { AdapterActivationCoordinator, type RuntimeAdapterDefinition } from "../../src/runtime/adapter-activation";
import { DEBUG_POLICY_UPDATED_MESSAGE, PRESENTATION_UPDATED_MESSAGE, TEARDOWN_DOCUMENT_MESSAGE, UPDATE_DEBUG_POLICY_MESSAGE, UPDATE_PRESENTATION_MESSAGE } from "../../src/runtime/messages";
import type { RegisteredContentScriptSpec } from "../../src/runtime/scripting";
import { SettingsService } from "../../src/settings/settings-service";
import { createSettingsSnapshot, DEFAULT_SETTINGS_SNAPSHOT, isSettingsSnapshotV5, SETTINGS_PREVIOUS_STORAGE_KEY, SETTINGS_STORAGE_KEY, type DisplaySettings, type SettingsSnapshotV5 } from "../../src/settings/snapshot";

type Listener = (message: unknown, sender?: unknown, sendResponse?: (response: unknown) => void) => unknown;

const SOURCE_INSTANT = "2026-08-23T10:15:00Z";
const NEW_YORK: DisplaySettings = { formatMode: "system", timeZone: { mode: "iana", identifier: "America/New_York" } };
const UTC: DisplaySettings = { formatMode: "system", timeZone: { mode: "utc" } };
const CUSTOM_NEW_YORK: DisplaySettings = { formatMode: "custom", pattern: "yyyy-MM-dd HH:mm XXX", timeZone: { mode: "iana", identifier: "America/New_York" } };
const CUSTOM_UTC: DisplaySettings = { formatMode: "custom", pattern: "EEEE, d MMMM yyyy HH:mm 'UTC'", timeZone: { mode: "utc" } };

const adapter: RuntimeAdapterDefinition = {
    id: "github",
    hostname: "github.com",
    registration: {
        id: "github",
        matches: ["https://github.com/*"],
        js: ["content.js"],
        runAt: "document_start",
        allFrames: false,
        persistAcrossSessions: true
    },
    matches: (url) => url.hostname === "github.com"
};

function createDocument(label: string): Document {
    const result = document.implementation.createHTMLDocument(label);
    Object.defineProperty(result, "defaultView", { configurable: true, value: window });
    Object.defineProperty(result, "readyState", { configurable: true, value: "complete" });
    result.body.innerHTML = `<relative-time datetime="${SOURCE_INSTANT}">${label} relative</relative-time>`;
    return result;
}

function expected(timeZone: string): string {
    return new Intl.DateTimeFormat(["en-US"], { dateStyle: "medium", timeStyle: "short", timeZone }).format(new Date(SOURCE_INSTANT));
}

function integrationFixture(initialDisplay: DisplaySettings = NEW_YORK) {
    let stored: SettingsSnapshotV5 = createSettingsSnapshot(3, true, {}, initialDisplay);
    let storedPrevious: SettingsSnapshotV5 = createSettingsSnapshot(2, true, {}, initialDisplay);
    let diagnostics: unknown;
    let failNextSet = false;
    let failNextDiagnosticSet = false;
    let failNextDiagnosticGet = false;
    let failNextDiagnosticRemove = false;
    const listenerByTab = new Map<number, Listener>();
    const registrations = new Map<string, RegisteredContentScriptSpec>();
    const documents = new Map<number, Document>([[11, createDocument("first")], [12, createDocument("second")]]);
    const additions = new Map<number, Mock<(listener: Listener) => void>>();
    const hydration = new Map<number, Mock<() => Promise<unknown>>>();
    const diagnosticReports = vi.fn<(event: Record<string, unknown>, tabId: number) => void>();
    const diagnosticEnvironment = { extensionVersion: "0.1.0", browserFamily: "chromium" as const };

    const storage = {
        get: vi.fn(async (keys?: string | readonly string[] | Record<string, unknown>) => {
            if (keys === DIAGNOSTICS_STORAGE_KEY) {
                if (failNextDiagnosticGet) {
                    failNextDiagnosticGet = false; throw new Error("diagnostics unreadable");
                }
                return diagnostics === undefined ? {} : { [DIAGNOSTICS_STORAGE_KEY]: diagnostics };
            }
            return { [SETTINGS_STORAGE_KEY]: stored, [SETTINGS_PREVIOUS_STORAGE_KEY]: storedPrevious };
        }),
        set: vi.fn(async (items: Record<string, unknown>) => {
            if (Object.hasOwn(items, DIAGNOSTICS_STORAGE_KEY)) {
                if (failNextDiagnosticSet) {
                    failNextDiagnosticSet = false; throw new Error("diagnostics unavailable");
                }
                diagnostics = items[DIAGNOSTICS_STORAGE_KEY];
                return;
            }
            const candidate = items[SETTINGS_STORAGE_KEY];
            const previous = items[SETTINGS_PREVIOUS_STORAGE_KEY];
            if (failNextSet) {
                failNextSet = false; throw new Error("disk full");
            }
            if (!isSettingsSnapshotV5(candidate) || !isSettingsSnapshotV5(previous)) {
                throw new Error("Invalid settings pair");
            }
            stored = candidate;
            storedPrevious = previous;
        }),
        remove: vi.fn(async (keys: string | readonly string[]) => {
            if (keys === DIAGNOSTICS_STORAGE_KEY || (Array.isArray(keys) && keys.includes(DIAGNOSTICS_STORAGE_KEY))) {
                if (failNextDiagnosticRemove) {
                    failNextDiagnosticRemove = false; throw new Error("diagnostics removal unavailable");
                }
                diagnostics = undefined;
            }
        })
    };

    const tabs = {
        query: vi.fn(async (query: { readonly active?: boolean; readonly url?: readonly string[] }) => {
            if (query.active) {
                return [{ id: 11, url: "https://github.com/one" }];
            }
            if (query.url) {
                return [{ id: 11, url: "https://github.com/one" }, { id: 12, url: "https://github.com/two" }];
            }
            return [];
        }),
        sendMessage: vi.fn(async (tabId: number, message: unknown, options: { readonly frameId: 0 }) => {
            expect(options).toEqual({ frameId: 0 });
            const listener = listenerByTab.get(tabId);
            if (!listener) {
                throw new Error("Document runtime is not installed");
            }
            let callbackResponse: unknown;
            const directResponse = listener(message, undefined, (response) => {
                callbackResponse = response;
            });
            return callbackResponse ?? directResponse;
        })
    };

    const scripting = {
        getRegisteredContentScripts: vi.fn(async ({ ids }: { readonly ids: readonly string[] }) =>
            ids.flatMap((id) => {
                const registration = registrations.get(id);
                return registration === undefined ? [] : [registration];
            })
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
        executeScript: vi.fn(async ({ target }: { readonly target: { readonly tabId: number; readonly allFrames: false } }) => {
            const page = documents.get(target.tabId);
            if (!page) {
                throw new Error("Unknown document");
            }
            const addListener = additions.get(target.tabId) ?? vi.fn<(listener: Listener) => void>((listener) => {
                listenerByTab.set(target.tabId, listener);
            });
            additions.set(target.tabId, addListener);
            const load = hydration.get(target.tabId) ?? vi.fn<() => Promise<unknown>>(() => currentApplication.getDisplayState());
            hydration.set(target.tabId, load);
            installContentRuntime({
                document: page,
                url: new URL(`https://github.com/${String(target.tabId)}`),
                locales: ["en-US"],
                loadDisplayState: load,
                reportDiagnostic: (event) => {
                    diagnosticReports(event, target.tabId);
                    return currentApplication.recordDocumentEvent(event, {
                        url: `https://github.com/example/repository/issues/${String(target.tabId)}?private=secret#fragment`,
                        frameId: 0,
                        tab: { incognito: target.tabId === 12 }
                    });
                },
                messages: { onMessage: { addListener } }
            });
        })
    };

    const coordinator = new AdapterActivationCoordinator({ adapters: [adapter], scripting, tabs });
    const application = new BackgroundApplication({ settings: new SettingsService(storage), coordinator, tabs, adapters: [adapter], journal: new DiagnosticJournal(storage), diagnosticEnvironment });
    let currentApplication = application;

    function restart(): BackgroundApplication {
        currentApplication = new BackgroundApplication({ settings: new SettingsService(storage), coordinator, tabs, adapters: [adapter], journal: new DiagnosticJournal(storage), diagnosticEnvironment });
        return currentApplication;
    }

    async function settle(): Promise<void> {
        const reads = [...hydration.values()].flatMap((load) => load.mock.results.map((result) => result.value as Promise<unknown>));
        await Promise.all(reads);
        await Promise.resolve();
    }

    function output(tabId: number): HTMLTimeElement | null {
        return documents.get(tabId)?.querySelector("time[data-no-more-ago-output]") ?? null;
    }

    return {
        app: application,
        storage,
        tabs,
        scripting,
        documents,
        additions,
        diagnosticReports,
        hydration,
        settle,
        output,
        get stored() {
            return stored;
        },
        get storedPrevious() {
            return storedPrevious;
        },
        get diagnostics() {
            return diagnostics;
        },
        failNextSet: () => {
            failNextSet = true;
        },
        failNextDiagnosticSet: () => {
            failNextDiagnosticSet = true;
        },
        failNextDiagnosticGet: () => {
            failNextDiagnosticGet = true;
        },
        failNextDiagnosticRemove: () => {
            failNextDiagnosticRemove = true;
        },
        poisonDiagnostics: (value: unknown) => {
            diagnostics = value;
        },
        corruptCurrent: (value: unknown) => {
            stored = value as SettingsSnapshotV5;
        },
        corruptPrevious: (value: unknown) => {
            storedPrevious = value as SettingsSnapshotV5;
        },
        restart
    };
}

describe("presentation updates across real background and two documents", () => {
    it("hydrates and updates two real documents with committed custom output", async () => {
        const fixture = integrationFixture(CUSTOM_NEW_YORK);
        await fixture.app.ensureReady();
        await fixture.settle();
        expect(fixture.output(11)?.textContent).toBe("2026-08-23 06:15 -04:00");
        expect(fixture.output(12)?.textContent).toBe("2026-08-23 06:15 -04:00");

        const sameZone = await fixture.app.setDisplaySettings({ formatMode: "custom", pattern: "yyyy/MM/dd HH:mm XXX", timeZone: { mode: "iana", identifier: "America/New_York" } });
        expect(sameZone).toMatchObject({ ok: true, acceptedRevision: 4, refreshFailures: [] });
        expect(fixture.output(11)?.textContent).toBe("2026/08/23 06:15 -04:00");
        expect(fixture.output(12)?.textContent).toBe("2026/08/23 06:15 -04:00");

        const result = await fixture.app.setDisplaySettings(CUSTOM_UTC);
        expect(result).toMatchObject({ ok: true, acceptedRevision: 5, refreshFailures: [] });
        expect(fixture.output(11)?.textContent).toBe("Sunday, 23 August 2026 10:15 UTC");
        expect(fixture.output(12)?.textContent).toBe("Sunday, 23 August 2026 10:15 UTC");
        expect(fixture.output(11)?.textContent).not.toContain("ago");
        expect(fixture.stored.display).toEqual(CUSTOM_UTC);
        const updateMessages = fixture.tabs.sendMessage.mock.calls.filter(([, message]) => typeof message === "object" && message !== null && "type" in message && message.type === UPDATE_PRESENTATION_MESSAGE);
        expect(updateMessages).toHaveLength(4);
        expect(updateMessages.slice(0, 2).every(([, message]) => (message as { revision: number }).revision === 4)).toBe(true);
        expect(updateMessages.slice(2).every(([, message]) => (message as { revision: number }).revision === 5)).toBe(true);

        const candidate = fixture.documents.get(11)?.createElement("relative-time");
        candidate?.setAttribute("datetime", SOURCE_INSTANT);
        if (candidate) {
            fixture.documents.get(11)?.body.append(candidate);
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        expect(fixture.documents.get(11)?.querySelectorAll("time[data-no-more-ago-output]")).toHaveLength(2);
    });

    it("hydrates both documents from saved IANA settings and applies exact revision acknowledgements", async () => {
        const fixture = integrationFixture();
        await fixture.app.ensureReady();
        await fixture.settle();

        expect(fixture.output(11)?.textContent).toBe(expected("America/New_York"));
        expect(fixture.output(12)?.textContent).toBe(expected("America/New_York"));

        const result = await fixture.app.setDisplaySettings(UTC);
        expect(result).toMatchObject({ ok: true, acceptedRevision: 4, refreshFailures: [] });
        expect(fixture.stored).toMatchObject({ revision: 4, display: UTC });
        expect(fixture.output(11)?.textContent).toBe(expected("UTC"));
        expect(fixture.output(12)?.textContent).toBe(expected("UTC"));

        const updates = fixture.tabs.sendMessage.mock.calls.filter(([, message]) =>
            typeof message === "object" && message !== null && "type" in message && message.type === UPDATE_PRESENTATION_MESSAGE
        );
        expect(updates.map(([tabId]) => tabId)).toEqual([11, 12]);
        for (const [, message] of updates) {
            expect(message).toMatchObject({ revision: 4, display: UTC });
        }
        const acknowledgements = await Promise.all(fixture.tabs.sendMessage.mock.calls.flatMap(([, message], index) => {
            if (typeof message !== "object" || message === null || !("type" in message) || message.type !== UPDATE_PRESENTATION_MESSAGE) {
                return [];
            }
            const call = fixture.tabs.sendMessage.mock.results[index];
            return call === undefined ? [] : [call.value as Promise<unknown>];
        }));
        expect(acknowledgements).toEqual([
            { type: PRESENTATION_UPDATED_MESSAGE, revision: 4 },
            { type: PRESENTATION_UPDATED_MESSAGE, revision: 4 }
        ]);
    });

    it("commits a stopped-document partial failure while its active sibling updates", async () => {
        const fixture = integrationFixture();
        await fixture.app.ensureReady();
        await fixture.settle();

        await fixture.tabs.sendMessage(11, { type: TEARDOWN_DOCUMENT_MESSAGE }, { frameId: 0 });
        expect(fixture.output(11)).toBeNull();

        const result = await fixture.app.setDisplaySettings(UTC);
        expect(result).toMatchObject({
            ok: true,
            acceptedRevision: 4,
            refreshFailures: [{ hostname: "github.com", tabId: 11, reason: "tab-update" }]
        });
        expect(fixture.stored.display).toEqual(UTC);
        expect(fixture.output(11)).toBeNull();
        expect(fixture.output(12)?.textContent).toBe(expected("UTC"));
    });

    it("commits custom output with a truthful stopped-document partial failure", async () => {
        const fixture = integrationFixture(CUSTOM_NEW_YORK);
        await fixture.app.ensureReady();
        await fixture.settle();
        await fixture.tabs.sendMessage(11, { type: TEARDOWN_DOCUMENT_MESSAGE }, { frameId: 0 });
        const result = await fixture.app.setDisplaySettings(CUSTOM_UTC);
        expect(result).toMatchObject({ ok: true, acceptedRevision: 4, refreshFailures: [{ hostname: "github.com", tabId: 11, reason: "tab-update" }] });
        expect(fixture.stored.display).toEqual(CUSTOM_UTC);
        expect(fixture.output(12)?.textContent).toBe("Sunday, 23 August 2026 10:15 UTC");
    });

    it.each(["global", "site"] as const)("rehydrates the same %s-disabled documents after a saved zone change", async (policy) => {
        const fixture = integrationFixture();
        await fixture.app.ensureReady();
        await fixture.settle();

        if (policy === "global") {
            await fixture.app.setGlobalEnabled(false);
        } else {
            await fixture.app.setSiteEnabled("github.com", false, "popup");
        }
        expect(fixture.output(11)).toBeNull();
        expect(fixture.output(12)).toBeNull();
        expect(fixture.documents.get(11)?.querySelector("relative-time")?.textContent).toBe("first relative");

        fixture.tabs.sendMessage.mockClear();
        await fixture.app.setDisplaySettings(UTC);
        expect(fixture.tabs.sendMessage).not.toHaveBeenCalled();

        if (policy === "global") {
            await fixture.app.setGlobalEnabled(true);
        } else {
            await fixture.app.setSiteEnabled("github.com", true, "popup");
        }
        await fixture.settle();

        expect(fixture.output(11)?.textContent).toBe(expected("UTC"));
        expect(fixture.output(12)?.textContent).toBe(expected("UTC"));
        expect(fixture.hydration.get(11)).toHaveBeenCalledTimes(2);
        expect(fixture.hydration.get(12)).toHaveBeenCalledTimes(2);
        expect(fixture.additions.get(11)).toHaveBeenCalledTimes(1);
        expect(fixture.additions.get(12)).toHaveBeenCalledTimes(1);
    });

    it.each(["global", "site"] as const)("saves custom output while %s-disabled and hydrates it once on re-enable", async (policy) => {
        const fixture = integrationFixture(CUSTOM_NEW_YORK);
        await fixture.app.ensureReady();
        await fixture.settle();
        if (policy === "global") {
            await fixture.app.setGlobalEnabled(false);
        } else {
            await fixture.app.setSiteEnabled("github.com", false, "popup");
        }
        fixture.tabs.sendMessage.mockClear();
        await expect(fixture.app.setDisplaySettings(CUSTOM_UTC)).resolves.toMatchObject({ ok: true, acceptedRevision: 5, refreshFailures: [] });
        expect(fixture.tabs.sendMessage).not.toHaveBeenCalled();
        if (policy === "global") {
            await fixture.app.setGlobalEnabled(true);
        } else {
            await fixture.app.setSiteEnabled("github.com", true, "popup");
        }
        await fixture.settle();
        expect(fixture.output(11)?.textContent).toBe("Sunday, 23 August 2026 10:15 UTC");
        expect(fixture.output(12)?.textContent).toBe("Sunday, 23 August 2026 10:15 UTC");
        expect(fixture.hydration.get(11)).toHaveBeenCalledTimes(2);
        expect(fixture.hydration.get(12)).toHaveBeenCalledTimes(2);
    });

    it("restores the previous complete policy and document output after current corruption", async () => {
        const fixture = integrationFixture(CUSTOM_NEW_YORK);
        await fixture.app.ensureReady();
        await fixture.settle();
        expect(fixture.output(11)?.textContent).toBe("2026-08-23 06:15 -04:00");

        fixture.corruptCurrent({ schemaVersion: 3, revision: 4 });
        const recovered = fixture.restart();
        await recovered.ensureReady();
        await fixture.settle();

        expect(recovered.phase).toBe("ready");
        expect(fixture.storedPrevious).toEqual(fixture.stored);
        expect(fixture.stored.display).toEqual(CUSTOM_NEW_YORK);
        expect(fixture.output(11)?.textContent).toBe("2026-08-23 06:15 -04:00");
        expect(fixture.output(12)?.textContent).toBe("2026-08-23 06:15 -04:00");
    });

    it.each(["global", "site"] as const)("recovers a saved %s-disabled policy without reactivating owned documents", async (policy) => {
        const fixture = integrationFixture();
        await fixture.app.ensureReady();
        await fixture.settle();
        if (policy === "global") {
            await fixture.app.setGlobalEnabled(false);
        } else {
            await fixture.app.setSiteEnabled("github.com", false, "popup");
        }
        await fixture.app.setDisplaySettings(UTC);
        expect(fixture.output(11)).toBeNull();
        expect(fixture.output(12)).toBeNull();
        fixture.scripting.executeScript.mockClear();
        fixture.corruptCurrent({ schemaVersion: 3 });
        const recovered = fixture.restart();
        await recovered.ensureReady();
        await fixture.settle();
        expect(recovered.phase).toBe("ready");
        expect(fixture.stored.globalEnabled).toBe(policy === "global" ? false : true);
        expect(fixture.stored.sitePreferences).toEqual(policy === "site" ? { "github.com": false } : {});
        expect(fixture.scripting.executeScript).not.toHaveBeenCalled();
        expect(fixture.output(11)).toBeNull();
        expect(fixture.output(12)).toBeNull();
    });

    it("keeps both documents and both GitHub outputs unchanged after a failed save", async () => {
        const fixture = integrationFixture(CUSTOM_NEW_YORK);
        await fixture.app.ensureReady();
        await fixture.settle();
        const beforeCurrent = structuredClone(fixture.stored);
        const beforePrevious = structuredClone(fixture.storedPrevious);
        fixture.failNextSet();

        await expect(fixture.app.setDisplaySettings(CUSTOM_UTC)).resolves.toMatchObject({ ok: false, error: "save-failed" });
        expect(fixture.stored).toEqual(beforeCurrent);
        expect(fixture.storedPrevious).toEqual(beforePrevious);
        expect(fixture.output(11)?.textContent).toBe("2026-08-23 06:15 -04:00");
        expect(fixture.output(12)?.textContent).toBe("2026-08-23 06:15 -04:00");
    });

    it("keeps a future current schema untouched even when the previous snapshot is valid", async () => {
        const fixture = integrationFixture();
        await fixture.app.ensureReady();
        await fixture.settle();
        const beforeWrites = fixture.storage.set.mock.calls.length;
        const future = { schemaVersion: 6, revision: 99, globalEnabled: true };
        fixture.corruptCurrent(future);
        const restarted = fixture.restart();
        await restarted.ensureReady();
        expect(restarted.phase).toBe("failed-closed");
        expect(fixture.storage.set.mock.calls.length).toBe(beforeWrites);
        expect(fixture.stored).toEqual(future);
    });

    it("resets dual corruption once and reactivates both existing documents", async () => {
        const fixture = integrationFixture(CUSTOM_NEW_YORK);
        await fixture.app.ensureReady();
        await fixture.settle();
        fixture.corruptCurrent({ schemaVersion: 3 });
        fixture.corruptPrevious({ schemaVersion: 2 });
        const restarted = fixture.restart();
        await restarted.ensureReady();
        expect(restarted.phase).toBe("failed-closed");
        expect(fixture.output(11)).toBeNull();
        expect(fixture.output(12)).toBeNull();

        await expect(restarted.resetAllSettings()).resolves.toMatchObject({ ok: true, acceptedRevision: 0, state: { availability: "ready" } });
        await fixture.settle();
        expect(fixture.stored).toEqual(createSettingsSnapshot(0, true, {}, { formatMode: "system", timeZone: { mode: "system" } }));
        expect(fixture.storedPrevious).toEqual(fixture.stored);
        const systemZone = new Intl.DateTimeFormat().resolvedOptions().timeZone;
        expect(fixture.output(11)?.textContent).toBe(expected(systemZone));
        expect(fixture.output(12)?.textContent).toBe(expected(systemZone));
    });

    it("does not leave failed-closed state or storage pair changed when reset fails", async () => {
        const fixture = integrationFixture();
        fixture.corruptCurrent({ schemaVersion: 3 });
        fixture.corruptPrevious({ schemaVersion: 2 });
        const restarted = fixture.restart();
        await restarted.ensureReady();
        const beforeCurrent = fixture.stored;
        const beforePrevious = fixture.storedPrevious;
        fixture.failNextSet();
        await expect(restarted.resetAllSettings()).resolves.toMatchObject({ ok: false, error: "save-failed", state: { availability: "unavailable" } });
        expect(restarted.phase).toBe("failed-closed");
        expect(fixture.stored).toBe(beforeCurrent);
        expect(fixture.storedPrevious).toBe(beforePrevious);
    });

    it("enables and disables sanitized diagnostics live in both existing GitHub documents", async () => {
        const fixture = integrationFixture();
        await fixture.app.ensureReady();
        await fixture.settle();
        expect(fixture.diagnostics).toBeUndefined();
        expect((await fixture.app.getDisplayState())).toMatchObject({ availability: "ready", debugEnabled: false });

        await expect(fixture.app.setDebugEnabled(true)).resolves.toMatchObject({
            ok: true,
            acceptedRevision: 4,
            state: { availability: "ready", revision: 4, enabled: true }
        });
        const enableCalls = fixture.tabs.sendMessage.mock.calls.filter(([, message]) =>
            typeof message === "object" && message !== null && "type" in message && message.type === UPDATE_DEBUG_POLICY_MESSAGE
        );
        expect(enableCalls.map(([tabId]) => tabId)).toEqual([11, 12]);
        const acknowledgements = await Promise.all(fixture.tabs.sendMessage.mock.calls.flatMap(([, message], index) => {
            if (typeof message !== "object" || message === null || !("type" in message) || message.type !== UPDATE_DEBUG_POLICY_MESSAGE) {
                return [];
            }
            const call = fixture.tabs.sendMessage.mock.results[index];
            return call === undefined ? [] : [call.value as Promise<unknown>];
        }));
        expect(acknowledgements).toEqual([
            { type: DEBUG_POLICY_UPDATED_MESSAGE, revision: 4 },
            { type: DEBUG_POLICY_UPDATED_MESSAGE, revision: 4 }
        ]);

        for (const [tabId, page] of fixture.documents) {
            const candidate = page.createElement("relative-time");
            candidate.setAttribute("datetime", SOURCE_INSTANT);
            candidate.textContent = `confidential content ${String(tabId)}`;
            page.body.append(candidate);
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        await fixture.app.recordDocumentEvent({ category: "lifecycle" }, { url: "https://github.com/example/repository", frameId: 0 });
        const envelope = fixture.diagnostics as { entries: readonly { category: string; hostname: string; incognito: boolean; pageCategory: string; extensionVersion: string; browserFamily: string }[] };
        expect(envelope.entries.some((event) => event.category === "mutation")).toBe(true);
        expect(envelope.entries.some((event) => event.category === "timing")).toBe(true);
        expect(envelope.entries.some((event) => event.incognito && event.pageCategory === "issue")).toBe(true);
        expect(envelope.entries.every((event) => event.hostname === "github.com")).toBe(true);
        expect(envelope.entries.every((event) => event.extensionVersion === "0.1.0" && event.browserFamily === "chromium")).toBe(true);
        expect(JSON.stringify(envelope)).not.toContain("confidential content");
        expect(JSON.stringify(envelope)).not.toContain(SOURCE_INSTANT);
        expect(JSON.stringify(envelope)).not.toContain("private=secret");
        expect(JSON.stringify(envelope)).not.toContain("fragment");
        expect(fixture.documents.get(11)?.querySelectorAll("time[data-no-more-ago-output]")).toHaveLength(2);
        expect(fixture.documents.get(12)?.querySelectorAll("time[data-no-more-ago-output]")).toHaveLength(2);

        await expect(fixture.app.setDebugEnabled(false)).resolves.toMatchObject({
            ok: true,
            acceptedRevision: 5,
            state: { availability: "ready", revision: 5, enabled: false }
        });
        expect(fixture.diagnostics).toBeUndefined();
        expect(fixture.storage.remove).toHaveBeenCalledWith(DIAGNOSTICS_STORAGE_KEY);
        const diagnosticWrites = fixture.storage.set.mock.calls.filter(([items]) => Object.hasOwn(items, DIAGNOSTICS_STORAGE_KEY)).length;
        const candidate = fixture.documents.get(11)?.createElement("relative-time");
        candidate?.setAttribute("datetime", SOURCE_INSTANT);
        if (candidate) {
            fixture.documents.get(11)?.body.append(candidate);
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        expect(fixture.storage.set.mock.calls.filter(([items]) => Object.hasOwn(items, DIAGNOSTICS_STORAGE_KEY))).toHaveLength(diagnosticWrites);
        expect(fixture.documents.get(11)?.querySelectorAll("time[data-no-more-ago-output]")).toHaveLength(3);
        expect(fixture.additions.get(11)).toHaveBeenCalledTimes(1);
        expect(fixture.additions.get(12)).toHaveBeenCalledTimes(1);
    });

    it("isolates diagnostic persistence failures from both live document outputs", async () => {
        const fixture = integrationFixture();
        await fixture.app.ensureReady();
        await fixture.settle();
        fixture.failNextDiagnosticSet();
        await expect(fixture.app.setDebugEnabled(true)).resolves.toMatchObject({ ok: true, acceptedRevision: 4 });
        for (const page of fixture.documents.values()) {
            const candidate = page.createElement("relative-time");
            candidate.setAttribute("datetime", SOURCE_INSTANT);
            page.body.append(candidate);
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        expect(fixture.documents.get(11)?.querySelectorAll("time[data-no-more-ago-output]")).toHaveLength(2);
        expect(fixture.documents.get(12)?.querySelectorAll("time[data-no-more-ago-output]")).toHaveLength(2);
        expect(fixture.stored.debugEnabled).toBe(true);
    });

    it("exports both live documents safely and clears without stopping future sanitized events", async () => {
        const fixture = integrationFixture(CUSTOM_NEW_YORK);
        await fixture.app.ensureReady();
        await fixture.settle();
        await expect(fixture.app.getDiagnosticsSnapshot()).resolves.toEqual({ ok: false, error: "disabled" });
        await fixture.app.setDebugEnabled(true);
        for (const [tabId, page] of fixture.documents) {
            const candidate = page.createElement("relative-time");
            candidate.setAttribute("datetime", SOURCE_INSTANT);
            candidate.textContent = `secret page text ${String(tabId)}`;
            page.body.append(candidate);
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        const result = await fixture.app.getDiagnosticsSnapshot();
        if (!result.ok) {
            throw new Error(`Expected diagnostics, received ${result.error}`);
        }
        expect(result.snapshot.environment).toEqual({ extensionVersion: "0.1.0", browserFamily: "chromium" });
        expect(result.snapshot.entries.some((entry) => entry.hostname === "github.com" && !entry.incognito && entry.extensionVersion === "0.1.0" && entry.browserFamily === "chromium")).toBe(true);
        expect(result.snapshot.entries.some((entry) => entry.hostname === "github.com" && entry.incognito && entry.pageCategory === "issue" && entry.extensionVersion === "0.1.0" && entry.browserFamily === "chromium")).toBe(true);
        expect(JSON.stringify(result)).not.toMatch(/secret page text|private=secret|fragment|2026-08-23T10:15:00/u);
        const revision = fixture.stored.revision;
        await expect(fixture.app.clearDiagnostics()).resolves.toEqual({ ok: true });
        expect(fixture.diagnostics).toBeUndefined();
        expect(fixture.stored).toMatchObject({ revision, debugEnabled: true, display: CUSTOM_NEW_YORK });
        await expect(fixture.app.getDiagnosticsSnapshot()).resolves.toEqual({ ok: false, error: "empty" });
        for (const page of fixture.documents.values()) {
            const candidate = page.createElement("relative-time");
            candidate.setAttribute("datetime", SOURCE_INSTANT);
            page.body.append(candidate);
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        const afterClear = await fixture.app.getDiagnosticsSnapshot();
        if (!afterClear.ok) {
            throw new Error(`Expected new diagnostics, received ${afterClear.error}`);
        }
        expect(afterClear.snapshot.entries.some((entry) => entry.category === "mutation")).toBe(true);
        for (const [tabId, page] of fixture.documents) {
            expect(page.querySelectorAll("time[data-no-more-ago-output]")).toHaveLength(3);
            expect(fixture.output(tabId)?.textContent).toBe("2026-08-23 06:15 -04:00");
            expect(fixture.additions.get(tabId)).toHaveBeenCalledTimes(1);
        }
    });

    it("keeps both documents active across diagnostic snapshot and clear failures", async () => {
        const fixture = integrationFixture(CUSTOM_NEW_YORK);
        await fixture.app.ensureReady();
        await fixture.settle();
        await fixture.app.setDebugEnabled(true);
        fixture.failNextDiagnosticGet();
        await expect(fixture.app.getDiagnosticsSnapshot()).resolves.toEqual({ ok: false, error: "storage-failed" });
        fixture.poisonDiagnostics({ entries: [{ category: "mutation", timestamp: 1, hostname: "github.com", pageCategory: "repository", incognito: false, datetime: SOURCE_INSTANT }] });
        await expect(fixture.app.getDiagnosticsSnapshot()).resolves.toEqual({ ok: false, error: "invalid-journal" });
        fixture.failNextDiagnosticRemove();
        await expect(fixture.app.clearDiagnostics()).resolves.toEqual({ ok: false, error: "storage-failed" });
        expect(fixture.stored.debugEnabled).toBe(true);
        for (const [tabId, page] of fixture.documents) {
            const candidate = page.createElement("relative-time");
            candidate.setAttribute("datetime", SOURCE_INSTANT);
            page.body.append(candidate);
            expect(fixture.additions.get(tabId)).toHaveBeenCalledTimes(1);
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        expect(fixture.documents.get(11)?.querySelectorAll("time[data-no-more-ago-output]")).toHaveLength(2);
        expect(fixture.documents.get(12)?.querySelectorAll("time[data-no-more-ago-output]")).toHaveLength(2);
    });

    it("refuses oversized and inherited unsafe diagnostics without disturbing either active document", async () => {
        const fixture = integrationFixture(CUSTOM_NEW_YORK);
        await fixture.app.ensureReady();
        await fixture.settle();
        await fixture.app.setDebugEnabled(true);
        const safe = { category: "mutation", timestamp: 1, hostname: "github.com", pageCategory: "repository", incognito: false };
        const serializer = Object.defineProperty({}, "toJSON", { value: () => ({ url: "https://github.com/private?token=secret", datetime: SOURCE_INSTANT, dom: "<secret>" }) });
        const inherited = Object.assign(Object.create({ secret: "inherited" }) as Record<string, unknown>, { entries: [safe] });
        const hiddenSerializer = Object.assign(Object.create(serializer) as Record<string, unknown>, { entries: [safe] });
        const oversized = { entries: [{ ...safe, stack: [`frame:${"1".repeat(DIAGNOSTICS_MAX_BYTES)}`] }] };
        for (const poisoned of [inherited, hiddenSerializer, oversized]) {
            fixture.poisonDiagnostics(poisoned);
            await expect(fixture.app.getDiagnosticsSnapshot()).resolves.toEqual({ ok: false, error: "invalid-journal" });
            expect(fixture.stored.debugEnabled).toBe(true);
            expect(fixture.output(11)?.textContent).toBe("2026-08-23 06:15 -04:00");
            expect(fixture.output(12)?.textContent).toBe("2026-08-23 06:15 -04:00");
            expect(fixture.additions.get(11)).toHaveBeenCalledTimes(1);
            expect(fixture.additions.get(12)).toHaveBeenCalledTimes(1);
        }
    });

    it("resets both active opted-in documents to system presentation without stale diagnostic callbacks", async () => {
        const fixture = integrationFixture(CUSTOM_NEW_YORK);
        await fixture.app.ensureReady();
        await fixture.settle();
        expect(fixture.output(11)?.textContent).toBe("2026-08-23 06:15 -04:00");
        expect(fixture.output(12)?.textContent).toBe("2026-08-23 06:15 -04:00");
        expect(fixture.hydration.get(11)).toHaveBeenCalledTimes(1);
        expect(fixture.hydration.get(12)).toHaveBeenCalledTimes(1);
        await fixture.app.setDebugEnabled(true);
        await fixture.app.recordDocumentEvent({ category: "adapter", reason: "adapter-matched" }, {
            url: "https://github.com/example/repository",
            frameId: 0,
            tab: { incognito: true }
        });
        expect(fixture.diagnostics).toBeDefined();
        const reportsBeforeReset = fixture.diagnosticReports.mock.calls.length;
        await expect(fixture.app.resetAllSettings()).resolves.toMatchObject({ ok: true, acceptedRevision: 0 });
        expect(fixture.stored.debugEnabled).toBe(false);
        expect(fixture.stored.display).toEqual({ formatMode: "system", timeZone: { mode: "system" } });
        expect(fixture.diagnostics).toBeUndefined();
        expect(fixture.storage.remove).toHaveBeenCalledWith(DIAGNOSTICS_STORAGE_KEY);
        expect((await fixture.app.getDisplayState())).toMatchObject({ availability: "ready", debugEnabled: false });
        const systemOutput = new Intl.DateTimeFormat(["en-US"], { dateStyle: "medium", timeStyle: "short" }).format(new Date(SOURCE_INSTANT));
        expect(fixture.output(11)?.textContent).toBe(systemOutput);
        expect(fixture.output(12)?.textContent).toBe(systemOutput);
        expect(fixture.hydration.get(11)).toHaveBeenCalledTimes(2);
        expect(fixture.hydration.get(12)).toHaveBeenCalledTimes(2);
        expect(fixture.additions.get(11)).toHaveBeenCalledTimes(1);
        expect(fixture.additions.get(12)).toHaveBeenCalledTimes(1);
        const resetTeardowns = fixture.tabs.sendMessage.mock.calls.filter(([, message]) =>
            typeof message === "object" && message !== null && "type" in message && message.type === TEARDOWN_DOCUMENT_MESSAGE
        );
        expect(resetTeardowns.map(([tabId]) => tabId)).toEqual([11, 12]);
        const writesAfterReset = fixture.storage.set.mock.calls.filter(([items]) => Object.hasOwn(items, DIAGNOSTICS_STORAGE_KEY)).length;
        for (const page of fixture.documents.values()) {
            const candidate = page.createElement("relative-time");
            candidate.setAttribute("datetime", SOURCE_INSTANT);
            page.body.append(candidate);
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        expect(fixture.diagnosticReports).toHaveBeenCalledTimes(reportsBeforeReset);
        expect(fixture.storage.set.mock.calls.filter(([items]) => Object.hasOwn(items, DIAGNOSTICS_STORAGE_KEY))).toHaveLength(writesAfterReset);
        expect(fixture.diagnostics).toBeUndefined();
        for (const page of fixture.documents.values()) {
            const outputs = [...page.querySelectorAll("time[data-no-more-ago-output]")];
            expect(outputs).toHaveLength(2);
            expect(outputs.every((output) => output.textContent === systemOutput)).toBe(true);
        }
    });

    it.each(["global", "site"] as const)("reactivates two %s-disabled documents and clears every retained preference in one reset", async (policy) => {
        const fixture = integrationFixture(CUSTOM_NEW_YORK);
        await fixture.app.ensureReady();
        await fixture.settle();
        await fixture.app.setSiteEnabled("managed-enabled.test", true, "sites");
        await fixture.app.setSiteEnabled("managed-disabled.test", false, "sites");
        await fixture.app.setDebugEnabled(true);
        await fixture.app.recordDocumentEvent({ category: "mutation", count: 1 }, { url: "https://github.com/example/repository", frameId: 0 });
        expect(fixture.diagnostics).toBeDefined();
        if (policy === "global") {
            await fixture.app.setGlobalEnabled(false);
        } else {
            await fixture.app.setSiteEnabled("github.com", false, "sites");
        }
        expect(fixture.output(11)).toBeNull();
        expect(fixture.output(12)).toBeNull();
        const reportsBeforeReset = fixture.diagnosticReports.mock.calls.length;
        const settingsWritesBeforeReset = fixture.storage.set.mock.calls.filter(([items]) => Object.hasOwn(items, SETTINGS_STORAGE_KEY)).length;
        fixture.scripting.executeScript.mockClear();

        await expect(fixture.app.resetAllSettings()).resolves.toEqual({
            ok: true,
            acceptedRevision: 0,
            state: { availability: "ready", revision: 0, globalEnabled: true, sites: [{ hostname: "github.com", enabled: true, hasAdapter: true }] }
        });
        const settingsWrites = fixture.storage.set.mock.calls.filter(([items]) => Object.hasOwn(items, SETTINGS_STORAGE_KEY));
        expect(settingsWrites).toHaveLength(settingsWritesBeforeReset + 1);
        expect(settingsWrites.at(-1)?.[0]).toEqual({ [SETTINGS_STORAGE_KEY]: DEFAULT_SETTINGS_SNAPSHOT, [SETTINGS_PREVIOUS_STORAGE_KEY]: DEFAULT_SETTINGS_SNAPSHOT });
        expect(fixture.stored).toEqual(DEFAULT_SETTINGS_SNAPSHOT);
        expect(fixture.storedPrevious).toEqual(DEFAULT_SETTINGS_SNAPSHOT);
        expect(fixture.diagnostics).toBeUndefined();
        expect(fixture.scripting.executeScript.mock.calls.map(([request]) => request.target.tabId).sort()).toEqual([11, 12]);
        const formatter = new Intl.DateTimeFormat(["en-US"], { dateStyle: "medium", timeStyle: "short" });
        const systemOutput = formatter.format(new Date(SOURCE_INSTANT));
        for (const [tabId, page] of fixture.documents) {
            expect(fixture.output(tabId)?.textContent).toBe(systemOutput);
            expect(fixture.additions.get(tabId)).toHaveBeenCalledTimes(1);
            const candidate = page.createElement("relative-time");
            candidate.setAttribute("datetime", "2026-08-24T11:16:00Z");
            page.body.append(candidate);
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        for (const page of fixture.documents.values()) {
            const outputs = [...page.querySelectorAll("time[data-no-more-ago-output]")];
            expect(outputs.map((node) => node.textContent)).toEqual([systemOutput, formatter.format(new Date("2026-08-24T11:16:00Z"))]);
        }
        expect(fixture.diagnosticReports).toHaveBeenCalledTimes(reportsBeforeReset);
        expect(fixture.diagnostics).toBeUndefined();
        await expect(fixture.app.getDisplayState()).resolves.toEqual({ availability: "ready", revision: 0, display: DEFAULT_SETTINGS_SNAPSHOT.display, debugEnabled: false });
        await expect(fixture.app.getDebugState()).resolves.toEqual({ availability: "ready", revision: 0, enabled: false });
        await expect(fixture.app.getPopupState()).resolves.toMatchObject({ availability: "ready", revision: 0, globalEnabled: true, hostname: "github.com", siteEnabled: true, status: "active" });
    });

    it("keeps both active custom documents, the atomic pair, and opted-in diagnostics after a rejected reset", async () => {
        const fixture = integrationFixture(CUSTOM_NEW_YORK);
        await fixture.app.ensureReady();
        await fixture.settle();
        await fixture.app.setSiteEnabled("managed.test", false, "sites");
        await fixture.app.setDebugEnabled(true);
        await fixture.app.recordDocumentEvent({ category: "mutation", count: 1 }, { url: "https://github.com/example/repository", frameId: 0 });
        const beforeCurrent = fixture.stored;
        const beforePrevious = fixture.storedPrevious;
        const beforeDiagnostics = fixture.diagnostics;
        const removals = fixture.storage.remove.mock.calls.length;
        const injections = fixture.scripting.executeScript.mock.calls.length;
        fixture.failNextSet();

        await expect(fixture.app.resetAllSettings()).resolves.toMatchObject({ ok: false, error: "save-failed", state: { availability: "ready", revision: beforeCurrent.revision } });
        expect(fixture.stored).toBe(beforeCurrent);
        expect(fixture.storedPrevious).toBe(beforePrevious);
        expect(fixture.diagnostics).toBe(beforeDiagnostics);
        expect(fixture.storage.remove).toHaveBeenCalledTimes(removals);
        expect(fixture.scripting.executeScript).toHaveBeenCalledTimes(injections);
        expect(fixture.output(11)?.textContent).toBe("2026-08-23 06:15 -04:00");
        expect(fixture.output(12)?.textContent).toBe("2026-08-23 06:15 -04:00");
        await expect(fixture.app.getDebugState()).resolves.toMatchObject({ availability: "ready", enabled: true });
    });

    it("removes stale diagnostics when a dual-corrupt pair recovers both existing documents", async () => {
        const fixture = integrationFixture(CUSTOM_NEW_YORK);
        await fixture.app.ensureReady();
        await fixture.app.setDebugEnabled(true);
        await fixture.app.recordDocumentEvent({ category: "mutation", count: 1 }, { url: "https://github.com/example/repository", frameId: 0 });
        expect(fixture.diagnostics).toBeDefined();
        fixture.corruptCurrent({ schemaVersion: 3 });
        fixture.corruptPrevious({ schemaVersion: 2 });
        const restarted = fixture.restart();
        await restarted.ensureReady();
        expect(restarted.phase).toBe("failed-closed");
        expect(fixture.output(11)).toBeNull();
        expect(fixture.output(12)).toBeNull();

        await expect(restarted.resetAllSettings()).resolves.toMatchObject({ ok: true, acceptedRevision: 0 });
        expect(fixture.stored).toEqual(DEFAULT_SETTINGS_SNAPSHOT);
        expect(fixture.storedPrevious).toEqual(DEFAULT_SETTINGS_SNAPSHOT);
        expect(fixture.diagnostics).toBeUndefined();
        expect(fixture.output(11)).not.toBeNull();
        expect(fixture.output(12)).not.toBeNull();
    });
});
