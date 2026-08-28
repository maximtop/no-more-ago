/**
 * @file Verifies universal popup status and site controls.
 */

import { beforeAll, describe, expect, it } from "vitest";
/* eslint-disable @typescript-eslint/require-await */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { PopupApp } from "../../../src/popup/app";
import { PopupClient, type PopupTransport } from "../../../src/popup/client";
import type { PopupState } from "../../../src/shared/messages";

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
 * @returns - Mounted container and cleanup function.
 */
async function renderPopup(
    state: PopupState,
    transport: PopupTransport = { sendMessage: () => Promise.resolve(state) },
): Promise<{ container: HTMLDivElement; unmount: () => Promise<void> }> {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
        root.render(<PopupApp initialState={state} client={new PopupClient(transport)} />);
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
});
