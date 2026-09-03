/**
 * @file Verifies universal popup status and site controls.
 */

import { beforeAll, describe, expect, it, vi } from "vitest";
/* eslint-disable @typescript-eslint/require-await */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { PopupApp } from "../../../src/popup/app";
import { PopupClient, type PopupTransport } from "../../../src/popup/client";
import type { PopupState } from "../../../src/shared/messaging/view-state-schemas";
import type {
    SubscribeSettingsChanged,
} from "../../../src/shared/messaging/settings-notifications";
import {
    GET_DIAGNOSTICS_SNAPSHOT_MESSAGE,
    GET_POPUP_STATE_MESSAGE,
    RESET_ALL_SETTINGS_MESSAGE,
    SET_SITE_ENABLED_MESSAGE,
} from "../../../src/shared/messaging/contracts";
import {
    SETTINGS_STATE_FAILURE,
    SITE_SETTINGS_SURFACE,
} from "../../../src/shared/messaging/view-state-values";
import { APPEARANCE } from "../../../src/shared/settings/snapshot";
import { SITE_SCOPE_MODE } from "../../../src/shared/settings/site-scope";
import { findButton, findSwitch, installMatchMedia, messageType } from "../../support/dom";

const active: PopupState = {
    availability: "ready",
    revision: 2,
    globalEnabled: true,
    hostname: "example.test",
    siteEnabled: true,
    scopeMode: SITE_SCOPE_MODE.ALL_EXCEPT_EXCLUDED,
    appearance: APPEARANCE.SYSTEM,
    status: "active",
};

beforeAll(() => {
    (
        globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    installMatchMedia();
});

/**
 * Injectable dependencies for one popup render.
 */
interface RenderOptions {
    /**
     * Background message transport.
     */
    readonly transport?: PopupTransport;

    /**
     * Browser boundary used to open the Options page.
     */
    readonly openOptionsPage?: () => Promise<void>;

    /**
     * Settings change subscriber.
     */
    readonly subscribe?: SubscribeSettingsChanged;
}

/**
 * Renders the popup with a preloaded state.
 *
 * @param state - Popup state to render.
 * @param options - Transport, Options-page boundary, and subscriber.
 * @returns - Mounted container and cleanup function.
 */
async function renderPopup(
    state: PopupState,
    options: RenderOptions = {},
): Promise<{ container: HTMLDivElement; unmount: () => Promise<void> }> {
    const {
        transport = { sendMessage: () => Promise.resolve(state) },
        openOptionsPage = () => Promise.resolve(),
        subscribe,
    } = options;
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
        root.render(
            <PopupApp
                initialState={state}
                client={new PopupClient(transport)}
                openOptionsPage={openOptionsPage}
                {...(subscribe ? { subscribe } : {})}
            />,
        );
    });
    return {
        container,
        unmount: async () => {
            await act(async () => {
                root.unmount();
            });
            container.remove();
        },
    };
}

describe("PopupApp contract", () => {
    it("stops loading when the background state request never settles", async () => {
        vi.useFakeTimers();
        const container = document.createElement("div");
        document.body.append(container);
        const root = createRoot(container);
        const pendingTransport: PopupTransport = {
            sendMessage: () => new Promise(() => undefined),
        };

        try {
            await act(async () => {
                root.render(<PopupApp client={new PopupClient(pendingTransport)} />);
            });
            expect(container.textContent).toContain("Loading current site");

            await act(async () => {
                await vi.advanceTimersByTimeAsync(5_000);
            });

            expect(container.textContent).not.toContain("Loading current site");
            expect(container.textContent).toContain("Settings are unavailable");
        } finally {
            await act(async () => {
                root.unmount();
            });
            container.remove();
            vi.useRealTimers();
        }
    });

    it("names the hostname once and reports status and run mode", async () => {
        const rendered = await renderPopup(active);
        try {
            const text = rendered.container.textContent;
            expect(text).toContain("No More Ago");
            expect(text).toContain("Active");
            expect(text).toContain("All supported sites");
            expect(text.match(/example\.test/gu)).toHaveLength(1);
            expect(rendered.container.querySelectorAll("input[type=checkbox]"))
                .toHaveLength(2);
        } finally {
            await rendered.unmount();
        }
    });

    it("explains and sends an exclusion for the current hostname", async () => {
        const sent: unknown[] = [];
        const rendered = await renderPopup(active, {
            transport: {
                sendMessage: (message) => {
                    sent.push(message);
                    return Promise.resolve({
                        ok: true,
                        acceptedRevision: 3,
                        surface: SITE_SETTINGS_SURFACE.POPUP,
                        state: {
                            ...active,
                            revision: 3,
                            siteEnabled: false,
                            status: "site-excluded",
                        },
                    });
                },
            },
        });
        try {
            expect(rendered.container.textContent)
                .toContain("Turning this off adds this hostname to Excluded sites.");
            const site = findSwitch(rendered.container, "Enabled on example.test");
            if (!site) {
                throw new Error("Site switch is missing");
            }
            await act(async () => {
                site.click();
            });
            expect(sent).toEqual([{
                type: SET_SITE_ENABLED_MESSAGE,
                hostname: "example.test",
                enabled: false,
                surface: SITE_SETTINGS_SURFACE.POPUP,
            }]);
            expect(rendered.container.textContent).toContain("Excluded on this site");
        } finally {
            await rendered.unmount();
        }
    });

    it("reports selected-only coverage and offers to allow the hostname", async () => {
        const rendered = await renderPopup({
            ...active,
            siteEnabled: false,
            scopeMode: SITE_SCOPE_MODE.SELECTED_ONLY,
            status: "site-not-selected",
        });
        try {
            expect(rendered.container.textContent).toContain("Not selected for this site");
            expect(rendered.container.textContent).toContain("Selected sites only");
            expect(rendered.container.textContent)
                .toContain("Turning this on adds this hostname to Allowed sites.");
        } finally {
            await rendered.unmount();
        }
    });

    it("keeps the site rule visible but unchangeable while the extension is off", async () => {
        const rendered = await renderPopup({
            ...active,
            globalEnabled: false,
            status: "global-disabled",
        });
        try {
            expect(rendered.container.textContent).toContain("Extension is off");
            expect(findSwitch(rendered.container, "Extension enabled")?.disabled).toBe(false);
            expect(findSwitch(rendered.container, "Enabled on example.test")?.disabled)
                .toBe(true);
        } finally {
            await rendered.unmount();
        }
    });

    it("keeps both switches usable after a per-tab processing failure", async () => {
        const rendered = await renderPopup({ ...active, status: "runtime-failed" });
        try {
            expect(rendered.container.textContent).toContain("Could not process this page");
            expect(findSwitch(rendered.container, "Extension enabled")?.disabled).toBe(false);
            expect(findSwitch(rendered.container, "Enabled on example.test")?.disabled)
                .toBe(false);
        } finally {
            await rendered.unmount();
        }
    });

    it("hides the site switch and the report action on an inaccessible page", async () => {
        const rendered = await renderPopup({
            ...active,
            hostname: null,
            siteEnabled: null,
            status: "inaccessible",
        });
        try {
            expect(rendered.container.textContent).toContain("Cannot run on this page");
            expect(rendered.container.querySelectorAll("input[type=checkbox]"))
                .toHaveLength(1);
            expect(rendered.container.textContent).not.toContain("Report this site");
        } finally {
            await rendered.unmount();
        }
    });

    it("offers recovery actions instead of controls when settings are unavailable", async () => {
        let resets = 0;
        const rendered = await renderPopup(
            {
                availability: "unavailable",
                revision: null,
                globalEnabled: null,
                hostname: null,
                siteEnabled: null,
                scopeMode: null,
                appearance: APPEARANCE.SYSTEM,
                status: "settings-unavailable",
                failure: SETTINGS_STATE_FAILURE.SETTINGS_LOAD,
            },
            {
                transport: {
                    sendMessage: (message) => {
                        if (
                            messageType(message) === RESET_ALL_SETTINGS_MESSAGE
                        ) {
                            resets += 1;
                            return Promise.resolve({ ok: false, error: "save-failed", state: {
                                availability: "unavailable",
                                revision: null,
                                globalEnabled: null,
                                scopeMode: null,
                                excludedSites: [],
                                allowedSites: [],
                                failure: SETTINGS_STATE_FAILURE.SETTINGS_LOAD,
                            } });
                        }
                        return Promise.resolve(undefined);
                    },
                },
            },
        );
        try {
            expect(rendered.container.querySelectorAll("input[type=checkbox]"))
                .toHaveLength(0);
            const buttons = [...rendered.container.querySelectorAll("button")];
            const reset = buttons.find((button) =>
                button.textContent.includes("Reset all settings"));
            expect(buttons.some((button) =>
                button.textContent.includes("Open GitHub issue"))).toBe(true);
            if (!reset) {
                throw new Error("Recovery action is missing");
            }
            await act(async () => {
                reset.click();
            });
            expect(resets).toBe(1);
        } finally {
            await rendered.unmount();
        }
    });

    it("offers a log download from the recovery view and reports its outcome", async () => {
        let requests = 0;
        const rendered = await renderPopup(
            {
                availability: "unavailable",
                revision: null,
                globalEnabled: null,
                hostname: null,
                siteEnabled: null,
                scopeMode: null,
                appearance: APPEARANCE.SYSTEM,
                status: "settings-unavailable",
                failure: SETTINGS_STATE_FAILURE.SETTINGS_LOAD,
            },
            {
                transport: {
                    sendMessage: (message) => {
                        if (
                            messageType(message) === GET_DIAGNOSTICS_SNAPSHOT_MESSAGE
                        ) {
                            requests += 1;
                            return Promise.resolve({ ok: false, error: "empty" });
                        }
                        return Promise.resolve(undefined);
                    },
                },
            },
        );
        try {
            const download = findButton(rendered.container, "Download logs");
            if (!download) {
                throw new Error("Download action is missing");
            }
            await act(async () => {
                download.click();
                download.click();
            });
            expect(requests).toBe(1);
            expect(rendered.container.textContent)
                .toContain("There are no diagnostic logs to download yet.");
        } finally {
            await rendered.unmount();
        }
    });

    it("reloads state when the background announces a newer revision", async () => {
        let announce: ((revision: number) => void) | undefined;
        const subscribe: SubscribeSettingsChanged = (listener) => {
            announce = listener;
            return { unsubscribe: () => undefined };
        };
        const rendered = await renderPopup(active, {
            transport: {
                sendMessage: () => Promise.resolve({
                    ...active,
                    revision: 5,
                    globalEnabled: false,
                    status: "global-disabled",
                }),
            },
            openOptionsPage: () => Promise.resolve(),
            subscribe: subscribe,
        });
        try {
            await act(async () => {
                announce?.(5);
            });
            expect(rendered.container.textContent).toContain("Extension is off");
            expect(rendered.container.textContent)
                .toContain("Settings were updated in another window.");
        } finally {
            await rendered.unmount();
        }
    });

    it("applies a foreign announcement that arrives during its own write", async () => {
        let announce: ((revision: number) => void) | undefined;
        const reads: string[] = [];
        const rendered = await renderPopup(active, {
            transport: {
                sendMessage: (message) => {
                    const type = messageType(message);
                    if (type === SET_SITE_ENABLED_MESSAGE) {
                        // Own write commits 3, then Settings commits 4 before the
                        // response is produced; both announcements arrive in flight.
                        announce?.(3);
                        announce?.(4);
                        return Promise.resolve({
                            ok: true,
                            acceptedRevision: 3,
                            surface: SITE_SETTINGS_SURFACE.POPUP,
                            state: { ...active, revision: 3, siteEnabled: false },
                        });
                    }
                    if (type) {
                        reads.push(type);
                    }
                    return Promise.resolve({
                        ...active,
                        revision: 4,
                        siteEnabled: false,
                        scopeMode: SITE_SCOPE_MODE.SELECTED_ONLY,
                    });
                },
            },
            subscribe: (listener) => {
                announce = listener;
                return { unsubscribe: () => undefined };
            },
        });
        try {
            const site = findSwitch(rendered.container, "Enabled on example.test");
            if (!site) {
                throw new Error("Site switch is missing");
            }
            await act(async () => {
                site.click();
            });
            expect(reads).toEqual([GET_POPUP_STATE_MESSAGE]);
            expect(rendered.container.textContent).toContain("Selected sites only");
            expect(rendered.container.textContent)
                .toContain("Settings were updated in another window.");
        } finally {
            await rendered.unmount();
        }
    });

    it("ignores an announcement that is not newer than the rendered revision", async () => {
        let announce: ((revision: number) => void) | undefined;
        let reads = 0;
        const rendered = await renderPopup(active, {
            transport: {
                sendMessage: () => {
                    reads += 1;
                    return Promise.resolve(active);
                },
            },
            openOptionsPage: () => Promise.resolve(),
            subscribe: (listener) => {
                announce = listener;
                return { unsubscribe: () => undefined };
            },
        });
        try {
            await act(async () => {
                announce?.(2);
            });
            expect(reads).toBe(0);
        } finally {
            await rendered.unmount();
        }
    });

    it("opens Settings once through the browser Options-page boundary", async () => {
        let openCalls = 0;
        const rendered = await renderPopup(active, {
            transport: { sendMessage: () => Promise.resolve(active) },
            openOptionsPage: async () => {
                openCalls += 1;
            },
        });
        try {
            const settings = findButton(rendered.container, "Settings");
            if (!settings) {
                throw new Error("Settings action is missing");
            }
            await act(async () => {
                settings.click();
            });
            expect(openCalls).toBe(1);
        } finally {
            await rendered.unmount();
        }
    });

    it("contains Settings-opening failures", async () => {
        const rendered = await renderPopup(active, {
            transport: { sendMessage: () => Promise.resolve(active) },
            openOptionsPage: () => Promise.reject(new Error("Options page unavailable")),
        });
        try {
            const settings = findButton(rendered.container, "Settings");
            if (!settings) {
                throw new Error("Settings action is missing");
            }
            await act(async () => {
                settings.click();
                await Promise.resolve();
            });
            expect(rendered.container.textContent).toContain("Settings");
        } finally {
            await rendered.unmount();
        }
    });
});
