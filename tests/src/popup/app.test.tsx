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

const active: PopupState = {
    availability: "ready",
    revision: 2,
    globalEnabled: true,
    hostname: "example.test",
    siteEnabled: true,
    status: "active",
};

beforeAll(() => {
    (
        globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    Object.defineProperty(window, "matchMedia", {
        configurable: true,
        value: () => ({
            matches: false,
            media: "",
            onchange: null,
            addListener: () => undefined,
            removeListener: () => undefined,
            addEventListener: () => undefined,
            removeEventListener: () => undefined,
            dispatchEvent: () => false,
        }),
    });
});

/**
 * Renders the popup with a preloaded state.
 *
 * @param state - Popup state to render.
 * @param transport - Background message transport.
 * @param openOptionsPage - Browser boundary used to open the Options page.
 * @returns - Mounted container and cleanup function.
 */
async function renderPopup(
    state: PopupState,
    transport: PopupTransport = { sendMessage: () => Promise.resolve(state) },
    openOptionsPage = () => Promise.resolve(),
): Promise<{ container: HTMLDivElement; unmount: () => Promise<void> }> {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
        root.render(
            <PopupApp
                initialState={state}
                client={new PopupClient(transport)}
                openOptionsPage={openOptionsPage}
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
            expect(container.textContent).toContain("Loading…");

            await act(async () => {
                await vi.advanceTimersByTimeAsync(5_000);
            });

            expect(container.textContent).not.toContain("Loading…");
            expect(container.textContent).toContain(
                "Settings are unavailable. Processing is disabled.",
            );
        } finally {
            await act(async () => {
                root.unmount();
            });
            container.remove();
            vi.useRealTimers();
        }
    });

    it("renders active status and a site switch for any HTTP(S) hostname", async () => {
        const rendered = await renderPopup(active);
        expect(rendered.container.textContent).toContain("Active on example.test");
        expect(rendered.container.querySelectorAll("input[type=checkbox]")).toHaveLength(2);
        await rendered.unmount();
    });

    it("renders inaccessible state without adapter-specific no-rules wording", async () => {
        const rendered = await renderPopup({
            ...active,
            hostname: null,
            siteEnabled: null,
            status: "inaccessible",
        });
        expect(rendered.container.textContent).toContain("Cannot run on this page");
        expect(rendered.container.textContent).not.toMatch(/no rules|adapter/iu);
        await rendered.unmount();
    });

    it("opens Settings once through the browser Options-page boundary", async () => {
        let openCalls = 0;
        const rendered = await renderPopup(
            active,
            { sendMessage: () => Promise.resolve(active) },
            async () => {
                openCalls += 1;
            },
        );
        try {
            const settings = [...rendered.container.querySelectorAll("button")].find(
                (candidate) => candidate.textContent === "Settings",
            );
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
        const rendered = await renderPopup(
            active,
            { sendMessage: () => Promise.resolve(active) },
            () => Promise.reject(new Error("Options page unavailable")),
        );
        try {
            const settings = [...rendered.container.querySelectorAll("button")].find(
                (candidate) => candidate.textContent === "Settings",
            );
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
