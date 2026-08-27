/**
 * @file Verifies options UI rendering, settings mutations, diagnostics, and reporting.
 */

/* eslint-disable @typescript-eslint/require-await */
import { beforeAll, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import {
    CLEAR_DIAGNOSTICS_MESSAGE,
    GET_DEBUG_STATE_MESSAGE,
    GET_DIAGNOSTICS_SNAPSHOT_MESSAGE,
    GET_DISPLAY_STATE_MESSAGE,
    GET_SITES_STATE_MESSAGE,
    RESET_ALL_SETTINGS_MESSAGE,
    SET_DEBUG_ENABLED_MESSAGE,
    SET_DISPLAY_SETTINGS_MESSAGE,
    SET_SITE_ENABLED_MESSAGE,
} from "../../src/shared/messages";
import type {
    DebugState,
    DisplaySettings,
    DisplayState,
    SitesState,
} from "../../src/shared/messages";
import { OptionsApp } from "../../src/options/app";
import { SitesClient, type SitesTransport } from "../../src/options/client";
import type { DownloadRuntime } from "../../src/options/diagnostics/archive";
import type { SiteReportReporter } from "../../src/shared/reporting/site-report";

const ready: SitesState = {
    availability: "ready",
    revision: 4,
    globalEnabled: true,
    sites: [
        { hostname: "github.com", enabled: true, hasAdapter: true },
        { hostname: "example.test", enabled: false, hasAdapter: false },
        { hostname: "example.test.", enabled: true, hasAdapter: false },
        { hostname: "xn--bcher-kva.example", enabled: true, hasAdapter: false },
    ],
};

const displayReady: DisplayState = {
    availability: "ready",
    revision: 4,
    display: { formatMode: "system", timeZone: { mode: "system" } },
    debugEnabled: false,
};
const debugReady: DebugState = { availability: "ready", revision: 4, enabled: false };

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
 * Renders the options application with injectable background and browser dependencies.
 *
 * @param state - Initial sites settings state.
 * @param transport - Background message transport used by the client.
 * @param initialDisplayState - Initial display settings state.
 * @param initialDebugState - Initial diagnostic logging state.
 * @param archiveRuntime - Optional diagnostics archive download runtime.
 * @param reporter - Optional site-report service.
 * @returns - Mounted container and asynchronous cleanup action.
 */
async function renderOptions(
    state: SitesState,
    transport: SitesTransport = { sendMessage: () => Promise.resolve(state) },
    initialDisplayState: DisplayState | undefined = displayReady,
    initialDebugState: DebugState | undefined = debugReady,
    archiveRuntime?: DownloadRuntime,
    reporter?: SiteReportReporter,
): Promise<{ container: HTMLDivElement; unmount: () => Promise<void> }> {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const archiveProps = archiveRuntime ? { archiveRuntime } : {};
    const reporterProps = reporter ? { reporter } : {};
    await act(async () => {
        root.render(
            <OptionsApp
                initialState={state}
                initialDisplayState={initialDisplayState}
                initialDebugState={initialDebugState}
                {...archiveProps}
                {...reporterProps}
                client={new SitesClient(transport)}
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

/**
 * Updates a controlled input through its native value setter and DOM events.
 *
 * @param control - Input or select element to update.
 * @param value - New control value.
 */
function setControlValue(control: HTMLInputElement | HTMLSelectElement, value: string): void {
    const prototype =
        control instanceof HTMLSelectElement
            ? HTMLSelectElement.prototype
            : HTMLInputElement.prototype;
    // React's controlled-input tracker requires the native setter.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    if (setter) {
        Reflect.apply(setter, control, [value]);
    }
    control.dispatchEvent(new Event("input", { bubbles: true }));
    control.dispatchEvent(new Event("change", { bubbles: true }));
}

describe("Options Sites contract", () => {
    it("shows one reset action for ready and unavailable Sites projections", async () => {
        const unavailable: SitesState = {
            availability: "unavailable",
            revision: null,
            globalEnabled: null,
            sites: [],
            failure: "settings-load",
        };
        const rendered = await renderOptions(
            unavailable,
            { sendMessage: () => Promise.resolve(unavailable) },
            {
                availability: "unavailable",
                revision: null,
                display: null,
                failure: "settings-load",
            },
        );
        try {
            expect(
                rendered.container.querySelector('button:not([type="submit"])')?.textContent,
            ).toContain("Reset all settings");
            const readyRendered = await renderOptions(ready);
            try {
                expect(
                    [...readyRendered.container.querySelectorAll("button")].filter((button) =>
                        button.textContent.includes("Reset all settings"),
                    ),
                ).toHaveLength(1);
            } finally {
                await readyRendered.unmount();
            }
        } finally {
            await rendered.unmount();
        }
    });

    it("resets settings once, accepts revision zero, and rehydrates defaults", async () => {
        const custom: DisplayState = {
            ...displayReady,
            display: {
                formatMode: "custom",
                pattern: "EEEE, d MMMM yyyy",
                timeZone: { mode: "iana", identifier: "America/New_York" },
            },
        };
        const debugOn: DebugState = { ...debugReady, enabled: true };
        const messages: unknown[] = [];
        const resetState: SitesState = {
            availability: "ready",
            revision: 0,
            globalEnabled: true,
            sites: [{ hostname: "github.com", enabled: true, hasAdapter: true }],
        };
        const resetDisplay: DisplayState = {
            availability: "ready",
            revision: 0,
            display: { formatMode: "system", timeZone: { mode: "system" } },
            debugEnabled: false,
        };
        const resetDebug: DebugState = { availability: "ready", revision: 0, enabled: false };
        const rendered = await renderOptions(
            ready,
            {
                sendMessage: (message) => {
                    messages.push(message);
                    if (
                        message &&
                        typeof message === "object" &&
                        "type" in message &&
                        message.type === RESET_ALL_SETTINGS_MESSAGE
                    ) {
                        return Promise.resolve({
                            ok: true,
                            acceptedRevision: 0,
                            state: resetState,
                        });
                    }
                    if (
                        message &&
                        typeof message === "object" &&
                        "type" in message &&
                        message.type === GET_DISPLAY_STATE_MESSAGE
                    ) {
                        return Promise.resolve(resetDisplay);
                    }
                    if (
                        message &&
                        typeof message === "object" &&
                        "type" in message &&
                        message.type === GET_DEBUG_STATE_MESSAGE
                    ) {
                        return Promise.resolve(resetDebug);
                    }
                    return Promise.resolve(ready);
                },
            },
            custom,
            debugOn,
        );
        try {
            const format = rendered.container.querySelector<HTMLSelectElement>(
                'select[aria-label="Date format"]',
            );
            const zone = rendered.container.querySelector<HTMLSelectElement>(
                'select[aria-label="Time zone"]',
            );
            const pattern = rendered.container.querySelector<HTMLInputElement>(
                'input[aria-label="Format pattern"]',
            );
            const reset = [...rendered.container.querySelectorAll("button")].find((button) =>
                button.textContent.includes("Reset all settings"),
            );
            if (!format || !zone || !pattern || !reset) {
                throw new Error("Healthy reset controls are missing");
            }
            expect(format.value).toBe("custom");
            await act(async () => {
                setControlValue(format, "custom");
                setControlValue(zone, "iana");
                setControlValue(pattern, "yyyy-MM-dd");
            });
            const identifier = rendered.container.querySelector<HTMLInputElement>(
                'input[aria-label="IANA time zone identifier"]',
            );
            if (!identifier) {
                throw new Error("IANA identifier is missing");
            }
            await act(async () => {
                setControlValue(identifier, "America/New_York");
            });
            const save = [...rendered.container.querySelectorAll("button")].find(
                (button) => button.textContent === "Save",
            );
            if (!save) {
                throw new Error("Display save action is missing");
            }
            await act(async () => {
                setControlValue(pattern, "YYYY-MM-dd");
                save.click();
            });
            const download = [...rendered.container.querySelectorAll("button")].find(
                (button) => button.textContent === "Download logs",
            );
            if (!download) {
                throw new Error("Download logs action is missing");
            }
            await act(async () => {
                download.click();
            });
            expect(rendered.container.textContent).toMatch(/date format is invalid|unavailable/i);
            await act(async () => {
                reset.click();
            });
            expect(
                messages.filter(
                    (message) =>
                        message &&
                        typeof message === "object" &&
                        "type" in message &&
                        message.type === RESET_ALL_SETTINGS_MESSAGE,
                ),
            ).toHaveLength(1);
            expect(
                messages.filter(
                    (message) =>
                        message &&
                        typeof message === "object" &&
                        "type" in message &&
                        message.type === GET_DISPLAY_STATE_MESSAGE,
                ),
            ).toHaveLength(1);
            expect(
                messages.filter(
                    (message) =>
                        message &&
                        typeof message === "object" &&
                        "type" in message &&
                        message.type === GET_DEBUG_STATE_MESSAGE,
                ),
            ).toHaveLength(1);
            expect(
                rendered.container.querySelectorAll('input[aria-label^="Enabled on"]'),
            ).toHaveLength(1);
            expect(rendered.container.textContent).toContain("github.com");
            expect(rendered.container.textContent).not.toContain("example.test");
            expect(
                rendered.container.querySelector<HTMLSelectElement>(
                    'select[aria-label="Date format"]',
                )?.value,
            ).toBe("system");
            expect(
                rendered.container.querySelector<HTMLSelectElement>(
                    'select[aria-label="Time zone"]',
                )?.value,
            ).toBe("system");
            expect(
                rendered.container.querySelector('input[aria-label="Format pattern"]'),
            ).toBeNull();
            expect(
                rendered.container.querySelector<HTMLInputElement>('input[aria-label="Debug logs"]')
                    ?.checked,
            ).toBe(false);
            expect(rendered.container.textContent).not.toContain("date format is invalid");
            expect(rendered.container.textContent).not.toContain("Diagnostic logs are unavailable");
            const resetDownload = [...rendered.container.querySelectorAll("button")].find(
                (button) => button.textContent === "Download logs",
            );
            const clear = [...rendered.container.querySelectorAll("button")].find(
                (button) => button.textContent === "Clear logs",
            );
            expect(resetDownload?.disabled).toBe(true);
            expect(clear?.disabled).toBe(true);
        } finally {
            await rendered.unmount();
        }
    });

    it("keeps healthy settings and drafts active after a typed reset failure", async () => {
        const custom: DisplayState = {
            ...displayReady,
            display: { formatMode: "custom", pattern: "yyyy-MM-dd", timeZone: { mode: "utc" } },
        };
        const debugOn: DebugState = { ...debugReady, enabled: true };
        let resetCalls = 0;
        const rendered = await renderOptions(
            ready,
            {
                sendMessage: (message) => {
                    if (
                        message &&
                        typeof message === "object" &&
                        "type" in message &&
                        message.type === RESET_ALL_SETTINGS_MESSAGE
                    ) {
                        resetCalls += 1;
                        return Promise.resolve({ ok: false, error: "save-failed", state: ready });
                    }
                    return Promise.resolve(ready);
                },
            },
            custom,
            debugOn,
        );
        try {
            const reset = [...rendered.container.querySelectorAll("button")].find((button) =>
                button.textContent.includes("Reset all settings"),
            );
            if (!reset) {
                throw new Error("Reset action is missing");
            }
            await act(async () => {
                reset.click();
            });
            expect(resetCalls).toBe(1);
            expect(rendered.container.textContent).toContain("current settings remain active");
            expect(
                rendered.container.querySelector<HTMLInputElement>(
                    'input[aria-label="Format pattern"]',
                )?.value,
            ).toBe("yyyy-MM-dd");
            expect(
                rendered.container.querySelector<HTMLInputElement>('input[aria-label="Debug logs"]')
                    ?.checked,
            ).toBe(true);
            expect(rendered.container.textContent).toContain("example.test");
            expect(rendered.container.textContent).not.toContain("Processing remains disabled");
        } finally {
            await rendered.unmount();
        }
    });

    it("keeps a healthy projection after an interrupted reset without retrying", async () => {
        let resetCalls = 0;
        const rendered = await renderOptions(ready, {
            sendMessage: (message) => {
                if (
                    message &&
                    typeof message === "object" &&
                    "type" in message &&
                    message.type === RESET_ALL_SETTINGS_MESSAGE
                ) {
                    resetCalls += 1;
                    return Promise.reject(new Error("response interrupted"));
                }
                return Promise.resolve(ready);
            },
        });
        try {
            const reset = [...rendered.container.querySelectorAll("button")].find((button) =>
                button.textContent.includes("Reset all settings"),
            );
            if (!reset) {
                throw new Error("Reset action is missing");
            }
            await act(async () => {
                reset.click();
            });
            expect(resetCalls).toBe(1);
            expect(rendered.container.textContent).toContain(
                "Could not confirm whether settings were reset. "
                    + "Reopen Settings to check their current state.",
            );
            expect(rendered.container.textContent).not.toContain("current settings remain active");
            expect(rendered.container.textContent).not.toContain("Processing remains disabled");
            expect(rendered.container.textContent).toContain("example.test");
        } finally {
            await rendered.unmount();
        }
    });

    it("dispatches one reset and rehydrates default display and diagnostics", async () => {
        const unavailable: SitesState = {
            availability: "unavailable",
            revision: null,
            globalEnabled: null,
            sites: [],
            failure: "settings-load",
        };
        const unavailableDisplay: DisplayState = {
            availability: "unavailable",
            revision: null,
            display: null,
            failure: "settings-load",
        };
        const unavailableDebug: DebugState = {
            availability: "unavailable",
            revision: null,
            enabled: null,
            failure: "settings-load",
        };
        const messages: unknown[] = [];
        const rendered = await renderOptions(
            unavailable,
            {
                sendMessage: (message) => {
                    messages.push(message);
                    if (
                        message &&
                        typeof message === "object" &&
                        "type" in message &&
                        message.type === RESET_ALL_SETTINGS_MESSAGE
                    ) {
                        return Promise.resolve({
                            ok: true,
                            acceptedRevision: 0,
                            state: {
                                availability: "ready",
                                revision: 0,
                                globalEnabled: true,
                                sites: [
                                    { hostname: "github.com", enabled: true, hasAdapter: true },
                                ],
                            },
                        });
                    }
                    if (
                        message &&
                        typeof message === "object" &&
                        "type" in message &&
                        message.type === GET_DISPLAY_STATE_MESSAGE
                    ) {
                        return Promise.resolve(displayReady);
                    }
                    if (
                        message &&
                        typeof message === "object" &&
                        "type" in message &&
                        message.type === GET_DEBUG_STATE_MESSAGE
                    ) {
                        return Promise.resolve({
                            availability: "ready",
                            revision: 0,
                            enabled: false,
                        });
                    }
                    return Promise.reject(new Error("unexpected message"));
                },
            },
            unavailableDisplay,
            unavailableDebug,
        );
        try {
            const reset = [...rendered.container.querySelectorAll("button")].find((button) =>
                button.textContent.includes("Reset all settings"),
            );
            if (!reset) {
                throw new Error("Recovery button is missing");
            }
            await act(async () => {
                reset.click();
            });
            expect(
                messages.filter(
                    (message) =>
                        message &&
                        typeof message === "object" &&
                        "type" in message &&
                        message.type === RESET_ALL_SETTINGS_MESSAGE,
                ),
            ).toHaveLength(1);
            expect(
                messages.filter(
                    (message) =>
                        message &&
                        typeof message === "object" &&
                        "type" in message &&
                        message.type === GET_DISPLAY_STATE_MESSAGE,
                ),
            ).toHaveLength(1);
            expect(
                messages.filter(
                    (message) =>
                        message &&
                        typeof message === "object" &&
                        "type" in message &&
                        message.type === GET_DEBUG_STATE_MESSAGE,
                ),
            ).toHaveLength(1);
            expect(rendered.container.textContent).toContain("github.com");
            expect(
                rendered.container.querySelector<HTMLSelectElement>(
                    'select[aria-label="Time zone"]',
                )?.value,
            ).toBe("system");
            expect(
                rendered.container.querySelector<HTMLInputElement>('input[aria-label="Debug logs"]')
                    ?.checked,
            ).toBe(false);
            expect(rendered.container.textContent).not.toContain("Debug logs are unavailable");
            expect(rendered.container.textContent).not.toContain("Processing is disabled");
        } finally {
            await rendered.unmount();
        }
    });

    it("keeps recovery unavailable after a typed persistence failure", async () => {
        const unavailable: SitesState = {
            availability: "unavailable",
            revision: null,
            globalEnabled: null,
            sites: [],
            failure: "settings-load",
        };
        const rendered = await renderOptions(
            unavailable,
            {
                sendMessage: (message) =>
                    message &&
                    typeof message === "object" &&
                    "type" in message &&
                    message.type === RESET_ALL_SETTINGS_MESSAGE
                        ? Promise.resolve({ ok: false, error: "save-failed", state: unavailable })
                        : Promise.resolve(unavailable),
            },
            {
                availability: "unavailable",
                revision: null,
                display: null,
                failure: "settings-load",
            },
        );
        try {
            const reset = [...rendered.container.querySelectorAll("button")].find((button) =>
                button.textContent.includes("Reset all settings"),
            );
            if (!reset) {
                throw new Error("Recovery button is missing");
            }
            await act(async () => {
                reset.click();
            });
            expect(rendered.container.textContent).toContain("Could not reset settings");
            expect(rendered.container.textContent).toContain("Processing remains disabled");
            expect(rendered.container.textContent).toContain("Try again");
            expect(rendered.container.textContent).not.toContain("github.com");
        } finally {
            await rendered.unmount();
        }
    });

    it("does not retry an interrupted or malformed reset response", async () => {
        const unavailable: SitesState = {
            availability: "unavailable",
            revision: null,
            globalEnabled: null,
            sites: [],
            failure: "settings-load",
        };
        let resetCalls = 0;
        let reads = 0;
        const rendered = await renderOptions(
            unavailable,
            {
                sendMessage: (message) => {
                    if (
                        message &&
                        typeof message === "object" &&
                        "type" in message &&
                        message.type === RESET_ALL_SETTINGS_MESSAGE
                    ) {
                        resetCalls += 1;
                        return Promise.reject(new Error("response interrupted"));
                    }
                    reads += 1;
                    return Promise.resolve(unavailable);
                },
            },
            {
                availability: "unavailable",
                revision: null,
                display: null,
                failure: "settings-load",
            },
        );
        try {
            const reset = [...rendered.container.querySelectorAll("button")].find((button) =>
                button.textContent.includes("Reset all settings"),
            );
            if (!reset) {
                throw new Error("Recovery button is missing");
            }
            await act(async () => {
                reset.click();
            });
            expect(resetCalls).toBe(1);
            expect(reads).toBe(0);
            expect(rendered.container.textContent).toContain("response could not be confirmed");
        } finally {
            await rendered.unmount();
        }
    });

    it("disables the recovery action while a reset is in flight", async () => {
        const unavailable: SitesState = {
            availability: "unavailable",
            revision: null,
            globalEnabled: null,
            sites: [],
            failure: "settings-load",
        };
        let release: ((value: unknown) => void) | undefined;
        const pending = new Promise<unknown>((resolve) => {
            release = resolve;
        });
        let resetCalls = 0;
        const rendered = await renderOptions(
            unavailable,
            {
                sendMessage: (message) => {
                    if (
                        message &&
                        typeof message === "object" &&
                        "type" in message &&
                        message.type === RESET_ALL_SETTINGS_MESSAGE
                    ) {
                        resetCalls += 1;
                        return pending;
                    }
                    return Promise.resolve(unavailable);
                },
            },
            {
                availability: "unavailable",
                revision: null,
                display: null,
                failure: "settings-load",
            },
        );
        try {
            const reset = [...rendered.container.querySelectorAll("button")].find((button) =>
                button.textContent.includes("Reset all settings"),
            );
            if (!reset) {
                throw new Error("Recovery button is missing");
            }
            await act(async () => {
                reset.click();
                reset.click();
            });
            expect(resetCalls).toBe(1);
            expect(reset.disabled).toBe(true);
            release?.({ ok: false, error: "settings-unavailable", state: unavailable });
            await act(async () => {
                await pending;
            });
        } finally {
            await rendered.unmount();
        }
    });

    it("renders only the built-in and explicitly retained exact-host rows", async () => {
        const rendered = await renderOptions(ready);
        try {
            expect(rendered.container.textContent).toContain("Sites");
            expect(rendered.container.textContent).toContain("github.com");
            expect(rendered.container.textContent).toContain("example.test.");
            expect(rendered.container.textContent).toContain("xn--bcher-kva.example");
            expect(rendered.container.querySelectorAll('input[type="checkbox"]')).toHaveLength(5);
            expect(rendered.container.textContent).not.toMatch(/report|counter|preview/i);
        } finally {
            await rendered.unmount();
        }
    });

    it("keeps site controls usable while global policy is off", async () => {
        const off: SitesState = { ...ready, globalEnabled: false };
        let write: unknown;
        const rendered = await renderOptions(off, {
            sendMessage: (message) => {
                if (
                    message &&
                    typeof message === "object" &&
                    "type" in message &&
                    message.type === SET_SITE_ENABLED_MESSAGE
                ) {
                    write = message;
                    return Promise.resolve({
                        ok: true,
                        acceptedRevision: 5,
                        surface: "sites",
                        state: {
                            ...off,
                            revision: 5,
                            sites: off.sites.map((site) =>
                                site.hostname === "example.test"
                                    ? { ...site, enabled: true }
                                    : site,
                            ),
                        },
                    });
                }
                return Promise.resolve(off);
            },
        });
        try {
            expect(rendered.container.textContent).toContain("The extension is off");
            const input = rendered.container.querySelector(
                'input[aria-label="Enabled on example.test"]',
            ) as HTMLInputElement;
            expect(input.disabled).toBe(false);
            await act(async () => {
                input.click();
            });
            expect(write).toMatchObject({
                type: SET_SITE_ENABLED_MESSAGE,
                hostname: "example.test",
                enabled: true,
                surface: "sites",
            });
            expect(
                rendered.container.querySelector<HTMLInputElement>(
                    'input[aria-label="Enabled on example.test"]',
                )?.checked,
            ).toBe(true);
        } finally {
            await rendered.unmount();
        }
    });

    it("shows typed invalid-hostname without an ambiguous reread", async () => {
        let rereads = 0;
        const rendered = await renderOptions(ready, {
            sendMessage: (message) => {
                if (
                    message &&
                    typeof message === "object" &&
                    "type" in message &&
                    message.type === SET_SITE_ENABLED_MESSAGE
                ) {
                    return Promise.resolve({
                        ok: false,
                        error: "invalid-hostname",
                        surface: "sites",
                        state: ready,
                    });
                }
                rereads += 1;
                return Promise.resolve(ready);
            },
        });
        try {
            const input = rendered.container.querySelector(
                'input[aria-label="Enabled on github.com"]',
            ) as HTMLInputElement;
            await act(async () => {
                input.click();
            });
            expect(rendered.container.textContent).toContain("hostname is invalid");
            expect(rereads).toBe(0);
        } finally {
            await rendered.unmount();
        }
    });

    it("rereads only after a genuinely ambiguous response and gates lower revisions", async () => {
        let getCalls = 0;
        const committed: SitesState = { ...ready, revision: 5, globalEnabled: false };
        const rendered = await renderOptions(ready, {
            sendMessage: (message) => {
                if (
                    message &&
                    typeof message === "object" &&
                    "type" in message &&
                    message.type === SET_SITE_ENABLED_MESSAGE
                ) {
                    return Promise.reject(new Error("response lost"));
                }
                if (
                    message &&
                    typeof message === "object" &&
                    "type" in message &&
                    message.type === GET_SITES_STATE_MESSAGE
                ) {
                    getCalls += 1;
                    return Promise.resolve(committed);
                }
                return Promise.reject(new Error("unexpected"));
            },
        });
        try {
            const input = rendered.container.querySelector(
                'input[aria-label="Enabled on github.com"]',
            ) as HTMLInputElement;
            await act(async () => {
                input.click();
            });
            expect(getCalls).toBe(1);
            expect(rendered.container.textContent).toContain("response was interrupted");
            expect(rendered.container.textContent).toContain("extension is off");
        } finally {
            await rendered.unmount();
        }
    });

    it("renders a fail-closed unavailable state without exposing retained rows", async () => {
        const unavailable: SitesState = {
            availability: "unavailable",
            revision: null,
            globalEnabled: null,
            sites: [],
            failure: "fail-closed-cleanup",
        };
        const rendered = await renderOptions(unavailable);
        try {
            expect(rendered.container.textContent).toContain("Current processing state is unknown");
            expect(rendered.container.textContent).not.toContain("github.com");
            expect(rendered.container.querySelectorAll('input[type="checkbox"]')).toHaveLength(0);
        } finally {
            await rendered.unmount();
        }
    });

    it("preserves the authoritative checked row after a typed save failure", async () => {
        let rereads = 0;
        const rendered = await renderOptions(ready, {
            sendMessage: (message) => {
                if (
                    message &&
                    typeof message === "object" &&
                    "type" in message &&
                    message.type === SET_SITE_ENABLED_MESSAGE
                ) {
                    return Promise.resolve({
                        ok: false,
                        error: "save-failed",
                        surface: "sites",
                        state: ready,
                    });
                }
                rereads += 1;
                return Promise.resolve(ready);
            },
        });
        try {
            const input = rendered.container.querySelector(
                'input[aria-label="Enabled on github.com"]',
            ) as HTMLInputElement;
            await act(async () => {
                input.click();
            });
            expect(input.checked).toBe(true);
            expect(rendered.container.textContent).toContain(
                "Could not save this change. Try again.",
            );
            expect(rereads).toBe(0);
        } finally {
            await rendered.unmount();
        }
    });

    it("removes rows and reports unknown state when command and reread fail", async () => {
        const rendered = await renderOptions(ready, {
            sendMessage: (message) => {
                if (
                    message &&
                    typeof message === "object" &&
                    "type" in message &&
                    (message.type === SET_SITE_ENABLED_MESSAGE ||
                        message.type === GET_SITES_STATE_MESSAGE)
                ) {
                    return Promise.reject(new Error("transport lost"));
                }
                return Promise.resolve(ready);
            },
        });
        try {
            const input = rendered.container.querySelector(
                'input[aria-label="Enabled on github.com"]',
            ) as HTMLInputElement;
            await act(async () => {
                input.click();
            });
            expect(
                rendered.container.querySelectorAll('input[aria-label^="Enabled on"]').length,
            ).toBe(0);
            expect(rendered.container.textContent).toContain(
                "Could not confirm whether the change was saved",
            );
            expect(rendered.container.textContent).toContain("Current state is unavailable");
            expect(rendered.container.textContent).not.toContain("github.com");
        } finally {
            await rendered.unmount();
        }
    });

    it("ignores an actual stale lower-revision Sites response", async () => {
        const stale: SitesState = {
            ...ready,
            revision: 3,
            sites: ready.sites.map((site) =>
                site.hostname === "github.com" ? { ...site, enabled: false } : site,
            ),
        };
        const rendered = await renderOptions(ready, {
            sendMessage: (message) =>
                message &&
                typeof message === "object" &&
                "type" in message &&
                message.type === SET_SITE_ENABLED_MESSAGE
                    ? Promise.resolve({
                        ok: true,
                        acceptedRevision: 3,
                        surface: "sites",
                        state: stale,
                    })
                    : Promise.resolve(ready),
        });
        try {
            const input = rendered.container.querySelector(
                'input[aria-label="Enabled on github.com"]',
            ) as HTMLInputElement;
            await act(async () => {
                input.click();
            });
            expect(input.checked).toBe(true);
            expect(rendered.container.textContent).not.toContain("Could not save");
        } finally {
            await rendered.unmount();
        }
    });
});

describe("Options Display contract", () => {
    it("renders System by default and reveals the selected IANA control", async () => {
        const rendered = await renderOptions(ready);
        try {
            expect(rendered.container.textContent).toContain("Display");
            expect(rendered.container.textContent).toContain("Date format");
            expect(
                rendered.container.querySelector<HTMLSelectElement>(
                    'select[aria-label="Time zone"]',
                )?.value,
            ).toBe("system");
            expect(
                rendered.container.querySelector('input[aria-label="IANA time zone identifier"]'),
            ).toBeNull();
            const select = rendered.container.querySelector<HTMLSelectElement>(
                'select[aria-label="Time zone"]',
            );
            if (!select) {
                throw new Error("Time zone select is missing");
            }
            await act(async () => {
                setControlValue(select, "iana");
            });
            expect(
                rendered.container.querySelector('input[aria-label="IANA time zone identifier"]'),
            ).not.toBeNull();
            expect(rendered.container.textContent).not.toMatch(/date-fns|combined/i);
        } finally {
            await rendered.unmount();
        }
    });

    it("keeps a draft until Save and sends supported IANA values", async () => {
        const writes: unknown[] = [];
        const rendered = await renderOptions(ready, {
            sendMessage: (message) => {
                if (
                    message &&
                    typeof message === "object" &&
                    "type" in message &&
                    message.type === SET_DISPLAY_SETTINGS_MESSAGE
                ) {
                    writes.push(message);
                    return Promise.resolve({
                        ok: true,
                        acceptedRevision: displayReady.revision + writes.length,
                        state: {
                            ...displayReady,
                            revision: displayReady.revision + writes.length,
                            display: (
                                message as unknown as { display: typeof displayReady.display }
                            ).display,
                        },
                        refreshFailures: [],
                    });
                }
                return Promise.resolve(ready);
            },
        });
        try {
            const select = rendered.container.querySelector<HTMLSelectElement>(
                'select[aria-label="Time zone"]',
            );
            const save =
                rendered.container.querySelector<HTMLButtonElement>('button[type="button"]');
            if (!select || !save) {
                throw new Error("Display controls are missing");
            }
            await act(async () => {
                setControlValue(select, "iana");
            });
            const identifier = rendered.container.querySelector<HTMLInputElement>(
                'input[aria-label="IANA time zone identifier"]',
            );
            if (!identifier) {
                throw new Error("IANA identifier is missing");
            }
            await act(async () => {
                setControlValue(identifier, "CET");
            });
            expect(writes).toHaveLength(0);
            await act(async () => {
                save.click();
            });
            expect(writes).toHaveLength(1);
            expect(writes[0]).toMatchObject({
                type: SET_DISPLAY_SETTINGS_MESSAGE,
                display: { timeZone: { mode: "iana", identifier: "CET" } },
            });
            await act(async () => {
                setControlValue(identifier, "America/New_York");
            });
            await act(async () => {
                save.click();
            });
            expect(writes).toHaveLength(2);
            expect(writes[1]).toMatchObject({
                display: { timeZone: { identifier: "America/New_York" } },
            });
        } finally {
            await rendered.unmount();
        }
    });

    it("blocks malformed and unsupported identifiers without sending a message", async () => {
        let writes = 0;
        const rendered = await renderOptions(ready, {
            sendMessage: (message) => {
                if (
                    message &&
                    typeof message === "object" &&
                    "type" in message &&
                    message.type === SET_DISPLAY_SETTINGS_MESSAGE
                ) {
                    writes += 1;
                }
                return Promise.resolve(ready);
            },
        });
        try {
            const select = rendered.container.querySelector<HTMLSelectElement>(
                'select[aria-label="Time zone"]',
            );
            if (!select) {
                throw new Error("Time zone select is missing");
            }
            await act(async () => {
                setControlValue(select, "iana");
            });
            const identifier = rendered.container.querySelector<HTMLInputElement>(
                'input[aria-label="IANA time zone identifier"]',
            );
            const save =
                rendered.container.querySelector<HTMLButtonElement>('button[type="button"]');
            if (!identifier || !save) {
                throw new Error("IANA controls are missing");
            }
            await act(async () => {
                setControlValue(identifier, "../secret");
                save.click();
            });
            expect(writes).toBe(0);
            expect(rendered.container.textContent).toMatch(
                /valid IANA|path traversal|unavailable/i,
            );
            await act(async () => {
                setControlValue(identifier, "No/SuchZone");
                save.click();
            });
            expect(writes).toBe(0);
            expect(rendered.container.textContent).toMatch(/valid IANA|unavailable/i);
        } finally {
            await rendered.unmount();
        }
    });

    it("preserves committed state on typed failure and warns after a partial refresh", async () => {
        let mode: "failure" | "partial" = "failure";
        const rendered = await renderOptions(ready, {
            sendMessage: (message) => {
                if (
                    message &&
                    typeof message === "object" &&
                    "type" in message &&
                    message.type === SET_DISPLAY_SETTINGS_MESSAGE
                ) {
                    if (mode === "failure") {
                        return Promise.resolve({
                            ok: false,
                            error: "save-failed",
                            state: displayReady,
                        });
                    }
                    return Promise.resolve({
                        ok: true,
                        acceptedRevision: 5,
                        state: {
                            ...displayReady,
                            revision: 5,
                            display: { formatMode: "system", timeZone: { mode: "utc" } },
                        },
                        refreshFailures: [
                            { hostname: "github.com", tabId: 1, reason: "tab-update" },
                        ],
                    });
                }
                return Promise.resolve(ready);
            },
        });
        try {
            const select = rendered.container.querySelector<HTMLSelectElement>(
                'select[aria-label="Time zone"]',
            );
            const save =
                rendered.container.querySelector<HTMLButtonElement>('button[type="button"]');
            if (!select || !save) {
                throw new Error("Display controls are missing");
            }
            await act(async () => {
                setControlValue(select, "utc");
                save.click();
            });
            expect(rendered.container.textContent).toContain("previous format remains active");
            expect(select.value).toBe("system");
            mode = "partial";
            await act(async () => {
                setControlValue(select, "utc");
                save.click();
            });
            expect(rendered.container.textContent).toContain("could not be refreshed");
        } finally {
            await rendered.unmount();
        }
    });

    it("shows correction guidance for a saved zone that is unavailable at runtime", async () => {
        const unavailable: DisplayState = {
            ...displayReady,
            display: {
                formatMode: "system",
                timeZone: { mode: "iana", identifier: "Pacific/Apia" },
            },
            error: "unavailable-time-zone",
        };
        const rendered = await renderOptions(ready, undefined, unavailable);
        try {
            expect(
                rendered.container.querySelector<HTMLInputElement>(
                    'input[aria-label="IANA time zone identifier"]',
                )?.value,
            ).toBe("Pacific/Apia");
            expect(rendered.container.textContent).toContain("unavailable in this browser");
            expect(rendered.container.textContent).toContain("System");
        } finally {
            await rendered.unmount();
        }
    });

    it("rereads after an ambiguous save and applies a newer revision", async () => {
        let reads = 0;
        const reread: DisplayState = {
            ...displayReady,
            revision: 5,
            display: { formatMode: "system", timeZone: { mode: "utc" } },
        };
        const rendered = await renderOptions(ready, {
            sendMessage: (message) => {
                if (
                    message &&
                    typeof message === "object" &&
                    "type" in message &&
                    message.type === SET_DISPLAY_SETTINGS_MESSAGE
                ) {
                    return Promise.resolve({ unexpected: true });
                }
                if (
                    message &&
                    typeof message === "object" &&
                    "type" in message &&
                    message.type === GET_DISPLAY_STATE_MESSAGE
                ) {
                    reads += 1;
                    return Promise.resolve(reread);
                }
                return Promise.resolve(ready);
            },
        });
        try {
            const select = rendered.container.querySelector<HTMLSelectElement>(
                'select[aria-label="Time zone"]',
            );
            const save =
                rendered.container.querySelector<HTMLButtonElement>('button[type="button"]');
            if (!select || !save) {
                throw new Error("Display controls are missing");
            }
            await act(async () => {
                setControlValue(select, "utc");
                save.click();
            });
            expect(reads).toBe(1);
            expect(select.value).toBe("utc");
            expect(rendered.container.textContent).toContain("response was interrupted");
        } finally {
            await rendered.unmount();
        }
    });

    it("does not replace the committed display with a stale lower-revision response", async () => {
        const stale: DisplayState = {
            ...displayReady,
            revision: 3,
            display: { formatMode: "system", timeZone: { mode: "iana", identifier: "CET" } },
        };
        const rendered = await renderOptions(ready, {
            sendMessage: (message) =>
                message &&
                typeof message === "object" &&
                "type" in message &&
                message.type === SET_DISPLAY_SETTINGS_MESSAGE
                    ? Promise.resolve({
                        ok: true,
                        acceptedRevision: 3,
                        state: stale,
                        refreshFailures: [],
                    })
                    : Promise.resolve(ready),
        });
        try {
            const select = rendered.container.querySelector<HTMLSelectElement>(
                'select[aria-label="Time zone"]',
            );
            const save =
                rendered.container.querySelector<HTMLButtonElement>('button[type="button"]');
            if (!select || !save) {
                throw new Error("Display controls are missing");
            }
            await act(async () => {
                setControlValue(select, "utc");
                save.click();
            });
            expect(select.value).toBe("utc");
        } finally {
            await rendered.unmount();
        }
    });

    it("keeps Display usable while global processing is off", async () => {
        const rendered = await renderOptions({ ...ready, globalEnabled: false });
        try {
            expect(rendered.container.textContent).toContain("The extension is off");
            expect(
                rendered.container.querySelector<HTMLSelectElement>(
                    'select[aria-label="Time zone"]',
                )?.disabled,
            ).toBe(false);
            expect(
                rendered.container.querySelector<HTMLButtonElement>('button[type="button"]')
                    ?.disabled,
            ).toBe(false);
        } finally {
            await rendered.unmount();
        }
    });

    it("keeps custom edits local, shows a live preview, and saves one complete value", async () => {
        const writes: unknown[] = [];
        const rendered = await renderOptions(ready, {
            sendMessage: (message) => {
                if (
                    message &&
                    typeof message === "object" &&
                    "type" in message &&
                    message.type === SET_DISPLAY_SETTINGS_MESSAGE
                ) {
                    writes.push(message);
                    const display = (message as unknown as { display: DisplaySettings }).display;
                    return Promise.resolve({
                        ok: true,
                        acceptedRevision: 5,
                        state: { ...displayReady, revision: 5, display },
                        refreshFailures: [],
                    });
                }
                return Promise.resolve(ready);
            },
        });
        try {
            const format = rendered.container.querySelector<HTMLSelectElement>(
                'select[aria-label="Date format"]',
            );
            const save =
                rendered.container.querySelector<HTMLButtonElement>('button[type="button"]');
            if (!format || !save) {
                throw new Error("Custom format controls are missing");
            }
            await act(async () => {
                setControlValue(format, "custom");
            });
            const pattern = rendered.container.querySelector<HTMLInputElement>(
                'input[aria-label="Format pattern"]',
            );
            if (!pattern) {
                throw new Error("Format pattern is missing");
            }
            expect(rendered.container.textContent).toContain("Preview:");
            await act(async () => {
                setControlValue(pattern, "yyyy-MM-dd HH:mm");
            });
            expect(writes).toHaveLength(0);
            expect(rendered.container.textContent).toContain("Preview:");
            await act(async () => {
                save.click();
            });
            expect(writes).toHaveLength(1);
            expect(writes[0]).toMatchObject({
                type: SET_DISPLAY_SETTINGS_MESSAGE,
                display: {
                    formatMode: "custom",
                    pattern: "yyyy-MM-dd HH:mm",
                    timeZone: { mode: "system" },
                },
            });
        } finally {
            await rendered.unmount();
        }
    });

    it("blocks invalid custom patterns with an adjacent actionable error and no save", async () => {
        let writes = 0;
        const rendered = await renderOptions(ready, {
            sendMessage: (message) => {
                if (
                    message &&
                    typeof message === "object" &&
                    "type" in message &&
                    message.type === SET_DISPLAY_SETTINGS_MESSAGE
                ) {
                    writes += 1;
                }
                return Promise.resolve(ready);
            },
        });
        try {
            const format = rendered.container.querySelector<HTMLSelectElement>(
                'select[aria-label="Date format"]',
            );
            const save =
                rendered.container.querySelector<HTMLButtonElement>('button[type="button"]');
            if (!format || !save) {
                throw new Error("Custom format controls are missing");
            }
            await act(async () => {
                setControlValue(format, "custom");
            });
            const pattern = rendered.container.querySelector<HTMLInputElement>(
                'input[aria-label="Format pattern"]',
            );
            if (!pattern) {
                throw new Error("Format pattern is missing");
            }
            await act(async () => {
                setControlValue(pattern, "YYYY-MM-dd");
                save.click();
            });
            expect(writes).toBe(0);
            expect(pattern.getAttribute("aria-invalid")).toBe("true");
            expect(rendered.container.textContent).toMatch(/Unicode|yyyy|pattern/i);
            await act(async () => {
                setControlValue(pattern, "'");
                save.click();
            });
            expect(writes).toBe(0);
            expect(rendered.container.textContent).toMatch(/Close|quoted|pattern/i);
        } finally {
            await rendered.unmount();
        }
    });

    it("drops the custom pattern when switching back to System", async () => {
        const writes: unknown[] = [];
        const custom: DisplayState = {
            ...displayReady,
            display: { formatMode: "custom", pattern: "yyyy-MM-dd", timeZone: { mode: "utc" } },
        };
        const rendered = await renderOptions(
            ready,
            {
                sendMessage: (message) => {
                    if (
                        message &&
                        typeof message === "object" &&
                        "type" in message &&
                        message.type === SET_DISPLAY_SETTINGS_MESSAGE
                    ) {
                        writes.push(message);
                        return Promise.resolve({
                            ok: true,
                            acceptedRevision: 5,
                            state: {
                                ...custom,
                                revision: 5,
                                display: (message as unknown as { display: DisplaySettings })
                                    .display,
                            },
                            refreshFailures: [],
                        });
                    }
                    return Promise.resolve(ready);
                },
            },
            custom,
        );
        try {
            const format = rendered.container.querySelector<HTMLSelectElement>(
                'select[aria-label="Date format"]',
            );
            const save =
                rendered.container.querySelector<HTMLButtonElement>('button[type="button"]');
            if (!format || !save) {
                throw new Error("Custom format controls are missing");
            }
            await act(async () => {
                setControlValue(format, "system");
                save.click();
            });
            expect(writes).toHaveLength(1);
            expect(writes[0]).toMatchObject({
                display: { formatMode: "system", timeZone: { mode: "utc" } },
            });
            expect(writes[0]).not.toHaveProperty("display.pattern");
        } finally {
            await rendered.unmount();
        }
    });

    it("updates the preview without sending background intents", async () => {
        const writes: unknown[] = [];
        const rendered = await renderOptions(ready, {
            sendMessage: (message) => {
                if (
                    message &&
                    typeof message === "object" &&
                    "type" in message &&
                    message.type === SET_DISPLAY_SETTINGS_MESSAGE
                ) {
                    writes.push(message);
                }
                return Promise.resolve(displayReady);
            },
        });
        try {
            const format = rendered.container.querySelector<HTMLSelectElement>(
                'select[aria-label="Date format"]',
            );
            if (!format) {
                throw new Error("Date format control is missing");
            }
            await act(async () => {
                setControlValue(format, "custom");
            });
            const pattern = rendered.container.querySelector<HTMLInputElement>(
                'input[aria-label="Format pattern"]',
            );
            const zone = rendered.container.querySelector<HTMLSelectElement>(
                'select[aria-label="Time zone"]',
            );
            if (!pattern || !zone) {
                throw new Error("Custom preview controls are missing");
            }
            await act(async () => {
                setControlValue(pattern, "yyyy-MM-dd HH:mm XXX");
            });
            const firstPreview = [...rendered.container.querySelectorAll('[role="status"]')]
                .map((node) => node.textContent)
                .find((text) => text.startsWith("Preview:"));
            expect(firstPreview).toBeDefined();
            await act(async () => {
                setControlValue(pattern, "EEEE, d MMMM yyyy");
            });
            const secondPreview = [...rendered.container.querySelectorAll('[role="status"]')]
                .map((node) => node.textContent)
                .find((text) => text.startsWith("Preview:"));
            expect(secondPreview).toBeDefined();
            expect(secondPreview).not.toBe(firstPreview);
            await act(async () => {
                setControlValue(pattern, "yyyy-MM-dd HH:mm XXX");
                setControlValue(zone, "iana");
            });
            const identifier = rendered.container.querySelector<HTMLInputElement>(
                'input[aria-label="IANA time zone identifier"]',
            );
            if (!identifier) {
                throw new Error("IANA identifier is missing");
            }
            await act(async () => {
                setControlValue(identifier, "America/New_York");
            });
            const zonePreview = [...rendered.container.querySelectorAll('[role="status"]')]
                .map((node) => node.textContent)
                .find((text) => text.startsWith("Preview:"));
            expect(zonePreview).toBeDefined();
            expect(zonePreview).not.toBe(firstPreview);
            expect(writes).toHaveLength(0);
        } finally {
            await rendered.unmount();
        }
    });

    it.each([
        ["empty", ""],
        ["whitespace", "   "],
        ["oversize", "y".repeat(257)],
        ["control character", "yyyy-MM-dd\u0001"],
        ["unclosed quote", "yyyy-MM-dd '"] as const,
        ["unsupported token", "yyyy-MM-dd J"],
        ["legacy token", "YYYY-MM-dd"],
    ])("blocks %s custom patterns without a save", async (_name, invalidPattern) => {
        let writes = 0;
        const rendered = await renderOptions(ready, {
            sendMessage: (message) => {
                if (
                    message &&
                    typeof message === "object" &&
                    "type" in message &&
                    message.type === SET_DISPLAY_SETTINGS_MESSAGE
                ) {
                    writes += 1;
                }
                return Promise.resolve(displayReady);
            },
        });
        try {
            const format = rendered.container.querySelector<HTMLSelectElement>(
                'select[aria-label="Date format"]',
            );
            if (!format) {
                throw new Error("Date format control is missing");
            }
            await act(async () => {
                setControlValue(format, "custom");
            });
            const pattern = rendered.container.querySelector<HTMLInputElement>(
                'input[aria-label="Format pattern"]',
            );
            const save =
                rendered.container.querySelector<HTMLButtonElement>('button[type="button"]');
            if (!pattern || !save) {
                throw new Error("Custom format controls are missing");
            }
            await act(async () => {
                setControlValue(pattern, invalidPattern);
            });
            await act(async () => {
                save.click();
            });
            expect(writes).toBe(0);
            expect(pattern.getAttribute("aria-invalid")).toBe("true");
            expect(rendered.container.textContent).toMatch(/pattern|token|quote|character|date/i);
        } finally {
            await rendered.unmount();
        }
    });

    it("renders a localized preview and retains a saved custom pattern", async () => {
        const languagesDescriptor = Object.getOwnPropertyDescriptor(navigator, "languages");
        Object.defineProperty(navigator, "languages", { configurable: true, value: ["de-DE"] });
        const custom: DisplayState = {
            ...displayReady,
            display: { formatMode: "custom", pattern: "yyyy-MM-dd", timeZone: { mode: "utc" } },
        };
        const writes: unknown[] = [];
        const rendered = await renderOptions(
            ready,
            {
                sendMessage: (message) => {
                    if (
                        message &&
                        typeof message === "object" &&
                        "type" in message &&
                        message.type === SET_DISPLAY_SETTINGS_MESSAGE
                    ) {
                        writes.push(message);
                        return Promise.resolve({
                            ok: true,
                            acceptedRevision: 5,
                            state: {
                                ...custom,
                                revision: 5,
                                display: (message as unknown as { display: DisplaySettings })
                                    .display,
                            },
                            refreshFailures: [],
                        });
                    }
                    return Promise.resolve(ready);
                },
            },
            custom,
        );
        try {
            const pattern = rendered.container.querySelector<HTMLInputElement>(
                'input[aria-label="Format pattern"]',
            );
            const save =
                rendered.container.querySelector<HTMLButtonElement>('button[type="button"]');
            if (!pattern || !save) {
                throw new Error("Saved custom controls are missing");
            }
            await act(async () => {
                setControlValue(pattern, "EEEE, d MMMM yyyy");
            });
            expect(
                [...rendered.container.querySelectorAll('[role="status"]')].some((node) =>
                    node.textContent.includes("Dienstag"),
                ),
            ).toBe(true);
            await act(async () => {
                save.click();
            });
            expect(writes).toHaveLength(1);
            expect(writes[0]).toMatchObject({
                display: {
                    formatMode: "custom",
                    pattern: "EEEE, d MMMM yyyy",
                    timeZone: { mode: "utc" },
                },
            });
        } finally {
            if (languagesDescriptor) {
                Object.defineProperty(navigator, "languages", languagesDescriptor);
            } else {
                Reflect.deleteProperty(navigator, "languages");
            }
            await rendered.unmount();
        }
    });

    it("shows a typed invalid-format response next to the custom pattern", async () => {
        const rendered = await renderOptions(ready, {
            sendMessage: (message) =>
                message &&
                typeof message === "object" &&
                "type" in message &&
                message.type === SET_DISPLAY_SETTINGS_MESSAGE
                    ? Promise.resolve({ ok: false, error: "invalid-format", state: displayReady })
                    : Promise.resolve(ready),
        });
        try {
            const format = rendered.container.querySelector<HTMLSelectElement>(
                'select[aria-label="Date format"]',
            );
            const save =
                rendered.container.querySelector<HTMLButtonElement>('button[type="button"]');
            if (!format || !save) {
                throw new Error("Date format controls are missing");
            }
            await act(async () => {
                setControlValue(format, "custom");
            });
            const pattern = rendered.container.querySelector<HTMLInputElement>(
                'input[aria-label="Format pattern"]',
            );
            if (!pattern) {
                throw new Error("Format pattern is missing");
            }
            await act(async () => {
                save.click();
            });
            expect(pattern.getAttribute("aria-invalid")).toBe("true");
            expect(rendered.container.textContent).toContain("date format is invalid");
        } finally {
            await rendered.unmount();
        }
    });
});

describe("Options Debug logs contract", () => {
    it("renders the default-off switch and dispatches one request per transition", async () => {
        const messages: unknown[] = [];
        const rendered = await renderOptions(ready, {
            sendMessage: (message) => {
                messages.push(message);
                if (
                    message &&
                    typeof message === "object" &&
                    "type" in message &&
                    message.type === SET_DEBUG_ENABLED_MESSAGE &&
                    "enabled" in message
                ) {
                    const revision = message.enabled ? 5 : 6;
                    return Promise.resolve({
                        ok: true,
                        acceptedRevision: revision,
                        state: { availability: "ready", revision, enabled: message.enabled },
                    });
                }
                if (
                    message &&
                    typeof message === "object" &&
                    "type" in message &&
                    message.type === GET_DEBUG_STATE_MESSAGE
                ) {
                    return Promise.resolve(debugReady);
                }
                return Promise.resolve(ready);
            },
        });
        try {
            const toggle = rendered.container.querySelector<HTMLInputElement>(
                'input[aria-label="Debug logs"]',
            );
            expect(toggle?.checked).toBe(false);
            if (!toggle) {
                throw new Error("Debug logs switch is missing");
            }
            await act(async () => {
                toggle.click();
            });
            expect(
                messages.filter(
                    (message) =>
                        message &&
                        typeof message === "object" &&
                        "type" in message &&
                        message.type === SET_DEBUG_ENABLED_MESSAGE,
                ),
            ).toHaveLength(1);
            expect(
                rendered.container.querySelector<HTMLInputElement>('input[aria-label="Debug logs"]')
                    ?.checked,
            ).toBe(true);
            await act(async () => {
                toggle.click();
            });
            expect(
                messages.filter(
                    (message) =>
                        message &&
                        typeof message === "object" &&
                        "type" in message &&
                        message.type === SET_DEBUG_ENABLED_MESSAGE,
                ),
            ).toEqual([
                { type: SET_DEBUG_ENABLED_MESSAGE, enabled: true },
                { type: SET_DEBUG_ENABLED_MESSAGE, enabled: false },
            ]);
            expect(
                rendered.container.querySelector<HTMLInputElement>('input[aria-label="Debug logs"]')
                    ?.checked,
            ).toBe(false);
        } finally {
            await rendered.unmount();
        }
    });

    it("shows an actionable typed failure without replaying the mutation", async () => {
        let writes = 0;
        const rendered = await renderOptions(ready, {
            sendMessage: (message) => {
                if (
                    message &&
                    typeof message === "object" &&
                    "type" in message &&
                    message.type === SET_DEBUG_ENABLED_MESSAGE
                ) {
                    writes += 1;
                    return Promise.resolve({ ok: false, error: "save-failed", state: debugReady });
                }
                return Promise.resolve(debugReady);
            },
        });
        try {
            const toggle = rendered.container.querySelector<HTMLInputElement>(
                'input[aria-label="Debug logs"]',
            );
            if (!toggle) {
                throw new Error("Debug logs switch is missing");
            }
            await act(async () => {
                toggle.click();
            });
            expect(writes).toBe(1);
            expect(rendered.container.textContent).toContain(
                "Could not save the Debug logs setting",
            );
            expect(toggle.checked).toBe(false);
        } finally {
            await rendered.unmount();
        }
    });

    it.each(["interrupted", "malformed"] as const)(
        "rereads an authoritative state once after a %s toggle response",
        async (failure) => {
            let writes = 0;
            let reads = 0;
            const rendered = await renderOptions(ready, {
                sendMessage: (message) => {
                    if (
                        message &&
                        typeof message === "object" &&
                        "type" in message &&
                        message.type === SET_DEBUG_ENABLED_MESSAGE
                    ) {
                        writes += 1;
                        return failure === "interrupted"
                            ? Promise.reject(new Error("worker restarted"))
                            : Promise.resolve({ unexpected: true });
                    }
                    if (
                        message &&
                        typeof message === "object" &&
                        "type" in message &&
                        message.type === GET_DEBUG_STATE_MESSAGE
                    ) {
                        reads += 1;
                        return Promise.resolve({
                            availability: "ready",
                            revision: 5,
                            enabled: true,
                        });
                    }
                    return Promise.resolve(ready);
                },
            });
            try {
                const toggle = rendered.container.querySelector<HTMLInputElement>(
                    'input[aria-label="Debug logs"]',
                );
                if (!toggle) {
                    throw new Error("Debug logs switch is missing");
                }
                await act(async () => {
                    toggle.click();
                });
                expect(writes).toBe(1);
                expect(reads).toBe(1);
                expect(
                    rendered.container.querySelector<HTMLInputElement>(
                        'input[aria-label="Debug logs"]',
                    )?.checked,
                ).toBe(true);
                expect(rendered.container.textContent).toContain("response was interrupted");
            } finally {
                await rendered.unmount();
            }
        },
    );

    it("prevents duplicate toggles while settings mutation is pending", async () => {
        let writes = 0;
        let release: ((response: unknown) => void) | undefined;
        const pending = new Promise<unknown>((resolve) => {
            release = resolve;
        });
        const rendered = await renderOptions(ready, {
            sendMessage: (message) => {
                if (
                    message &&
                    typeof message === "object" &&
                    "type" in message &&
                    message.type === SET_DEBUG_ENABLED_MESSAGE
                ) {
                    writes += 1;
                    return pending;
                }
                return Promise.resolve(debugReady);
            },
        });
        try {
            const toggle = rendered.container.querySelector<HTMLInputElement>(
                'input[aria-label="Debug logs"]',
            );
            if (!toggle) {
                throw new Error("Debug logs switch is missing");
            }
            await act(async () => {
                toggle.click();
                toggle.click();
            });
            expect(writes).toBe(1);
            expect(toggle.disabled).toBe(true);
            await act(async () => {
                release?.({
                    ok: true,
                    acceptedRevision: 5,
                    state: { availability: "ready", revision: 5, enabled: true },
                });
                await pending;
            });
            expect(toggle.disabled).toBe(false);
            expect(toggle.checked).toBe(true);
        } finally {
            await rendered.unmount();
        }
    });

    it("downloads logs with one request and one click while enabled", async () => {
        const messages: unknown[] = [];
        const scheduled: Array<() => void> = [];
        const revoked: string[] = [];
        let clicks = 0;
        const runtime: DownloadRuntime = {
            Blob,
            createObjectURL: () => "blob:options",
            revokeObjectURL: (url) => {
                revoked.push(url);
            },
            createAnchor: () => ({
                href: "",
                download: "",
                click: () => {
                    clicks += 1;
                },
                remove: () => undefined,
            }),
            scheduleRevoke: (callback) => {
                scheduled.push(callback);
            },
        };
        const rendered = await renderOptions(
            ready,
            {
                sendMessage: (message) => {
                    messages.push(message);
                    if (
                        message &&
                        typeof message === "object" &&
                        "type" in message &&
                        message.type === GET_DIAGNOSTICS_SNAPSHOT_MESSAGE
                    ) {
                        return Promise.resolve({
                            ok: true,
                            snapshot: {
                                entries: [
                                    {
                                        category: "lifecycle",
                                        timestamp: 1,
                                        hostname: "github.com",
                                        pageCategory: "repository",
                                        incognito: false,
                                    },
                                ],
                                environment: { browserFamily: "chromium" },
                            },
                        });
                    }
                    return Promise.resolve(ready);
                },
            },
            displayReady,
            { ...debugReady, enabled: true },
            runtime,
        );
        try {
            const download = [...rendered.container.querySelectorAll("button")].find(
                (button) => button.textContent === "Download logs",
            );
            if (!download) {
                throw new Error("Download logs action is missing");
            }
            await act(async () => {
                download.click();
            });
            expect(
                messages.filter(
                    (message) =>
                        message &&
                        typeof message === "object" &&
                        "type" in message &&
                        message.type === GET_DIAGNOSTICS_SNAPSHOT_MESSAGE,
                ),
            ).toHaveLength(1);
            expect(clicks).toBe(1);
            expect(revoked).toEqual([]);
            scheduled[0]?.();
            expect(revoked).toEqual(["blob:options"]);
        } finally {
            await rendered.unmount();
        }
    });

    it("clears logs once without changing the enabled Debug logs setting", async () => {
        const messages: unknown[] = [];
        const rendered = await renderOptions(
            ready,
            {
                sendMessage: (message) => {
                    messages.push(message);
                    if (
                        message &&
                        typeof message === "object" &&
                        "type" in message &&
                        message.type === CLEAR_DIAGNOSTICS_MESSAGE
                    ) {
                        return Promise.resolve({ ok: true });
                    }
                    return Promise.resolve(ready);
                },
            },
            displayReady,
            { ...debugReady, enabled: true },
        );
        try {
            const clear = [...rendered.container.querySelectorAll("button")].find(
                (button) => button.textContent === "Clear logs",
            );
            if (!clear) {
                throw new Error("Clear logs action is missing");
            }
            await act(async () => {
                clear.click();
                clear.click();
            });
            expect(
                messages.filter(
                    (message) =>
                        message &&
                        typeof message === "object" &&
                        "type" in message &&
                        message.type === CLEAR_DIAGNOSTICS_MESSAGE,
                ),
            ).toHaveLength(1);
            expect(
                rendered.container.querySelector<HTMLInputElement>('input[aria-label="Debug logs"]')
                    ?.checked,
            ).toBe(true);
            expect(rendered.container.textContent).toContain("Diagnostic logs cleared.");
        } finally {
            await rendered.unmount();
        }
    });

    it("disables archive actions when logs are off and explains an empty journal", async () => {
        const off = await renderOptions(ready, undefined, displayReady, debugReady);
        try {
            const buttons = [...off.container.querySelectorAll("button")].filter(
                (button) =>
                    button.textContent === "Download logs" || button.textContent === "Clear logs",
            );
            expect(buttons).toHaveLength(2);
            expect(buttons.every((button) => button.disabled)).toBe(true);
        } finally {
            await off.unmount();
        }

        const empty = await renderOptions(
            ready,
            {
                sendMessage: (message) =>
                    message &&
                    typeof message === "object" &&
                    "type" in message &&
                    message.type === GET_DIAGNOSTICS_SNAPSHOT_MESSAGE
                        ? Promise.resolve({ ok: false, error: "empty" })
                        : Promise.resolve(ready),
            },
            displayReady,
            { ...debugReady, enabled: true },
        );
        try {
            const download = [...empty.container.querySelectorAll("button")].find(
                (button) => button.textContent === "Download logs",
            );
            if (!download) {
                throw new Error("Download logs action is missing");
            }
            await act(async () => {
                download.click();
            });
            expect(empty.container.textContent).toContain("no diagnostic logs to download");
        } finally {
            await empty.unmount();
        }
    });

    it.each(["storage-failed", "invalid-journal", "unavailable", "malformed"] as const)(
        "shows an actionable snapshot error without downloading for %s",
        async (failure) => {
            let requests = 0;
            let clicks = 0;
            const runtime: DownloadRuntime = {
                Blob,
                createObjectURL: () => "blob:never",
                revokeObjectURL: () => undefined,
                createAnchor: () => ({
                    href: "",
                    download: "",
                    click: () => {
                        clicks += 1;
                    },
                }),
                scheduleRevoke: () => {
                    /* no callback */
                },
            };
            const rendered = await renderOptions(
                ready,
                {
                    sendMessage: (message) => {
                        if (
                            message &&
                            typeof message === "object" &&
                            "type" in message &&
                            message.type === GET_DIAGNOSTICS_SNAPSHOT_MESSAGE
                        ) {
                            requests += 1;
                            if (failure === "malformed") {
                                return Promise.resolve({ unexpected: true });
                            }
                            return Promise.resolve({ ok: false, error: failure });
                        }
                        return Promise.resolve(ready);
                    },
                },
                displayReady,
                { ...debugReady, enabled: true },
                runtime,
            );
            try {
                const download = [...rendered.container.querySelectorAll("button")].find(
                    (button) => button.textContent === "Download logs",
                );
                if (!download) {
                    throw new Error("Download logs action is missing");
                }
                await act(async () => {
                    download.click();
                });
                expect(requests).toBe(1);
                expect(clicks).toBe(0);
                expect(rendered.container.textContent).toMatch(
                    /unavailable|invalid|could not be read|try again/i,
                );
            } finally {
                await rendered.unmount();
            }
        },
    );

    it("reports downloader failure and revokes the object URL immediately", async () => {
        const revoked: string[] = [];
        let removed = 0;
        const runtime: DownloadRuntime = {
            Blob,
            createObjectURL: () => "blob:download-failure",
            revokeObjectURL: (url) => {
                revoked.push(url);
            },
            createAnchor: () => ({
                href: "",
                download: "",
                click: () => {
                    throw new Error("blocked");
                },
                remove: () => {
                    removed += 1;
                },
            }),
            scheduleRevoke: () => {
                throw new Error("must not schedule after click failure");
            },
        };
        const rendered = await renderOptions(
            ready,
            {
                sendMessage: (message) =>
                    message &&
                    typeof message === "object" &&
                    "type" in message &&
                    message.type === GET_DIAGNOSTICS_SNAPSHOT_MESSAGE
                        ? Promise.resolve({
                            ok: true,
                            snapshot: {
                                entries: [
                                    {
                                        category: "lifecycle",
                                        timestamp: 1,
                                        hostname: "github.com",
                                        pageCategory: "repository",
                                        incognito: false,
                                    },
                                ],
                                environment: { browserFamily: "chromium" },
                            },
                        })
                        : Promise.resolve(ready),
            },
            displayReady,
            { ...debugReady, enabled: true },
            runtime,
        );
        try {
            const download = [...rendered.container.querySelectorAll("button")].find(
                (button) => button.textContent === "Download logs",
            );
            if (!download) {
                throw new Error("Download logs action is missing");
            }
            await act(async () => {
                download.click();
            });
            expect(revoked).toEqual(["blob:download-failure"]);
            expect(removed).toBe(1);
            expect(rendered.container.textContent).toContain("could not be downloaded");
        } finally {
            await rendered.unmount();
        }
    });

    it("suppresses a duplicate download while the snapshot request is pending", async () => {
        let requests = 0;
        let release: ((value: unknown) => void) | undefined;
        const pending = new Promise<unknown>((resolve) => {
            release = resolve;
        });
        const runtime: DownloadRuntime = {
            Blob,
            createObjectURL: () => "blob:pending",
            revokeObjectURL: () => undefined,
            createAnchor: () => ({ href: "", download: "", click: () => undefined }),
            scheduleRevoke: () => {
                /* no callback */
            },
        };
        const rendered = await renderOptions(
            ready,
            {
                sendMessage: (message) => {
                    if (
                        message &&
                        typeof message === "object" &&
                        "type" in message &&
                        message.type === GET_DIAGNOSTICS_SNAPSHOT_MESSAGE
                    ) {
                        requests += 1;
                        return pending;
                    }
                    return Promise.resolve(ready);
                },
            },
            displayReady,
            { ...debugReady, enabled: true },
            runtime,
        );
        try {
            const download = [...rendered.container.querySelectorAll("button")].find(
                (button) => button.textContent === "Download logs",
            );
            if (!download) {
                throw new Error("Download logs action is missing");
            }
            await act(async () => {
                download.click();
                download.click();
            });
            expect(requests).toBe(1);
            expect(download.disabled).toBe(true);
            release?.({ ok: false, error: "empty" });
            await act(async () => {
                await pending;
            });
            expect(download.disabled).toBe(false);
        } finally {
            await rendered.unmount();
        }
    });

    it.each(["storage-failed", "unavailable", "malformed", "transport"] as const)(
        "dispatches Clear logs once and keeps Debug logs enabled after %s",
        async (failure) => {
            let requests = 0;
            const rendered = await renderOptions(
                ready,
                {
                    sendMessage: (message) => {
                        if (
                            message &&
                            typeof message === "object" &&
                            "type" in message &&
                            message.type === CLEAR_DIAGNOSTICS_MESSAGE
                        ) {
                            requests += 1;
                            if (failure === "transport") {
                                return Promise.reject(new Error("worker unavailable"));
                            }
                            if (failure === "malformed") {
                                return Promise.resolve({ unexpected: true });
                            }
                            return Promise.resolve({ ok: false, error: failure });
                        }
                        return Promise.resolve(ready);
                    },
                },
                displayReady,
                { ...debugReady, enabled: true },
            );
            try {
                const clear = [...rendered.container.querySelectorAll("button")].find(
                    (button) => button.textContent === "Clear logs",
                );
                if (!clear) {
                    throw new Error("Clear logs action is missing");
                }
                await act(async () => {
                    clear.click();
                    clear.click();
                });
                expect(requests).toBe(1);
                expect(
                    rendered.container.querySelector<HTMLInputElement>(
                        'input[aria-label="Debug logs"]',
                    )?.checked,
                ).toBe(true);
                expect(rendered.container.textContent).toMatch(
                    /unavailable|could not be read|try again/i,
                );
            } finally {
                await rendered.unmount();
            }
        },
    );
});

describe("Options site reporting", () => {
    it.each([false, true])(
        "opens a generic GitHub issue when debug logs are %s without reading diagnostics",
        async (enabled) => {
            let calls = 0;
            const messages: unknown[] = [];
            const reporter: SiteReportReporter = {
                openPopupReport: async () => ({ ok: false, error: "invalid-context" }),
                openOptionsReport: async () => {
                    calls += 1;
                    return {
                        ok: true,
                        url: "https://github.com/maximtop/no-more-ago/issues/new"
                            + "?template=site-report.yml",
                    };
                },
            };
            const rendered = await renderOptions(
                ready,
                {
                    sendMessage: (message) => {
                        messages.push(message);
                        return Promise.resolve(ready);
                    },
                },
                displayReady,
                { ...debugReady, enabled },
                undefined,
                reporter,
            );
            try {
                const button = [...rendered.container.querySelectorAll("button")].find(
                    (candidate) => candidate.textContent === "Open GitHub issue",
                );
                if (!button) {
                    throw new Error("Site report action is missing");
                }
                expect(button.disabled).toBe(false);
                expect(calls).toBe(0);
                expect(messages).toHaveLength(0);
                await act(async () => {
                    button.click();
                });
                expect(calls).toBe(1);
                expect(messages).toHaveLength(0);
            } finally {
                await rendered.unmount();
            }
        },
    );

    it("suppresses duplicate reports and reports failure without retry", async () => {
        let calls = 0;
        let release:
            | ((value: { readonly ok: false; readonly error: "open-failed" }) => void)
            | undefined;
        const pending = new Promise<{ readonly ok: false; readonly error: "open-failed" }>(
            (resolve) => {
                release = resolve;
            },
        );
        const reporter: SiteReportReporter = {
            openPopupReport: async () => ({ ok: false, error: "invalid-context" }),
            openOptionsReport: async () => {
                calls += 1;
                return pending;
            },
        };
        const rendered = await renderOptions(
            ready,
            undefined,
            displayReady,
            debugReady,
            undefined,
            reporter,
        );
        try {
            const button = [...rendered.container.querySelectorAll("button")].find(
                (candidate) => candidate.textContent === "Open GitHub issue",
            );
            if (!button) {
                throw new Error("Site report action is missing");
            }
            await act(async () => {
                button.click();
                button.click();
            });
            expect(calls).toBe(1);
            expect(button.disabled).toBe(true);
            release?.({ ok: false, error: "open-failed" });
            await act(async () => {
                await pending;
            });
            expect(calls).toBe(1);
            expect(button.disabled).toBe(false);
            expect(rendered.container.textContent).toContain(
                "Could not open the GitHub report. Try again.",
            );
        } finally {
            await rendered.unmount();
        }
    });

    it("turns an unexpected report rejection into an actionable notice without retry", async () => {
        let calls = 0;
        const reporter: SiteReportReporter = {
            openPopupReport: async () => ({ ok: false, error: "invalid-context" }),
            openOptionsReport: async () => {
                calls += 1;
                throw new Error("browser bridge failed");
            },
        };
        const rendered = await renderOptions(
            ready,
            undefined,
            displayReady,
            debugReady,
            undefined,
            reporter,
        );
        try {
            const button = [...rendered.container.querySelectorAll("button")].find(
                (candidate) => candidate.textContent === "Open GitHub issue",
            );
            if (!button) {
                throw new Error("Site report action is missing");
            }
            await act(async () => {
                button.click();
            });
            expect(calls).toBe(1);
            expect(rendered.container.textContent).toContain(
                "Could not open the GitHub report. Try again.",
            );
        } finally {
            await rendered.unmount();
        }
    });

    it("uses the lazy default browser reporter only after the explicit action", async () => {
        let queries = 0;
        let manifestReads = 0;
        let userAgentReads = 0;
        const created: string[] = [];
        const fakeChrome = {
            tabs: {
                query: async () => {
                    queries += 1;
                    return [];
                },
                create: async (properties: { readonly url: string }) => {
                    created.push(properties.url);
                    return undefined;
                },
            },
            runtime: {
                getManifest: () => {
                    manifestReads += 1;
                    return { version: "1.2.3" };
                },
            },
        };
        const fakeNavigator = {
            get userAgent() {
                userAgentReads += 1;
                return "Mozilla/5.0 Chrome/140.0.0.0";
            },
            languages: ["en-US"],
            language: "en-US",
        };
        const globalObject = globalThis as typeof globalThis & { chrome?: unknown };
        const previous = Object.getOwnPropertyDescriptor(globalObject, "chrome");
        const previousNavigator = Object.getOwnPropertyDescriptor(globalObject, "navigator");
        Object.defineProperty(globalObject, "chrome", { configurable: true, value: fakeChrome });
        Object.defineProperty(globalObject, "navigator", {
            configurable: true,
            value: fakeNavigator,
        });
        const rendered = await renderOptions(ready);
        try {
            expect(queries).toBe(0);
            expect(manifestReads).toBe(0);
            expect(userAgentReads).toBe(0);
            expect(created).toHaveLength(0);
            const button = [...rendered.container.querySelectorAll("button")].find(
                (candidate) => candidate.textContent === "Open GitHub issue",
            );
            if (!button) {
                throw new Error("Site report action is missing");
            }
            await act(async () => {
                button.click();
            });
            expect(queries).toBe(0);
            expect(manifestReads).toBe(1);
            expect(userAgentReads).toBe(1);
            expect(created).toHaveLength(1);
            const createdUrl = created[0];
            if (!createdUrl) {
                throw new Error("Site report URL is missing");
            }
            const url = new URL(createdUrl);
            expect(url.searchParams.get("template")).toBe("site-report.yml");
            expect(url.searchParams.get("extension_version")).toBe("1.2.3");
            expect(url.searchParams.has("reason")).toBe(false);
            expect(url.searchParams.has("hostname")).toBe(false);
            expect(url.searchParams.has("current_url")).toBe(false);
        } finally {
            await rendered.unmount();
            if (previous) {
                Object.defineProperty(globalObject, "chrome", previous);
            } else {
                Reflect.deleteProperty(globalObject, "chrome");
            }
            if (previousNavigator) {
                Object.defineProperty(globalObject, "navigator", previousNavigator);
            } else {
                Reflect.deleteProperty(globalObject, "navigator");
            }
        }
    });
});
