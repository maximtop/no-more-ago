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
    SET_APPEARANCE_MESSAGE,
    SET_DEBUG_ENABLED_MESSAGE,
    SET_DISPLAY_SETTINGS_MESSAGE,
    SET_GLOBAL_ENABLED_MESSAGE,
    SET_SITE_ENABLED_MESSAGE,
    SET_SITE_SCOPE_MODE_MESSAGE,
} from "../../../src/shared/messaging/contracts";
import type {
    DebugState,
    DisplayState,
    SitesState,
} from "../../../src/shared/messaging/view-state-schemas";
import { APPEARANCE, type DisplaySettings } from "../../../src/shared/settings/snapshot";
import { SITE_SCOPE_MODE } from "../../../src/shared/settings/site-scope";
import {
    SETTINGS_STATE_FAILURE,
    SITE_SETTINGS_SURFACE,
} from "../../../src/shared/messaging/view-state-values";
import type {
    SubscribeSettingsChanged,
} from "../../../src/shared/messaging/settings-notifications";
import { OptionsApp } from "../../../src/options/app";
import { SitesClient, type SitesTransport } from "../../../src/options/client";
import type { DownloadRuntime } from "../../../src/shared/diagnostics/archive";
import type { SiteReportReporter } from "../../../src/shared/reporting/site-report";
import { findButton, installMatchMedia, messageType } from "../../support/dom";

const ready: SitesState = {
    availability: "ready",
    revision: 4,
    globalEnabled: true,
    scopeMode: SITE_SCOPE_MODE.ALL_EXCEPT_EXCLUDED,
    excludedSites: ["github.com"],
    allowedSites: ["allowed.test"],
};

const displayReady: DisplayState = {
    availability: "ready",
    revision: 4,
    display: { formatMode: "system", timeZone: { mode: "system" } },
    appearance: APPEARANCE.SYSTEM,
    debugEnabled: false,
};
const debugReady: DebugState = { availability: "ready", revision: 4, enabled: false };

const unavailableSites: SitesState = {
    availability: "unavailable",
    revision: null,
    globalEnabled: null,
    scopeMode: null,
    excludedSites: [],
    allowedSites: [],
    failure: SETTINGS_STATE_FAILURE.SETTINGS_LOAD,
};
const unavailableDisplay: DisplayState = {
    availability: "unavailable",
    revision: null,
    display: null,
    appearance: APPEARANCE.SYSTEM,
    failure: SETTINGS_STATE_FAILURE.SETTINGS_LOAD,
};

beforeAll(() => {
    (
        globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    installMatchMedia();
});

/**
 * Injectable dependencies and preloaded projections for one options render.
 */
interface RenderOptions {
    /**
     * Background message transport used by the client.
     */
    readonly transport?: SitesTransport;

    /**
     * Initial display settings state.
     */
    readonly initialDisplayState?: DisplayState;

    /**
     * Initial diagnostic logging state.
     */
    readonly initialDebugState?: DebugState;

    /**
     * Diagnostics archive download runtime.
     */
    readonly archiveRuntime?: DownloadRuntime;

    /**
     * Site-report service.
     */
    readonly reporter?: SiteReportReporter;

    /**
     * Settings change subscriber.
     */
    readonly subscribe?: SubscribeSettingsChanged;
}

/**
 * Renders the options application with injectable background and browser dependencies.
 *
 * @param state - Initial sites settings state.
 * @param options - Transport, preloaded projections, and browser dependencies.
 * @returns - Mounted container and asynchronous cleanup action.
 */
async function renderOptions(
    state: SitesState,
    options: RenderOptions = {},
): Promise<{ container: HTMLDivElement; unmount: () => Promise<void> }> {
    const {
        transport = { sendMessage: () => Promise.resolve(state) },
        initialDisplayState = displayReady,
        initialDebugState = debugReady,
        archiveRuntime,
        reporter,
        subscribe,
    } = options;
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const archiveProps = archiveRuntime ? { archiveRuntime } : {};
    const reporterProps = reporter ? { reporter } : {};
    const subscribeProps = subscribe ? { subscribe } : {};
    await act(async () => {
        root.render(
            <OptionsApp
                initialState={state}
                initialDisplayState={initialDisplayState}
                initialDebugState={initialDebugState}
                {...archiveProps}
                {...reporterProps}
                {...subscribeProps}
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
 * Selects one settings section through its navigation tab.
 *
 * @param container - Mounted options container.
 * @param label - Visible tab label.
 */
async function openSection(container: HTMLElement, label: string): Promise<void> {
    const tab = [...container.querySelectorAll<HTMLElement>('[role="tab"]')]
        .find((candidate) => candidate.textContent === label);
    if (!tab) {
        throw new Error(`${label} section is missing`);
    }
    await act(async () => {
        tab.click();
    });
}

const PREVIEW_SELECTOR = '[role="status"][aria-label="Preview"]';

/**
 * Reads the rendered preview text.
 *
 * @param container - Mounted options container.
 * @returns - Preview text, or undefined when the preview is not rendered.
 */
function previewText(container: HTMLElement): string | undefined {
    return container.querySelector(PREVIEW_SELECTOR)?.textContent;
}

/**
 * Activates the reset action and confirms it.
 *
 * @param container - Mounted options container.
 */
async function confirmReset(container: HTMLElement): Promise<void> {
    const trigger = findButton(container, "Reset all settings");
    if (!trigger) {
        throw new Error("Reset action is missing");
    }
    await act(async () => {
        trigger.click();
    });
    const confirm = findButton(container, "Reset everything");
    if (!confirm) {
        throw new Error("Reset confirmation is missing");
    }
    await act(async () => {
        confirm.click();
    });
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
    it("shows only the active list with one action per row", async () => {
        const rendered = await renderOptions(ready);
        try {
            const text = rendered.container.textContent;
            expect(text).toContain("Excluded sites");
            expect(text).toContain("github.com");
            expect(text).not.toContain("allowed.test");
            expect([...rendered.container.querySelectorAll("button")]
                .filter((button) => button.textContent === "Remove")).toHaveLength(1);
            expect(rendered.container.querySelectorAll(".site-row input[type=checkbox]"))
                .toHaveLength(0);
        } finally {
            await rendered.unmount();
        }
    });

    it("switches the run mode and shows the other list unchanged", async () => {
        const sent: unknown[] = [];
        const selected: SitesState = {
            ...ready,
            revision: 5,
            scopeMode: SITE_SCOPE_MODE.SELECTED_ONLY,
        };
        const rendered = await renderOptions(ready, {
            transport: {
                sendMessage: (message) => {
                    sent.push(message);
                    return Promise.resolve({
                        ok: true,
                        acceptedRevision: 5,
                        state: selected,
                    });
                },
            },
        });
        try {
            const option = rendered.container.querySelector<HTMLInputElement>(
                'input[type=radio][value="selected-only"]',
            );
            if (!option) {
                throw new Error("Run mode option is missing");
            }
            await act(async () => {
                option.click();
            });
            expect(sent).toEqual([{
                type: SET_SITE_SCOPE_MODE_MESSAGE,
                mode: SITE_SCOPE_MODE.SELECTED_ONLY,
            }]);
            const text = rendered.container.textContent;
            expect(text).toContain("Allowed sites");
            expect(text).toContain("allowed.test");
            expect(text).not.toContain("github.com");
        } finally {
            await rendered.unmount();
        }
    });

    it("warns when selected-only is active with an empty allowlist", async () => {
        const rendered = await renderOptions({
            ...ready,
            scopeMode: SITE_SCOPE_MODE.SELECTED_ONLY,
            allowedSites: [],
        });
        try {
            expect(rendered.container.textContent).toContain(
                "No sites are allowed yet. The extension will stay off on every site until one "
                + "is added.",
            );
        } finally {
            await rendered.unmount();
        }
    });

    it("adds a normalized hostname to the active list", async () => {
        const sent: unknown[] = [];
        const rendered = await renderOptions(ready, {
            transport: {
                sendMessage: (message) => {
                    sent.push(message);
                    return Promise.resolve({
                        ok: true,
                        acceptedRevision: 5,
                        surface: SITE_SETTINGS_SURFACE.SITES,
                        state: {
                            ...ready,
                            revision: 5,
                            excludedSites: ["github.com", "example.test"],
                        },
                    });
                },
            },
        });
        try {
            const field = rendered.container.querySelector<HTMLInputElement>(
                'input[aria-label="Exclude hostname"]',
            );
            const submit = findButton(rendered.container, "Exclude site");
            if (!field || !submit) {
                throw new Error("Add-hostname form is missing");
            }
            await act(async () => {
                setControlValue(field, "  Example.TEST. ");
                submit.click();
            });
            expect(sent).toEqual([{
                type: SET_SITE_ENABLED_MESSAGE,
                hostname: "example.test",
                enabled: false,
                surface: SITE_SETTINGS_SURFACE.SITES,
            }]);
            expect(rendered.container.textContent).toContain("example.test");
            expect(field.value).toBe("");
        } finally {
            await rendered.unmount();
        }
    });

    it("keeps the typed hostname and shows no confirmation when the add fails", async () => {
        const rendered = await renderOptions(ready, {
            transport: {
                sendMessage: () => Promise.resolve({
                    ok: false,
                    error: "save-failed",
                    surface: SITE_SETTINGS_SURFACE.SITES,
                    state: ready,
                }),
            },
        });
        try {
            const field = rendered.container.querySelector<HTMLInputElement>(
                'input[aria-label="Exclude hostname"]',
            );
            const submit = findButton(rendered.container, "Exclude site");
            if (!field || !submit) {
                throw new Error("Add-hostname form is missing");
            }
            await act(async () => {
                setControlValue(field, "example.test");
                submit.click();
            });
            expect(field.value).toBe("example.test");
            expect(rendered.container.textContent).not.toContain("was added to");
            expect(rendered.container.textContent).toContain("Could not save this change.");
        } finally {
            await rendered.unmount();
        }
    });

    it("reports a full list without clearing the field", async () => {
        const rendered = await renderOptions(ready, {
            transport: {
                sendMessage: () => Promise.resolve({
                    ok: false,
                    error: "list-full",
                    surface: SITE_SETTINGS_SURFACE.SITES,
                    state: ready,
                }),
            },
        });
        try {
            const field = rendered.container.querySelector<HTMLInputElement>(
                'input[aria-label="Exclude hostname"]',
            );
            const submit = findButton(rendered.container, "Exclude site");
            if (!field || !submit) {
                throw new Error("Add-hostname form is missing");
            }
            await act(async () => {
                setControlValue(field, "example.test");
                submit.click();
            });
            expect(field.value).toBe("example.test");
            expect(rendered.container.textContent).toContain("This list is full.");
        } finally {
            await rendered.unmount();
        }
    });

    it("refuses an invalid hostname without sending a message", async () => {
        const sent: unknown[] = [];
        const rendered = await renderOptions(ready, {
            transport: {
                sendMessage: (message) => {
                    sent.push(message);
                    return Promise.resolve(ready);
                },
            },
        });
        try {
            const field = rendered.container.querySelector<HTMLInputElement>(
                'input[aria-label="Exclude hostname"]',
            );
            const submit = findButton(rendered.container, "Exclude site");
            if (!field || !submit) {
                throw new Error("Add-hostname form is missing");
            }
            await act(async () => {
                setControlValue(field, "https://example.com");
                submit.click();
            });
            expect(sent).toEqual([]);
            expect(rendered.container.textContent)
                .toContain("Use an exact hostname without a scheme, port, or path.");
        } finally {
            await rendered.unmount();
        }
    });

    it("rejects a duplicate of an entry already in the active list", async () => {
        const sent: unknown[] = [];
        const rendered = await renderOptions(ready, {
            transport: {
                sendMessage: (message) => {
                    sent.push(message);
                    return Promise.resolve(ready);
                },
            },
        });
        try {
            const field = rendered.container.querySelector<HTMLInputElement>(
                'input[aria-label="Exclude hostname"]',
            );
            const submit = findButton(rendered.container, "Exclude site");
            if (!field || !submit) {
                throw new Error("Add-hostname form is missing");
            }
            await act(async () => {
                setControlValue(field, "GitHub.com");
                submit.click();
            });
            expect(sent).toEqual([]);
            expect(rendered.container.textContent)
                .toContain("This hostname is already in the list.");
        } finally {
            await rendered.unmount();
        }
    });

    it("keeps the run mode, form, and row actions usable while processing is off", async () => {
        const rendered = await renderOptions({ ...ready, globalEnabled: false });
        try {
            const radio = rendered.container.querySelector<HTMLInputElement>(
                'input[type=radio][value="selected-only"]',
            );
            const field = rendered.container.querySelector<HTMLInputElement>(
                'input[aria-label="Exclude hostname"]',
            );
            const allow = findButton(rendered.container, "Remove");
            expect(radio?.disabled).toBe(false);
            expect(field?.disabled).toBe(false);
            expect(allow?.disabled).toBe(false);
            expect(rendered.container.textContent).toContain(
                "Processing is paused. The run mode and both site lists are kept.",
            );
        } finally {
            await rendered.unmount();
        }
    });

    it("removes a row through its single action", async () => {
        let write: unknown;
        const rendered = await renderOptions(ready, {
            transport: {
                sendMessage: (message) => {
                    if (messageType(message) === SET_SITE_ENABLED_MESSAGE) {
                        write = message;
                        return Promise.resolve({
                            ok: true,
                            acceptedRevision: 5,
                            surface: SITE_SETTINGS_SURFACE.SITES,
                            state: { ...ready, revision: 5, excludedSites: [] },
                        });
                    }
                    return Promise.resolve(ready);
                },
            },
        });
        try {
            const allow = findButton(rendered.container, "Remove");
            if (!allow) {
                throw new Error("Row action is missing");
            }
            await act(async () => {
                allow.click();
            });
            expect(write).toEqual({
                type: SET_SITE_ENABLED_MESSAGE,
                hostname: "github.com",
                enabled: true,
                surface: SITE_SETTINGS_SURFACE.SITES,
            });
            expect(rendered.container.textContent).not.toContain("github.com");
            expect(rendered.container.textContent).toContain("No sites are excluded.");
        } finally {
            await rendered.unmount();
        }
    });

    it("changes global activation and rereads its own projection", async () => {
        const sent: string[] = [];
        let globalEnabled = true;
        const rendered = await renderOptions(ready, {
            transport: {
                sendMessage: (message) => {
                    const type = messageType(message);
                    if (type) {
                        sent.push(type);
                    }
                    if (type === SET_GLOBAL_ENABLED_MESSAGE) {
                        globalEnabled = false;
                        return Promise.resolve({
                            ok: true,
                            acceptedRevision: 5,
                            state: {
                                availability: "ready",
                                revision: 5,
                                globalEnabled: false,
                                hostname: null,
                                siteEnabled: null,
                                scopeMode: SITE_SCOPE_MODE.ALL_EXCEPT_EXCLUDED,
                                appearance: APPEARANCE.SYSTEM,
                                status: "inaccessible",
                            },
                        });
                    }
                    return Promise.resolve({ ...ready, revision: 5, globalEnabled });
                },
            },
        });
        try {
            const toggle = rendered.container.querySelector<HTMLInputElement>(
                'input[aria-label="Extension enabled"]',
            );
            if (!toggle) {
                throw new Error("Global switch is missing");
            }
            await act(async () => {
                toggle.click();
            });
            expect(sent).toEqual([SET_GLOBAL_ENABLED_MESSAGE, GET_SITES_STATE_MESSAGE]);
            expect(rendered.container.textContent).toContain("Processing is paused.");
            expect(toggle.checked).toBe(false);
        } finally {
            await rendered.unmount();
        }
    });

    it("shows typed invalid-hostname without an ambiguous reread", async () => {
        let rereads = 0;
        const rendered = await renderOptions(ready, {
            transport: {
                sendMessage: (message) => {
                    if (messageType(message) === SET_SITE_ENABLED_MESSAGE) {
                        return Promise.resolve({
                            ok: false,
                            error: "invalid-hostname",
                            surface: SITE_SETTINGS_SURFACE.SITES,
                            state: ready,
                        });
                    }
                    rereads += 1;
                    return Promise.resolve(ready);
                },
            },
        });
        try {
            const allow = findButton(rendered.container, "Remove");
            if (!allow) {
                throw new Error("Row action is missing");
            }
            await act(async () => {
                allow.click();
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
            transport: {
                sendMessage: (message) => {
                    if (messageType(message) === SET_SITE_ENABLED_MESSAGE) {
                        return Promise.reject(new Error("response lost"));
                    }
                    if (messageType(message) === GET_SITES_STATE_MESSAGE) {
                        getCalls += 1;
                        return Promise.resolve(committed);
                    }
                    return Promise.reject(new Error("unexpected"));
                },
            },
        });
        try {
            const allow = findButton(rendered.container, "Remove");
            if (!allow) {
                throw new Error("Row action is missing");
            }
            await act(async () => {
                allow.click();
            });
            expect(getCalls).toBe(1);
            expect(rendered.container.textContent).toContain("response was interrupted");
            expect(rendered.container.textContent).toContain("Processing is paused.");
        } finally {
            await rendered.unmount();
        }
    });

    it("preserves the authoritative row after a typed save failure", async () => {
        let rereads = 0;
        const rendered = await renderOptions(ready, {
            transport: {
                sendMessage: (message) => {
                    if (messageType(message) === SET_SITE_ENABLED_MESSAGE) {
                        return Promise.resolve({
                            ok: false,
                            error: "save-failed",
                            surface: SITE_SETTINGS_SURFACE.SITES,
                            state: ready,
                        });
                    }
                    rereads += 1;
                    return Promise.resolve(ready);
                },
            },
        });
        try {
            const allow = findButton(rendered.container, "Remove");
            if (!allow) {
                throw new Error("Row action is missing");
            }
            await act(async () => {
                allow.click();
            });
            expect(rendered.container.textContent).toContain("github.com");
            expect(rendered.container.textContent).toContain(
                "Could not save this change. Try again.",
            );
            expect(rereads).toBe(0);
        } finally {
            await rendered.unmount();
        }
    });

    it("replaces the controls and reports unknown state when command and reread fail", async () => {
        const rendered = await renderOptions(ready, {
            transport: {
                sendMessage: (message) => {
                    const type = messageType(message);
                    if (type === SET_SITE_ENABLED_MESSAGE || type === GET_SITES_STATE_MESSAGE) {
                        return Promise.reject(new Error("transport lost"));
                    }
                    return Promise.resolve(ready);
                },
            },
        });
        try {
            const allow = findButton(rendered.container, "Remove");
            if (!allow) {
                throw new Error("Row action is missing");
            }
            await act(async () => {
                allow.click();
            });
            expect(rendered.container.querySelectorAll('[role="tab"]')).toHaveLength(0);
            expect(rendered.container.textContent).not.toContain("github.com");
            expect(rendered.container.textContent).toContain("Settings are unavailable");
        } finally {
            await rendered.unmount();
        }
    });

    it("ignores an actual stale lower-revision Sites response", async () => {
        const stale: SitesState = { ...ready, revision: 3, excludedSites: [] };
        const rendered = await renderOptions(ready, {
            transport: {
                sendMessage: (message) =>
                    messageType(message) === SET_SITE_ENABLED_MESSAGE
                        ? Promise.resolve({
                            ok: true,
                            acceptedRevision: 3,
                            surface: SITE_SETTINGS_SURFACE.SITES,
                            state: stale,
                        })
                        : Promise.resolve(ready),
            },
        });
        try {
            const allow = findButton(rendered.container, "Remove");
            if (!allow) {
                throw new Error("Row action is missing");
            }
            await act(async () => {
                allow.click();
            });
            expect(rendered.container.textContent).toContain("github.com");
            expect(rendered.container.textContent).not.toContain("Could not save");
        } finally {
            await rendered.unmount();
        }
    });
});

describe("Options reset contract", () => {
    it("shows one reset action for ready and unavailable Sites projections", async () => {
        const rendered = await renderOptions(unavailableSites, {
            transport: { sendMessage: () => Promise.resolve(unavailableSites) },
            initialDisplayState: unavailableDisplay,
        });
        try {
            expect(
                [...rendered.container.querySelectorAll("button")].filter((button) =>
                    button.textContent.includes("Reset all settings"),
                ),
            ).toHaveLength(1);
            const readyRendered = await renderOptions(ready);
            try {
                await openSection(readyRendered.container, "Reset");
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
            appearance: APPEARANCE.DARK,
        };
        const debugOn: DebugState = { ...debugReady, enabled: true };
        const messages: string[] = [];
        const resetState: SitesState = {
            availability: "ready",
            revision: 0,
            globalEnabled: true,
            scopeMode: SITE_SCOPE_MODE.ALL_EXCEPT_EXCLUDED,
            excludedSites: [],
            allowedSites: [],
        };
        const resetDisplay: DisplayState = { ...displayReady, revision: 0 };
        const resetDebug: DebugState = { availability: "ready", revision: 0, enabled: false };
        const rendered = await renderOptions(ready, {
            transport: {
                sendMessage: (message) => {
                    const type = messageType(message);
                    if (type) {
                        messages.push(type);
                    }
                    if (type === RESET_ALL_SETTINGS_MESSAGE) {
                        return Promise.resolve({
                            ok: true,
                            acceptedRevision: 0,
                            state: resetState,
                        });
                    }
                    if (type === GET_DISPLAY_STATE_MESSAGE) {
                        return Promise.resolve(resetDisplay);
                    }
                    if (type === GET_DEBUG_STATE_MESSAGE) {
                        return Promise.resolve(resetDebug);
                    }
                    return Promise.resolve(ready);
                },
            },
            initialDisplayState: custom,
            initialDebugState: debugOn,
        });
        try {
            await openSection(rendered.container, "Reset");
            await confirmReset(rendered.container);
            expect(messages.filter((type) => type === RESET_ALL_SETTINGS_MESSAGE))
                .toHaveLength(1);
            expect(messages.filter((type) => type === GET_DISPLAY_STATE_MESSAGE))
                .toHaveLength(1);
            expect(messages.filter((type) => type === GET_DEBUG_STATE_MESSAGE))
                .toHaveLength(1);

            await openSection(rendered.container, "Sites");
            expect(rendered.container.textContent).toContain("No sites are excluded.");
            expect(rendered.container.textContent).not.toContain("github.com");

            await openSection(rendered.container, "Display");
            expect(rendered.container.querySelector<HTMLSelectElement>(
                'select[aria-label="Date format"]',
            )?.value).toBe("system");
            expect(rendered.container.querySelector<HTMLSelectElement>(
                'select[aria-label="Time zone"]',
            )?.value).toBe("system");
            expect(rendered.container.querySelector<HTMLSelectElement>(
                'select[aria-label="Appearance"]',
            )?.value).toBe(APPEARANCE.SYSTEM);
            expect(rendered.container.querySelector('input[aria-label="Format pattern"]'))
                .toBeNull();

            await openSection(rendered.container, "Diagnostics");
            expect(rendered.container.querySelector<HTMLInputElement>(
                'input[aria-label="Debug logs"]',
            )?.checked).toBe(false);
            expect(findButton(rendered.container, "Download logs")?.disabled).toBe(true);
            expect(findButton(rendered.container, "Clear logs")?.disabled).toBe(true);
        } finally {
            await rendered.unmount();
        }
    });

    it("asks for confirmation and keeps settings when the reset is cancelled", async () => {
        let resetCalls = 0;
        const rendered = await renderOptions(ready, {
            transport: {
                sendMessage: (message) => {
                    if (messageType(message) === RESET_ALL_SETTINGS_MESSAGE) {
                        resetCalls += 1;
                    }
                    return Promise.resolve(ready);
                },
            },
        });
        try {
            await openSection(rendered.container, "Reset");
            const trigger = findButton(rendered.container, "Reset all settings");
            if (!trigger) {
                throw new Error("Reset action is missing");
            }
            await act(async () => {
                trigger.click();
            });
            expect(resetCalls).toBe(0);
            expect(rendered.container.textContent)
                .toContain("Reset every setting to its default?");
            const keep = findButton(rendered.container, "Keep settings");
            if (!keep) {
                throw new Error("Cancel action is missing");
            }
            await act(async () => {
                keep.click();
            });
            expect(resetCalls).toBe(0);
            expect(findButton(rendered.container, "Reset everything")).toBeUndefined();
            expect(findButton(rendered.container, "Reset all settings")).toBeDefined();
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
        const rendered = await renderOptions(ready, {
            transport: {
                sendMessage: (message) => {
                    if (messageType(message) === RESET_ALL_SETTINGS_MESSAGE) {
                        resetCalls += 1;
                        return Promise.resolve({ ok: false, error: "save-failed", state: ready });
                    }
                    return Promise.resolve(ready);
                },
            },
            initialDisplayState: custom,
            initialDebugState: debugOn,
        });
        try {
            await openSection(rendered.container, "Reset");
            await confirmReset(rendered.container);
            expect(resetCalls).toBe(1);
            expect(rendered.container.textContent).toContain("current settings remain active");
            expect(rendered.container.textContent).not.toContain("Processing remains disabled");
            await openSection(rendered.container, "Display");
            expect(rendered.container.querySelector<HTMLInputElement>(
                'input[aria-label="Format pattern"]',
            )?.value).toBe("yyyy-MM-dd");
            await openSection(rendered.container, "Diagnostics");
            expect(rendered.container.querySelector<HTMLInputElement>(
                'input[aria-label="Debug logs"]',
            )?.checked).toBe(true);
            await openSection(rendered.container, "Sites");
            expect(rendered.container.textContent).toContain("github.com");
        } finally {
            await rendered.unmount();
        }
    });

    it("keeps a healthy projection after an interrupted reset without retrying", async () => {
        let resetCalls = 0;
        const rendered = await renderOptions(ready, {
            transport: {
                sendMessage: (message) => {
                    if (messageType(message) === RESET_ALL_SETTINGS_MESSAGE) {
                        resetCalls += 1;
                        return Promise.reject(new Error("response interrupted"));
                    }
                    return Promise.resolve(ready);
                },
            },
        });
        try {
            await openSection(rendered.container, "Reset");
            await confirmReset(rendered.container);
            expect(resetCalls).toBe(1);
            expect(rendered.container.textContent).toContain(
                "Could not confirm whether settings were reset. "
                    + "Reopen Settings to check their current state.",
            );
            expect(rendered.container.textContent).not.toContain("current settings remain active");
            await openSection(rendered.container, "Sites");
            expect(rendered.container.textContent).toContain("github.com");
        } finally {
            await rendered.unmount();
        }
    });

    it("dispatches one reset and rehydrates default display and diagnostics", async () => {
        const unavailableDebug: DebugState = {
            availability: "unavailable",
            revision: null,
            enabled: null,
            failure: SETTINGS_STATE_FAILURE.SETTINGS_LOAD,
        };
        const messages: string[] = [];
        const rendered = await renderOptions(unavailableSites, {
            transport: {
                sendMessage: (message) => {
                    const type = messageType(message);
                    if (type) {
                        messages.push(type);
                    }
                    if (type === RESET_ALL_SETTINGS_MESSAGE) {
                        return Promise.resolve({
                            ok: true,
                            acceptedRevision: 0,
                            state: {
                                availability: "ready",
                                revision: 0,
                                globalEnabled: true,
                                scopeMode: SITE_SCOPE_MODE.ALL_EXCEPT_EXCLUDED,
                                excludedSites: [],
                                allowedSites: [],
                            },
                        });
                    }
                    if (type === GET_DISPLAY_STATE_MESSAGE) {
                        return Promise.resolve(displayReady);
                    }
                    if (type === GET_DEBUG_STATE_MESSAGE) {
                        return Promise.resolve({
                            availability: "ready",
                            revision: 0,
                            enabled: false,
                        });
                    }
                    return Promise.reject(new Error("unexpected message"));
                },
            },
            initialDisplayState: unavailableDisplay,
            initialDebugState: unavailableDebug,
        });
        try {
            await confirmReset(rendered.container);
            expect(messages.filter((type) => type === RESET_ALL_SETTINGS_MESSAGE))
                .toHaveLength(1);
            expect(messages.filter((type) => type === GET_DISPLAY_STATE_MESSAGE))
                .toHaveLength(1);
            expect(messages.filter((type) => type === GET_DEBUG_STATE_MESSAGE))
                .toHaveLength(1);
            expect(rendered.container.querySelectorAll('[role="tab"]')).toHaveLength(4);
            expect(rendered.container.textContent).toContain("No sites are excluded.");
            await openSection(rendered.container, "Display");
            expect(rendered.container.querySelector<HTMLSelectElement>(
                'select[aria-label="Time zone"]',
            )?.value).toBe("system");
            await openSection(rendered.container, "Diagnostics");
            expect(rendered.container.querySelector<HTMLInputElement>(
                'input[aria-label="Debug logs"]',
            )?.checked).toBe(false);
            expect(rendered.container.textContent).not.toContain("Debug logs are unavailable");
        } finally {
            await rendered.unmount();
        }
    });

    it("keeps recovery unavailable after a typed persistence failure", async () => {
        const rendered = await renderOptions(unavailableSites, {
            transport: {
                sendMessage: (message) =>
                    messageType(message) === RESET_ALL_SETTINGS_MESSAGE
                        ? Promise.resolve({
                            ok: false,
                            error: "save-failed",
                            state: unavailableSites,
                        })
                        : Promise.resolve(unavailableSites),
            },
            initialDisplayState: unavailableDisplay,
        });
        try {
            await confirmReset(rendered.container);
            expect(rendered.container.textContent).toContain("Could not reset settings");
            expect(rendered.container.textContent).toContain("Processing remains disabled");
            expect(rendered.container.textContent).toContain("Try again");
            expect(rendered.container.querySelectorAll('[role="tab"]')).toHaveLength(0);
        } finally {
            await rendered.unmount();
        }
    });

    it("does not retry an interrupted or malformed reset response", async () => {
        let resetCalls = 0;
        let reads = 0;
        const rendered = await renderOptions(unavailableSites, {
            transport: {
                sendMessage: (message) => {
                    if (messageType(message) === RESET_ALL_SETTINGS_MESSAGE) {
                        resetCalls += 1;
                        return Promise.reject(new Error("response interrupted"));
                    }
                    reads += 1;
                    return Promise.resolve(unavailableSites);
                },
            },
            initialDisplayState: unavailableDisplay,
        });
        try {
            await confirmReset(rendered.container);
            expect(resetCalls).toBe(1);
            expect(reads).toBe(0);
            expect(rendered.container.textContent).toContain("response could not be confirmed");
        } finally {
            await rendered.unmount();
        }
    });

    it("disables the recovery action while a reset is in flight", async () => {
        let release: ((value: unknown) => void) | undefined;
        const pending = new Promise<unknown>((resolve) => {
            release = resolve;
        });
        let resetCalls = 0;
        const rendered = await renderOptions(unavailableSites, {
            transport: {
                sendMessage: (message) => {
                    if (messageType(message) === RESET_ALL_SETTINGS_MESSAGE) {
                        resetCalls += 1;
                        return pending;
                    }
                    return Promise.resolve(unavailableSites);
                },
            },
            initialDisplayState: unavailableDisplay,
        });
        try {
            const trigger = findButton(rendered.container, "Reset all settings");
            if (!trigger) {
                throw new Error("Recovery button is missing");
            }
            await act(async () => {
                trigger.click();
            });
            const confirm = findButton(rendered.container, "Reset everything");
            if (!confirm) {
                throw new Error("Reset confirmation is missing");
            }
            await act(async () => {
                confirm.click();
                confirm.click();
            });
            expect(resetCalls).toBe(1);
            expect(confirm.disabled).toBe(true);
            release?.({ ok: false, error: "settings-unavailable", state: unavailableSites });
            await act(async () => {
                await pending;
            });
        } finally {
            await rendered.unmount();
        }
    });
});

describe("Options Display contract", () => {
    it("renders System by default and reveals the selected IANA control", async () => {
        const rendered = await renderOptions(ready);
        try {
            await openSection(rendered.container, "Display");
            expect(rendered.container.textContent).toContain("Date format");
            expect(rendered.container.querySelector<HTMLSelectElement>(
                'select[aria-label="Time zone"]',
            )?.value).toBe("system");
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

    it("previews the fixed fixture for the system format and follows the time zone", async () => {
        const rendered = await renderOptions(ready, {
            initialDisplayState: {
                ...displayReady,
                display: { formatMode: "system", timeZone: { mode: "utc" } },
            },
        });
        try {
            await openSection(rendered.container, "Display");
            const preview = rendered.container.querySelector(PREVIEW_SELECTOR);
            expect(preview?.textContent.replace(/\s/gu, " ")).toBe("Aug 27, 2026, 7:32 PM");
            expect(rendered.container.textContent).toContain("2026-08-27T19:32:28Z");
        } finally {
            await rendered.unmount();
        }
    });

    it("reports that an invalid pattern must be fixed before previewing", async () => {
        const rendered = await renderOptions(ready, {
            initialDisplayState: {
                ...displayReady,
                display: { formatMode: "custom", pattern: "yyyy", timeZone: { mode: "utc" } },
            },
        });
        try {
            await openSection(rendered.container, "Display");
            const pattern = rendered.container.querySelector<HTMLInputElement>(
                'input[aria-label="Format pattern"]',
            );
            if (!pattern) {
                throw new Error("Pattern field is missing");
            }
            expect(previewText(rendered.container))
                .toBe("2026");
            await act(async () => {
                setControlValue(pattern, "YYYY-MM-dd");
            });
            expect(previewText(rendered.container))
                .toBe("Fix the pattern to preview");
        } finally {
            await rendered.unmount();
        }
    });

    it("reports that a missing time zone identifier must be fixed before previewing", async () => {
        const rendered = await renderOptions(ready);
        try {
            await openSection(rendered.container, "Display");
            const zone = rendered.container.querySelector<HTMLSelectElement>(
                'select[aria-label="Time zone"]',
            );
            if (!zone) {
                throw new Error("Time zone select is missing");
            }
            await act(async () => {
                setControlValue(zone, "iana");
            });
            expect(previewText(rendered.container))
                .toBe("Fix the time zone to preview");
        } finally {
            await rendered.unmount();
        }
    });

    it("saves the appearance from the header immediately without touching the draft", async () => {
        const sent: unknown[] = [];
        const rendered = await renderOptions(ready, {
            transport: {
                sendMessage: (message) => {
                    sent.push(message);
                    return Promise.resolve({
                        ok: true,
                        acceptedRevision: 5,
                        state: {
                            availability: "ready",
                            revision: 5,
                            display: { formatMode: "system", timeZone: { mode: "system" } },
                            appearance: APPEARANCE.DARK,
                            debugEnabled: false,
                        },
                    });
                },
            },
        });
        try {
            await openSection(rendered.container, "Display");
            const zone = rendered.container.querySelector<HTMLSelectElement>(
                'select[aria-label="Time zone"]',
            );
            const appearance = rendered.container.querySelector<HTMLSelectElement>(
                'header select[aria-label="Appearance"]',
            );
            if (!zone || !appearance) {
                throw new Error("Appearance control or time zone control is missing");
            }
            await act(async () => {
                setControlValue(zone, "utc");
            });
            await act(async () => {
                setControlValue(appearance, APPEARANCE.DARK);
            });
            expect(sent).toEqual([{ type: SET_APPEARANCE_MESSAGE, appearance: APPEARANCE.DARK }]);
            expect(document.documentElement.dataset.mantineColorScheme).toBe("dark");
            expect(zone.value).toBe("utc");
            expect(rendered.container.querySelector('main select[aria-label="Appearance"]'))
                .toBeNull();
        } finally {
            await rendered.unmount();
        }
    });

    it("keeps a draft until Save and sends supported IANA values", async () => {
        const writes: unknown[] = [];
        const rendered = await renderOptions(ready, {
            transport: {
                sendMessage: (message) => {
                    if (messageType(message) === SET_DISPLAY_SETTINGS_MESSAGE) {
                        writes.push(message);
                        return Promise.resolve({
                            ok: true,
                            acceptedRevision: displayReady.revision + writes.length,
                            state: {
                                ...displayReady,
                                revision: displayReady.revision + writes.length,
                                display: (
                                    message as { display: typeof displayReady.display }
                                ).display,
                            },
                            refreshFailures: [],
                        });
                    }
                    return Promise.resolve(ready);
                },
            },
        });
        try {
            await openSection(rendered.container, "Display");
            const select = rendered.container.querySelector<HTMLSelectElement>(
                'select[aria-label="Time zone"]',
            );
            const save = findButton(rendered.container, "Save display settings");
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
            transport: {
                sendMessage: (message) => {
                    if (messageType(message) === SET_DISPLAY_SETTINGS_MESSAGE) {
                        writes += 1;
                    }
                    return Promise.resolve(ready);
                },
            },
        });
        try {
            await openSection(rendered.container, "Display");
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
            const save = findButton(rendered.container, "Save display settings");
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
            transport: {
                sendMessage: (message) => {
                    if (messageType(message) === SET_DISPLAY_SETTINGS_MESSAGE) {
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
            },
        });
        try {
            await openSection(rendered.container, "Display");
            const select = rendered.container.querySelector<HTMLSelectElement>(
                'select[aria-label="Time zone"]',
            );
            const save = findButton(rendered.container, "Save display settings");
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
        const rendered = await renderOptions(ready, { initialDisplayState: unavailable });
        try {
            await openSection(rendered.container, "Display");
            expect(rendered.container.querySelector<HTMLInputElement>(
                'input[aria-label="IANA time zone identifier"]',
            )?.value).toBe("Pacific/Apia");
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
            transport: {
                sendMessage: (message) => {
                    if (messageType(message) === SET_DISPLAY_SETTINGS_MESSAGE) {
                        return Promise.resolve({ unexpected: true });
                    }
                    if (messageType(message) === GET_DISPLAY_STATE_MESSAGE) {
                        reads += 1;
                        return Promise.resolve(reread);
                    }
                    return Promise.resolve(ready);
                },
            },
        });
        try {
            await openSection(rendered.container, "Display");
            const select = rendered.container.querySelector<HTMLSelectElement>(
                'select[aria-label="Time zone"]',
            );
            const save = findButton(rendered.container, "Save display settings");
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
            transport: {
                sendMessage: (message) =>
                    messageType(message) === SET_DISPLAY_SETTINGS_MESSAGE
                        ? Promise.resolve({
                            ok: true,
                            acceptedRevision: 3,
                            state: stale,
                            refreshFailures: [],
                        })
                        : Promise.resolve(ready),
            },
        });
        try {
            await openSection(rendered.container, "Display");
            const select = rendered.container.querySelector<HTMLSelectElement>(
                'select[aria-label="Time zone"]',
            );
            const save = findButton(rendered.container, "Save display settings");
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
            await openSection(rendered.container, "Display");
            expect(rendered.container.querySelector<HTMLSelectElement>(
                'select[aria-label="Time zone"]',
            )?.disabled).toBe(false);
            expect(findButton(rendered.container, "Save display settings")?.disabled).toBe(false);
        } finally {
            await rendered.unmount();
        }
    });

    it("keeps custom edits local, shows a live preview, and saves one complete value", async () => {
        const writes: unknown[] = [];
        const rendered = await renderOptions(ready, {
            transport: {
                sendMessage: (message) => {
                    if (messageType(message) === SET_DISPLAY_SETTINGS_MESSAGE) {
                        writes.push(message);
                        const display = (message as { display: DisplaySettings }).display;
                        return Promise.resolve({
                            ok: true,
                            acceptedRevision: 5,
                            state: { ...displayReady, revision: 5, display },
                            refreshFailures: [],
                        });
                    }
                    return Promise.resolve(ready);
                },
            },
        });
        try {
            await openSection(rendered.container, "Display");
            const format = rendered.container.querySelector<HTMLSelectElement>(
                'select[aria-label="Date format"]',
            );
            const save = findButton(rendered.container, "Save display settings");
            if (!format || !save) {
                throw new Error("Custom format controls are missing");
            }
            const before = previewText(rendered.container);
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
                setControlValue(pattern, "yyyy-MM-dd HH:mm");
            });
            expect(writes).toHaveLength(0);
            const after = previewText(rendered.container);
            expect(after).toMatch(/^2026-08-27 \d{2}:\d{2}$/u);
            expect(after).not.toBe(before);
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
            transport: {
                sendMessage: (message) => {
                    if (messageType(message) === SET_DISPLAY_SETTINGS_MESSAGE) {
                        writes += 1;
                    }
                    return Promise.resolve(ready);
                },
            },
        });
        try {
            await openSection(rendered.container, "Display");
            const format = rendered.container.querySelector<HTMLSelectElement>(
                'select[aria-label="Date format"]',
            );
            const save = findButton(rendered.container, "Save display settings");
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
        const rendered = await renderOptions(ready, {
            transport: {
                sendMessage: (message) => {
                    if (messageType(message) === SET_DISPLAY_SETTINGS_MESSAGE) {
                        writes.push(message);
                        return Promise.resolve({
                            ok: true,
                            acceptedRevision: 5,
                            state: {
                                ...custom,
                                revision: 5,
                                display: (message as { display: DisplaySettings })
                                    .display,
                            },
                            refreshFailures: [],
                        });
                    }
                    return Promise.resolve(ready);
                },
            },
            initialDisplayState: custom,
        });
        try {
            await openSection(rendered.container, "Display");
            const format = rendered.container.querySelector<HTMLSelectElement>(
                'select[aria-label="Date format"]',
            );
            const save = findButton(rendered.container, "Save display settings");
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
            transport: {
                sendMessage: (message) => {
                    if (messageType(message) === SET_DISPLAY_SETTINGS_MESSAGE) {
                        writes.push(message);
                    }
                    return Promise.resolve(displayReady);
                },
            },
        });
        try {
            await openSection(rendered.container, "Display");
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
            const firstPreview = previewText(rendered.container);
            expect(firstPreview).toBeDefined();
            await act(async () => {
                setControlValue(pattern, "EEEE, d MMMM yyyy");
            });
            const secondPreview = previewText(rendered.container);
            expect(secondPreview).toBeDefined();
            expect(secondPreview).not.toBe(firstPreview);
            await act(async () => {
                setControlValue(pattern, "yyyy-MM-dd HH:mm XXX");
                setControlValue(zone, "utc");
            });
            expect(previewText(rendered.container)).toBe("2026-08-27 19:32 Z");
            await act(async () => {
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
            expect(previewText(rendered.container)).toBe("2026-08-27 15:32 -04:00");
            expect(writes).toHaveLength(0);
        } finally {
            await rendered.unmount();
        }
    });

    it.each([
        ["empty", ""],
        ["whitespace", "   "],
        ["oversize", "y".repeat(257)],
        ["control character", `yyyy-MM-dd${String.fromCharCode(1)}`],
        ["unclosed quote", "yyyy-MM-dd '"],
        ["unsupported token", "yyyy-MM-dd J"],
        ["legacy token", "YYYY-MM-dd"],
    ])("blocks %s custom patterns without a save", async (_name, invalidPattern) => {
        let writes = 0;
        const rendered = await renderOptions(ready, {
            transport: {
                sendMessage: (message) => {
                    if (messageType(message) === SET_DISPLAY_SETTINGS_MESSAGE) {
                        writes += 1;
                    }
                    return Promise.resolve(displayReady);
                },
            },
        });
        try {
            await openSection(rendered.container, "Display");
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
            const save = findButton(rendered.container, "Save display settings");
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
            expect(previewText(rendered.container))
                .toBe("Fix the pattern to preview");
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
        const rendered = await renderOptions(ready, {
            transport: {
                sendMessage: (message) => {
                    if (messageType(message) === SET_DISPLAY_SETTINGS_MESSAGE) {
                        writes.push(message);
                        return Promise.resolve({
                            ok: true,
                            acceptedRevision: 5,
                            state: {
                                ...custom,
                                revision: 5,
                                display: (message as { display: DisplaySettings })
                                    .display,
                            },
                            refreshFailures: [],
                        });
                    }
                    return Promise.resolve(ready);
                },
            },
            initialDisplayState: custom,
        });
        try {
            await openSection(rendered.container, "Display");
            const pattern = rendered.container.querySelector<HTMLInputElement>(
                'input[aria-label="Format pattern"]',
            );
            const save = findButton(rendered.container, "Save display settings");
            if (!pattern || !save) {
                throw new Error("Saved custom controls are missing");
            }
            await act(async () => {
                setControlValue(pattern, "EEEE, d MMMM yyyy");
            });
            expect(previewText(rendered.container))
                .toContain("Donnerstag");
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
            transport: {
                sendMessage: (message) =>
                    messageType(message) === SET_DISPLAY_SETTINGS_MESSAGE
                        ? Promise.resolve({
                            ok: false,
                            error: "invalid-format",
                            state: displayReady,
                        })
                        : Promise.resolve(ready),
            },
        });
        try {
            await openSection(rendered.container, "Display");
            const format = rendered.container.querySelector<HTMLSelectElement>(
                'select[aria-label="Date format"]',
            );
            const save = findButton(rendered.container, "Save display settings");
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

    it("keeps an unsaved draft and warns when display settings change elsewhere", async () => {
        let announce: ((revision: number) => void) | undefined;
        const external: DisplayState = {
            ...displayReady,
            revision: 9,
            display: { formatMode: "system", timeZone: { mode: "utc" } },
        };
        const rendered = await renderOptions(ready, {
            transport: {
                sendMessage: (message) => {
                    const type = messageType(message);
                    if (type === GET_DISPLAY_STATE_MESSAGE) {
                        return Promise.resolve(external);
                    }
                    if (type === GET_DEBUG_STATE_MESSAGE) {
                        return Promise.resolve({ ...debugReady, revision: 9 });
                    }
                    return Promise.resolve({ ...ready, revision: 9 });
                },
            },
            subscribe: (listener) => {
                announce = listener;
                return { unsubscribe: () => undefined };
            },
        });
        try {
            await openSection(rendered.container, "Display");
            const format = rendered.container.querySelector<HTMLSelectElement>(
                'select[aria-label="Date format"]',
            );
            if (!format) {
                throw new Error("Date format control is missing");
            }
            await act(async () => {
                setControlValue(format, "custom");
            });
            await act(async () => {
                announce?.(9);
            });
            expect(format.value).toBe("custom");
            expect(rendered.container.textContent)
                .toContain("Display settings were updated in another window.");
        } finally {
            await rendered.unmount();
        }
    });
});

describe("Options Debug logs contract", () => {
    it("opens with the privacy note, Debug logs off, and archive actions unavailable", async () => {
        const rendered = await renderOptions(ready);
        try {
            await openSection(rendered.container, "Diagnostics");
            expect(rendered.container.textContent)
                .toContain("Logs stay on this device and are never submitted automatically.");
            expect(rendered.container.querySelector<HTMLInputElement>(
                'input[aria-label="Debug logs"]',
            )?.checked).toBe(false);
            expect(findButton(rendered.container, "Download logs")?.disabled).toBe(true);
            expect(findButton(rendered.container, "Clear logs")?.disabled).toBe(true);
        } finally {
            await rendered.unmount();
        }
    });

    it("dispatches one request per transition", async () => {
        const messages: unknown[] = [];
        const rendered = await renderOptions(ready, {
            transport: {
                sendMessage: (message) => {
                    messages.push(message);
                    if (
                        messageType(message) === SET_DEBUG_ENABLED_MESSAGE
                    && message && typeof message === "object" && "enabled" in message
                    ) {
                        const revision = message.enabled ? 5 : 6;
                        return Promise.resolve({
                            ok: true,
                            acceptedRevision: revision,
                            state: { availability: "ready", revision, enabled: message.enabled },
                        });
                    }
                    if (messageType(message) === GET_DEBUG_STATE_MESSAGE) {
                        return Promise.resolve(debugReady);
                    }
                    return Promise.resolve(ready);
                },
            },
        });
        try {
            await openSection(rendered.container, "Diagnostics");
            const toggle = rendered.container.querySelector<HTMLInputElement>(
                'input[aria-label="Debug logs"]',
            );
            if (!toggle) {
                throw new Error("Debug logs switch is missing");
            }
            await act(async () => {
                toggle.click();
            });
            expect(messages.filter((m) => messageType(m) === SET_DEBUG_ENABLED_MESSAGE))
                .toHaveLength(1);
            expect(toggle.checked).toBe(true);
            await act(async () => {
                toggle.click();
            });
            expect(messages.filter((m) => messageType(m) === SET_DEBUG_ENABLED_MESSAGE))
                .toEqual([
                    { type: SET_DEBUG_ENABLED_MESSAGE, enabled: true },
                    { type: SET_DEBUG_ENABLED_MESSAGE, enabled: false },
                ]);
            expect(toggle.checked).toBe(false);
        } finally {
            await rendered.unmount();
        }
    });

    it("shows an actionable typed failure without replaying the mutation", async () => {
        let writes = 0;
        const rendered = await renderOptions(ready, {
            transport: {
                sendMessage: (message) => {
                    if (messageType(message) === SET_DEBUG_ENABLED_MESSAGE) {
                        writes += 1;
                        return Promise.resolve({
                            ok: false,
                            error: "save-failed",
                            state: debugReady,
                        });
                    }
                    return Promise.resolve(debugReady);
                },
            },
        });
        try {
            await openSection(rendered.container, "Diagnostics");
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
                transport: {
                    sendMessage: (message) => {
                        if (messageType(message) === SET_DEBUG_ENABLED_MESSAGE) {
                            writes += 1;
                            return failure === "interrupted"
                                ? Promise.reject(new Error("worker restarted"))
                                : Promise.resolve({ unexpected: true });
                        }
                        if (messageType(message) === GET_DEBUG_STATE_MESSAGE) {
                            reads += 1;
                            return Promise.resolve({
                                availability: "ready",
                                revision: 5,
                                enabled: true,
                            });
                        }
                        return Promise.resolve(ready);
                    },
                },
            });
            try {
                await openSection(rendered.container, "Diagnostics");
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
                expect(toggle.checked).toBe(true);
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
            transport: {
                sendMessage: (message) => {
                    if (messageType(message) === SET_DEBUG_ENABLED_MESSAGE) {
                        writes += 1;
                        return pending;
                    }
                    return Promise.resolve(debugReady);
                },
            },
        });
        try {
            await openSection(rendered.container, "Diagnostics");
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
            expect(toggle.disabled).toBe(false);
            expect(toggle.getAttribute("aria-busy")).toBe("true");
            await act(async () => {
                release?.({
                    ok: true,
                    acceptedRevision: 5,
                    state: { availability: "ready", revision: 5, enabled: true },
                });
                await pending;
            });
            expect(toggle.getAttribute("aria-busy")).toBe("false");
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
        const rendered = await renderOptions(ready, {
            transport: {
                sendMessage: (message) => {
                    messages.push(message);
                    if (messageType(message) === GET_DIAGNOSTICS_SNAPSHOT_MESSAGE) {
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
            initialDisplayState: displayReady,
            initialDebugState: { ...debugReady, enabled: true },
            archiveRuntime: runtime,
        });
        try {
            await openSection(rendered.container, "Diagnostics");
            const download = findButton(rendered.container, "Download logs");
            if (!download) {
                throw new Error("Download logs action is missing");
            }
            await act(async () => {
                download.click();
            });
            expect(messages.filter((m) => messageType(m) === GET_DIAGNOSTICS_SNAPSHOT_MESSAGE))
                .toHaveLength(1);
            expect(clicks).toBe(1);
            expect(revoked).toEqual([]);
            scheduled[0]?.();
            expect(revoked).toEqual(["blob:options"]);
            expect(rendered.container.textContent).toContain("Diagnostic logs downloaded.");
        } finally {
            await rendered.unmount();
        }
    });

    it("clears logs once without changing the enabled Debug logs setting", async () => {
        const messages: unknown[] = [];
        const rendered = await renderOptions(ready, {
            transport: {
                sendMessage: (message) => {
                    messages.push(message);
                    if (messageType(message) === CLEAR_DIAGNOSTICS_MESSAGE) {
                        return Promise.resolve({ ok: true });
                    }
                    return Promise.resolve(ready);
                },
            },
            initialDisplayState: displayReady,
            initialDebugState: { ...debugReady, enabled: true },
        });
        try {
            await openSection(rendered.container, "Diagnostics");
            const clear = findButton(rendered.container, "Clear logs");
            if (!clear) {
                throw new Error("Clear logs action is missing");
            }
            await act(async () => {
                clear.click();
                clear.click();
            });
            expect(messages.filter((m) => messageType(m) === CLEAR_DIAGNOSTICS_MESSAGE))
                .toHaveLength(1);
            expect(rendered.container.querySelector<HTMLInputElement>(
                'input[aria-label="Debug logs"]',
            )?.checked).toBe(true);
            expect(rendered.container.textContent).toContain("Diagnostic logs cleared.");
            expect(findButton(rendered.container, "Download logs")?.disabled).toBe(false);
        } finally {
            await rendered.unmount();
        }
    });

    it("explains an empty journal when a download is requested", async () => {
        const rendered = await renderOptions(ready, {
            transport: {
                sendMessage: (message) =>
                    messageType(message) === GET_DIAGNOSTICS_SNAPSHOT_MESSAGE
                        ? Promise.resolve({ ok: false, error: "empty" })
                        : Promise.resolve(ready),
            },
            initialDisplayState: displayReady,
            initialDebugState: { ...debugReady, enabled: true },
        });
        try {
            await openSection(rendered.container, "Diagnostics");
            const download = findButton(rendered.container, "Download logs");
            if (!download) {
                throw new Error("Download logs action is missing");
            }
            await act(async () => {
                download.click();
            });
            expect(rendered.container.textContent).toContain("no diagnostic logs to download");
        } finally {
            await rendered.unmount();
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
            const rendered = await renderOptions(ready, {
                transport: {
                    sendMessage: (message) => {
                        if (messageType(message) === GET_DIAGNOSTICS_SNAPSHOT_MESSAGE) {
                            requests += 1;
                            if (failure === "malformed") {
                                return Promise.resolve({ unexpected: true });
                            }
                            return Promise.resolve({ ok: false, error: failure });
                        }
                        return Promise.resolve(ready);
                    },
                },
                initialDisplayState: displayReady,
                initialDebugState: { ...debugReady, enabled: true },
                archiveRuntime: runtime,
            });
            try {
                await openSection(rendered.container, "Diagnostics");
                const download = findButton(rendered.container, "Download logs");
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
        const rendered = await renderOptions(ready, {
            transport: {
                sendMessage: (message) =>
                    messageType(message) === GET_DIAGNOSTICS_SNAPSHOT_MESSAGE
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
            initialDisplayState: displayReady,
            initialDebugState: { ...debugReady, enabled: true },
            archiveRuntime: runtime,
        });
        try {
            await openSection(rendered.container, "Diagnostics");
            const download = findButton(rendered.container, "Download logs");
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
        const rendered = await renderOptions(ready, {
            transport: {
                sendMessage: (message) => {
                    if (messageType(message) === GET_DIAGNOSTICS_SNAPSHOT_MESSAGE) {
                        requests += 1;
                        return pending;
                    }
                    return Promise.resolve(ready);
                },
            },
            initialDisplayState: displayReady,
            initialDebugState: { ...debugReady, enabled: true },
            archiveRuntime: runtime,
        });
        try {
            await openSection(rendered.container, "Diagnostics");
            const download = findButton(rendered.container, "Download logs");
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
            const rendered = await renderOptions(ready, {
                transport: {
                    sendMessage: (message) => {
                        if (messageType(message) === CLEAR_DIAGNOSTICS_MESSAGE) {
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
                initialDisplayState: displayReady,
                initialDebugState: { ...debugReady, enabled: true },
            });
            try {
                await openSection(rendered.container, "Diagnostics");
                const clear = findButton(rendered.container, "Clear logs");
                if (!clear) {
                    throw new Error("Clear logs action is missing");
                }
                await act(async () => {
                    clear.click();
                    clear.click();
                });
                expect(requests).toBe(1);
                expect(rendered.container.querySelector<HTMLInputElement>(
                    'input[aria-label="Debug logs"]',
                )?.checked).toBe(true);
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
            const rendered = await renderOptions(ready, {
                transport: {
                    sendMessage: (message) => {
                        messages.push(message);
                        return Promise.resolve(ready);
                    },
                },
                initialDisplayState: displayReady,
                initialDebugState: { ...debugReady, enabled },
                reporter: reporter,
            });
            try {
                await openSection(rendered.container, "Diagnostics");
                const button = findButton(rendered.container, "Open GitHub issue");
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
        const rendered = await renderOptions(ready, {
            initialDisplayState: displayReady,
            initialDebugState: debugReady,
            reporter: reporter,
        });
        try {
            await openSection(rendered.container, "Diagnostics");
            const button = findButton(rendered.container, "Open GitHub issue");
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
        const rendered = await renderOptions(ready, {
            initialDisplayState: displayReady,
            initialDebugState: debugReady,
            reporter: reporter,
        });
        try {
            await openSection(rendered.container, "Diagnostics");
            const button = findButton(rendered.container, "Open GitHub issue");
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
            await openSection(rendered.container, "Diagnostics");
            expect(queries).toBe(0);
            expect(manifestReads).toBe(0);
            expect(userAgentReads).toBe(0);
            expect(created).toHaveLength(0);
            const button = findButton(rendered.container, "Open GitHub issue");
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

describe("Options shell", () => {
    it("opens on Sites and shows one panel at a time", async () => {
        const rendered = await renderOptions(ready);
        try {
            const tabs = [...rendered.container.querySelectorAll<HTMLElement>('[role="tab"]')];
            expect(tabs.map((tab) => tab.textContent))
                .toEqual(["Sites", "Display", "Diagnostics", "Reset"]);
            expect(tabs[0]?.getAttribute("aria-selected")).toBe("true");
            expect(rendered.container.textContent).toContain("Excluded sites");
            expect(rendered.container.textContent).not.toContain("Date format");
            await act(async () => {
                tabs[1]?.click();
            });
            expect(rendered.container.textContent).toContain("Date format");
            expect(rendered.container.textContent).not.toContain("Excluded sites");
        } finally {
            await rendered.unmount();
        }
    });

    it("always opens on Sites after a remount", async () => {
        const first = await renderOptions(ready);
        const tabs = [...first.container.querySelectorAll<HTMLElement>('[role="tab"]')];
        await act(async () => {
            tabs[2]?.click();
        });
        expect(first.container.textContent).toContain("Debug logs");
        await first.unmount();

        const second = await renderOptions(ready);
        try {
            expect(second.container.querySelector('[role="tab"]')?.getAttribute("aria-selected"))
                .toBe("true");
            expect(second.container.textContent).toContain("Excluded sites");
        } finally {
            await second.unmount();
        }
    });

    it("shows the brand and no popup link in the header", async () => {
        const rendered = await renderOptions(ready);
        try {
            const header = rendered.container.querySelector("header");
            expect(header?.textContent).toContain("No More Ago");
            expect(header?.querySelectorAll("a, button")).toHaveLength(0);
        } finally {
            await rendered.unmount();
        }
    });

    it("reloads and reports a change announced by another window", async () => {
        let announce: ((revision: number) => void) | undefined;
        const updated: SitesState = {
            ...ready,
            revision: 9,
            excludedSites: ["github.com", "from-other-window.test"],
        };
        const rendered = await renderOptions(ready, {
            transport: {
                sendMessage: (message) => {
                    const type = messageType(message);
                    if (type === GET_DISPLAY_STATE_MESSAGE) {
                        return Promise.resolve({ ...displayReady, revision: 9 });
                    }
                    if (type === GET_DEBUG_STATE_MESSAGE) {
                        return Promise.resolve({ ...debugReady, revision: 9 });
                    }
                    return Promise.resolve(updated);
                },
            },
            subscribe: (listener) => {
                announce = listener;
                return { unsubscribe: () => undefined };
            },
        });
        try {
            await act(async () => {
                announce?.(9);
            });
            expect(rendered.container.textContent).toContain("from-other-window.test");
            expect(rendered.container.textContent)
                .toContain("Settings were updated in another window.");
        } finally {
            await rendered.unmount();
        }
    });

    it("does not report its own committed write as an external change", async () => {
        let announce: ((revision: number) => void) | undefined;
        const rendered = await renderOptions(ready, {
            transport: {
                sendMessage: (message) => {
                    if (messageType(message) === SET_SITE_ENABLED_MESSAGE) {
                        // The background announces before the command response arrives.
                        announce?.(5);
                        return Promise.resolve({
                            ok: true,
                            acceptedRevision: 5,
                            surface: SITE_SETTINGS_SURFACE.SITES,
                            state: { ...ready, revision: 5, excludedSites: [] },
                        });
                    }
                    return Promise.resolve(ready);
                },
            },
            subscribe: (listener) => {
                announce = listener;
                return { unsubscribe: () => undefined };
            },
        });
        try {
            const allow = findButton(rendered.container, "Remove");
            if (!allow) {
                throw new Error("Row action is missing");
            }
            await act(async () => {
                allow.click();
            });
            expect(rendered.container.textContent).toContain("No sites are excluded.");
            expect(rendered.container.textContent)
                .not.toContain("Settings were updated in another window.");
        } finally {
            await rendered.unmount();
        }
    });

    it("ignores an announcement that is not newer than the rendered revision", async () => {
        let announce: ((revision: number) => void) | undefined;
        let reads = 0;
        const rendered = await renderOptions(ready, {
            transport: {
                sendMessage: () => {
                    reads += 1;
                    return Promise.resolve(ready);
                },
            },
            subscribe: (listener) => {
                announce = listener;
                return { unsubscribe: () => undefined };
            },
        });
        try {
            await act(async () => {
                announce?.(4);
            });
            expect(reads).toBe(0);
            expect(rendered.container.textContent)
                .not.toContain("Settings were updated in another window.");
        } finally {
            await rendered.unmount();
        }
    });

    it("keeps the last ready projection when a live reread fails", async () => {
        let announce: ((revision: number) => void) | undefined;
        const rendered = await renderOptions(ready, {
            transport: { sendMessage: () => Promise.reject(new Error("worker restarting")) },
            subscribe: (listener) => {
                announce = listener;
                return { unsubscribe: () => undefined };
            },
        });
        try {
            await act(async () => {
                announce?.(9);
            });
            expect(rendered.container.textContent).toContain("github.com");
            expect(rendered.container.textContent).not.toContain("Settings are unavailable");
        } finally {
            await rendered.unmount();
        }
    });

    it("explains the fail-closed cleanup state on the recovery view", async () => {
        const cleanup: SitesState = {
            ...unavailableSites,
            failure: SETTINGS_STATE_FAILURE.FAIL_CLOSED_CLEANUP,
        };
        const rendered = await renderOptions(cleanup, {
            transport: { sendMessage: () => Promise.resolve(cleanup) },
            initialDisplayState: unavailableDisplay,
        });
        try {
            expect(rendered.container.textContent)
                .toContain("Current processing state is unknown.");
            expect(rendered.container.textContent).not.toContain("No page is being changed.");
        } finally {
            await rendered.unmount();
        }
    });

    it("replaces every control with recovery actions when settings are unavailable", async () => {
        const rendered = await renderOptions(unavailableSites, {
            transport: { sendMessage: () => Promise.resolve(unavailableSites) },
            initialDisplayState: unavailableDisplay,
        });
        try {
            const labels = [...rendered.container.querySelectorAll("button")]
                .map((button) => button.textContent);
            expect(rendered.container.querySelectorAll('[role="tab"]')).toHaveLength(0);
            expect(rendered.container.querySelectorAll("input")).toHaveLength(0);
            expect(labels).toContain("Open GitHub issue");
            expect(labels).toContain("Download logs");
            expect(labels).toContain("Reset all settings");
        } finally {
            await rendered.unmount();
        }
    });

    it("attempts a log download from the recovery view and reports the outcome", async () => {
        const rendered = await renderOptions(unavailableSites, {
            transport: {
                sendMessage: (message) =>
                    messageType(message) === GET_DIAGNOSTICS_SNAPSHOT_MESSAGE
                        ? Promise.resolve({ ok: false, error: "disabled" })
                        : Promise.resolve(unavailableSites),
            },
            initialDisplayState: unavailableDisplay,
            initialDebugState: {
                availability: "unavailable",
                revision: null,
                enabled: null,
                failure: SETTINGS_STATE_FAILURE.SETTINGS_LOAD,
            },
        });
        try {
            const download = findButton(rendered.container, "Download logs");
            if (!download) {
                throw new Error("Download logs action is missing");
            }
            await act(async () => {
                download.click();
            });
            expect(rendered.container.textContent).toContain("Debug logs are off.");
        } finally {
            await rendered.unmount();
        }
    });
});
