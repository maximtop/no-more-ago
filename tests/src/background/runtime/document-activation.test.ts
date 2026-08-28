/**
 * @file Verifies universal document-runtime reconciliation.
 */

import { describe, expect, it, vi } from "vitest";
/* eslint-disable @typescript-eslint/require-await */
import {
    DocumentActivationCoordinator,
    ACTIVATION_MODE,
    ACTIVATION_POLICY,
    RECONCILE_FAILURE_SCOPE,
    REGISTRATION_OUTCOME,
    TAB_ACTION,
} from "../../../../src/background/runtime/document-activation";
import type { RegisteredContentScriptSpec } from "../../../../src/background/runtime/scripting";
import {
    DOCUMENT_RUNTIME_REGISTRATION,
    DOCUMENT_RUNTIME_REGISTRATION_ID,
    LEGACY_DOCUMENT_RUNTIME_REGISTRATION_IDS,
} from "../../../../src/background/runtime/register-documents";
import {
    REFRESH_DOCUMENT_POLICY_MESSAGE,
    SUSPEND_AND_REFRESH_DOCUMENT_POLICY_MESSAGE,
    TEARDOWN_DOCUMENT_MESSAGE,
} from "../../../../src/shared/messaging/document-messages";
import {
    installContentRuntime,
    type ContentRuntimeHandle,
} from "../../../../src/content-script/runtime";
import { STATE_AVAILABILITY } from "../../../../src/shared/messaging/view-state-values";

/**
 * Creates an independently dispatchable content-runtime message source.
 *
 * @returns - Message source and dispatch function for one document frame.
 */
function frameMessages() {
    let listener: ((message: unknown) => unknown) | undefined;
    return {
        onMessage: {
            addListener: vi.fn((next: (message: unknown) => unknown) => {
                listener = next;
            }),
        },
        dispatch(message: unknown): unknown {
            return listener?.(message);
        },
    };
}

/**
 * Installs a timestamp-processing runtime in an isolated frame document.
 *
 * @param isEnabled - Reads the current top-level site policy.
 * @returns - Frame document, message source, and runtime handle.
 */
function installedFrame(isEnabled: () => boolean): {
    readonly document: Document;
    readonly element: HTMLIFrameElement;
    readonly messages: ReturnType<typeof frameMessages>;
    readonly handle: ContentRuntimeHandle;
} {
    const element = document.createElement("iframe");
    document.body.append(element);
    const frameDocument = element.contentDocument;
    if (!frameDocument) {
        throw new Error("Expected frame document");
    }
    frameDocument.body.innerHTML =
        '<time datetime="2026-08-23T10:15:00Z">relative</time>';
    const messages = frameMessages();
    const handle = installContentRuntime({
        document: frameDocument,
        url: new URL("https://example.test/page"),
        locales: ["en-US"],
        loadDocumentState: async () => ({
            availability: STATE_AVAILABILITY.READY,
            revision: isEnabled() ? 2 : 1,
            enabled: isEnabled(),
            display: { formatMode: "system" as const, timeZone: { mode: "utc" as const } },
            debugEnabled: false,
        }),
        messages,
    });
    return { document: frameDocument, element, messages, handle };
}

/**
 * Checks whether a frame currently contains generated timestamp output.
 *
 * @param frame - Installed frame under inspection.
 * @returns - Whether the frame has generated output.
 */
function hasOutput(frame: ReturnType<typeof installedFrame>): boolean {
    return frame.document.querySelector("[data-no-more-ago-output]") !== null;
}

/**
 * Creates browser API doubles for the requested tab URLs.
 *
 * @param urls - Top-level tab URLs returned by the query.
 * @returns - Scripting and tabs doubles.
 */
function fakes(urls: readonly string[]) {
    const registered = new Map<string, RegisteredContentScriptSpec>([
        [DOCUMENT_RUNTIME_REGISTRATION_ID, { ...DOCUMENT_RUNTIME_REGISTRATION }],
    ]);
    const scripting = {
        getRegisteredContentScripts: vi.fn(async () => [...registered.values()]),
        registerContentScripts: vi.fn(async (scripts: typeof DOCUMENT_RUNTIME_REGISTRATION[]) => {
            for (const script of scripts) {
                registered.set(script.id, script);
            }
        }),
        updateContentScripts: vi.fn(async (scripts: typeof DOCUMENT_RUNTIME_REGISTRATION[]) => {
            for (const script of scripts) {
                registered.set(script.id, script);
            }
        }),
        unregisterContentScripts: vi.fn(async ({ ids }: { ids: string[] }) => {
            for (const id of ids) {
                registered.delete(id);
            }
        }),
        executeScript: vi.fn(async () => [{ frameId: 0 }, { frameId: 1 }]),
    };
    const tabs = {
        query: vi.fn(async () => urls.map((url, index) => ({ id: index + 1, url }))),
        sendMessage: vi.fn(async (
            ...args: [number, unknown, { readonly frameId: number }?]
        ) => {
            void args;
            return { type: "ack" };
        }),
    };
    return { scripting, tabs };
}

describe("DocumentActivationCoordinator", () => {
    it("registers universally and broadcasts before all-frame ensure", async () => {
        const fake = fakes(["https://example.test/page"]);
        fake.scripting.getRegisteredContentScripts.mockResolvedValue([]);
        const coordinator = new DocumentActivationCoordinator(fake);
        const result = await coordinator.reconcile({
            revision: 1,
            mode: ACTIVATION_MODE.COLD_WORKER,
            policy: ACTIVATION_POLICY.ENABLED,
            sitePreferences: { "example.test": true },
        });

        expect(result.registration).toBe(REGISTRATION_OUTCOME.REGISTERED);
        expect(fake.tabs.sendMessage).toHaveBeenCalledWith(
            1,
            { type: REFRESH_DOCUMENT_POLICY_MESSAGE },
        );
        expect(fake.scripting.executeScript).toHaveBeenCalledWith({
            target: { tabId: 1, allFrames: true },
            files: ["content.js"],
        });
    });

    it("suspends a disabled site and still ensures every reachable frame", async () => {
        const fake = fakes(["https://example.test/page"]);
        const coordinator = new DocumentActivationCoordinator(fake);
        await coordinator.reconcile({
            revision: 2,
            mode: ACTIVATION_MODE.SETTINGS_CHANGE,
            policy: ACTIVATION_POLICY.ENABLED,
            sitePreferences: { "example.test": false },
        });

        expect(fake.tabs.sendMessage).toHaveBeenCalledWith(
            1,
            { type: SUSPEND_AND_REFRESH_DOCUMENT_POLICY_MESSAGE },
        );
        expect(fake.scripting.executeScript).toHaveBeenCalledTimes(1);
    });

    it("unregisters and broadcasts teardown when globally disabled", async () => {
        const fake = fakes(["https://example.test/page"]);
        const coordinator = new DocumentActivationCoordinator(fake);
        const result = await coordinator.reconcile({
            revision: 3,
            mode: ACTIVATION_MODE.FAILED_CLOSED,
            policy: ACTIVATION_POLICY.DISABLED,
        });

        expect(result.registration).toBe(REGISTRATION_OUTCOME.UNREGISTERED);
        expect(fake.tabs.sendMessage).toHaveBeenCalledWith(
            1,
            { type: TEARDOWN_DOCUMENT_MESSAGE },
        );
        expect(fake.scripting.executeScript).not.toHaveBeenCalled();
    });

    it("removes the legacy GitHub registration while keeping the universal runtime", async () => {
        const fake = fakes([]);
        const legacyId = LEGACY_DOCUMENT_RUNTIME_REGISTRATION_IDS[0];
        fake.scripting.getRegisteredContentScripts.mockResolvedValue([
            DOCUMENT_RUNTIME_REGISTRATION,
            { ...DOCUMENT_RUNTIME_REGISTRATION, id: legacyId },
        ]);
        const coordinator = new DocumentActivationCoordinator(fake);

        const result = await coordinator.reconcile({
            revision: 4,
            mode: ACTIVATION_MODE.ACTIVATION_SWEEP,
            policy: ACTIVATION_POLICY.ENABLED,
            sitePreferences: {},
        });

        expect(fake.scripting.unregisterContentScripts).toHaveBeenCalledWith({
            ids: [legacyId],
        });
        expect(result.registration).toBe(REGISTRATION_OUTCOME.UPDATED);
    });

    it("retains sibling recovery when one tab ensure fails", async () => {
        const fake = fakes([
            "https://first.test/page",
            "https://second.test/page",
        ]);
        fake.scripting.executeScript
            .mockRejectedValueOnce(new Error("unreachable"))
            .mockResolvedValueOnce([{ frameId: 0 }]);
        const coordinator = new DocumentActivationCoordinator(fake);
        const result = await coordinator.reconcile({
            revision: 4,
            mode: ACTIVATION_MODE.ACTIVATION_SWEEP,
            policy: ACTIVATION_POLICY.ENABLED,
            sitePreferences: { "first.test": true, "second.test": true },
        });

        expect(result.tabs).toEqual([
            { tabId: 1, hostname: "first.test", action: TAB_ACTION.INJECT, ok: false },
            { tabId: 2, hostname: "second.test", action: TAB_ACTION.INJECT, ok: true },
        ]);
        expect(result.failures).toContainEqual({
            scope: RECONCILE_FAILURE_SCOPE.TAB,
            tabId: 1,
            hostname: "first.test",
            action: TAB_ACTION.INJECT,
        });
    });

    it("contains synchronous browser API failures and still reconciles siblings", async () => {
        const fake = fakes([
            "https://first.test/page",
            "https://second.test/page",
        ]);
        fake.tabs.sendMessage
            .mockImplementationOnce(() => {
                throw new Error("synchronous message failure");
            })
            .mockResolvedValueOnce({ type: "ack" });
        fake.scripting.executeScript
            .mockImplementationOnce(() => {
                throw new Error("synchronous injection failure");
            })
            .mockResolvedValueOnce([{ frameId: 0 }]);
        const coordinator = new DocumentActivationCoordinator(fake);

        const result = await coordinator.reconcile({
            revision: 5,
            mode: ACTIVATION_MODE.ACTIVATION_SWEEP,
            policy: ACTIVATION_POLICY.ENABLED,
            sitePreferences: {},
        });

        expect(result.tabs).toEqual([
            { tabId: 1, hostname: "first.test", action: TAB_ACTION.INJECT, ok: false },
            { tabId: 2, hostname: "second.test", action: TAB_ACTION.INJECT, ok: true },
        ]);
    });

    it(
        "restores and reprocesses every reachable frame across site and global policy changes",
        async () => {
            let siteEnabled = true;
            const first = installedFrame(() => siteEnabled);
            const second = installedFrame(() => siteEnabled);
            const frames = [first, second];
            const fake = fakes(["https://example.test/page"]);
            let rejectBroadcastResponse = true;
            fake.tabs.sendMessage.mockImplementation(async (_tabId, message) => {
                frames.forEach((frame) => {
                    frame.messages.dispatch(message);
                });
                if (rejectBroadcastResponse) {
                    throw new Error("nondeterministic broadcast response");
                }
                return { type: "single-frame-response" };
            });
            fake.scripting.executeScript.mockResolvedValue([
                { frameId: 0 },
                { frameId: 1 },
            ]);
            const coordinator = new DocumentActivationCoordinator(fake);
            try {
                await Promise.resolve();
                await Promise.resolve();
                expect(frames.map(hasOutput)).toEqual([true, true]);

                siteEnabled = false;
                const siteDisabled = await coordinator.reconcile({
                    revision: 3,
                    mode: ACTIVATION_MODE.SETTINGS_CHANGE,
                    policy: ACTIVATION_POLICY.ENABLED,
                    sitePreferences: { "example.test": false },
                });
                await Promise.resolve();
                await Promise.resolve();
                expect(frames.map(hasOutput)).toEqual([false, false]);
                expect(siteDisabled.failures).toEqual([]);
                expect(siteDisabled.tabs).toEqual([
                    { tabId: 1, hostname: "example.test", action: TAB_ACTION.INJECT, ok: true },
                ]);

                siteEnabled = true;
                rejectBroadcastResponse = false;
                const siteEnabledResult = await coordinator.reconcile({
                    revision: 4,
                    mode: ACTIVATION_MODE.SETTINGS_CHANGE,
                    policy: ACTIVATION_POLICY.ENABLED,
                    sitePreferences: { "example.test": true },
                });
                await Promise.resolve();
                await Promise.resolve();
                expect(frames.map(hasOutput)).toEqual([true, true]);
                expect(siteEnabledResult.tabs).toEqual([
                    { tabId: 1, hostname: "example.test", action: TAB_ACTION.INJECT, ok: true },
                ]);

                const globallyDisabled = await coordinator.reconcile({
                    revision: 5,
                    mode: ACTIVATION_MODE.FAILED_CLOSED,
                    policy: ACTIVATION_POLICY.DISABLED,
                });
                expect(frames.map(hasOutput)).toEqual([false, false]);
                expect(globallyDisabled.tabs).toEqual([
                    { tabId: 1, hostname: "example.test", action: TAB_ACTION.TEARDOWN, ok: true },
                ]);
            } finally {
                first.handle.teardown();
                second.handle.teardown();
                first.element.remove();
                second.element.remove();
            }
        },
    );
});
