/**
 * @file Verifies popup UI status, activation controls, navigation, and reporting.
 */

/* eslint-disable @typescript-eslint/require-await */
import { beforeAll, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { PopupApp } from "../../src/popup/app";
import { PopupClient, type PopupTransport } from "../../src/popup/client";
import { GET_POPUP_STATE_MESSAGE, SET_GLOBAL_ENABLED_MESSAGE, SET_SITE_ENABLED_MESSAGE } from "../../src/background/messages";
import type { PopupState } from "../../src/background/application";
import { createSiteReportReporter, type SiteReportReporter, type SiteReportResult, type SiteReportTab } from "../../src/reporting/site-report";

const active: PopupState = { availability: "ready", revision: 2, globalEnabled: true, hostname: "github.com", siteEnabled: true, hasAdapter: true, status: "active" };

beforeAll(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    Object.defineProperty(window, "matchMedia", {
        configurable: true,
        value: () => ({ matches: false, media: "", onchange: null, addListener: () => undefined, removeListener: () => undefined, addEventListener: () => undefined, removeEventListener: () => undefined, dispatchEvent: () => false })
    });
});

/**
 * Renders the popup application with injectable background and reporting dependencies.
 *
 * @param state - Optional preloaded popup state.
 * @param transport - Background message transport used by the client.
 * @param reporter - Optional site-report service.
 * @returns - Mounted container and asynchronous cleanup action.
 */
async function renderPopup(state: PopupState | undefined, transport: PopupTransport = { sendMessage: () => Promise.resolve(state) }, reporter?: SiteReportReporter): Promise<{ container: HTMLDivElement; unmount: () => Promise<void> }> {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const initialProps = state ? { initialState: state } : {};
    const reportingProps = reporter ? { reporter } : {};
    await act(async () => {
        root.render(<PopupApp {...initialProps} {...reportingProps} client={new PopupClient(transport)} />);
    });
    return {
        container,
        unmount: async () => {
            await act(async () => {
                root.unmount();
            }); container.remove();
        }
    };
}

/**
 * Creates an observable site-report service around one active-tab response.
 *
 * @param tab - Active tab returned to the reporter, when available.
 * @returns - Reporter and captured query, open, and manifest-read state.
 */
function createReportingFixture(tab: SiteReportTab | undefined): {
    readonly reporter: SiteReportReporter;
    readonly queries: { readonly active: true; readonly currentWindow: true }[];
    readonly opened: { readonly url: string; readonly windowId?: number }[];
    readonly manifestReads: () => number;
} {
    const queries: { readonly active: true; readonly currentWindow: true }[] = [];
    const opened: { readonly url: string; readonly windowId?: number }[] = [];
    let manifestReads = 0;
    const reporter = createSiteReportReporter({
        tabs: {
            query: async (query) => {
                queries.push(query); return tab === undefined ? [] : [tab];
            },
            create: async (properties) => {
                opened.push(properties);
            }
        },
        runtime: { getManifest: () => {
            manifestReads += 1; return { version: "1.2.3" };
        } },
        navigator: { userAgent: "Chrome/130.0" }
    });
    return { reporter, queries, opened, manifestReads: () => manifestReads };
}

describe("PopupApp contract", () => {
    it("renders the English hostname, global switch, active status, and no counter/page UI", async () => {
        const rendered = await renderPopup(active);
        try {
            expect(rendered.container.textContent).toContain("github.com");
            expect(rendered.container.textContent).toContain("Active on github.com");
            expect(rendered.container.querySelector("input[type=checkbox]")).not.toBeNull();
            expect(rendered.container.textContent).not.toMatch(/counter|replacement|options|site switch/i);
            expect(Array.from(rendered.container.querySelectorAll("button"), (button) => button.textContent)).toEqual(["Report this site"]);
        } finally {
            await rendered.unmount();
        }
    });

    it.each([
        [{ availability: "ready", revision: 2, globalEnabled: false, hostname: "github.com", siteEnabled: true, hasAdapter: true, status: "global-disabled" }, "Extension is off"],
        [{ availability: "ready", revision: 2, globalEnabled: true, hostname: null, siteEnabled: null, hasAdapter: false, status: "inaccessible" }, "Cannot run on this page"],
        [{ availability: "ready", revision: 2, globalEnabled: true, hostname: "github.com", siteEnabled: true, hasAdapter: true, status: "runtime-failed", failure: "document-status" }, "Could not process this page"],
        [{ availability: "ready", revision: 2, globalEnabled: true, hostname: "example.test", siteEnabled: true, hasAdapter: false, status: "no-rules" }, "Rules are not available for example.test yet"],
        [{ availability: "unavailable", revision: null, globalEnabled: null, hostname: null, siteEnabled: null, hasAdapter: false, status: "settings-unavailable", failure: "settings-load" }, "Settings are unavailable"],
        [{ availability: "unavailable", revision: null, globalEnabled: null, hostname: "github.com", siteEnabled: null, hasAdapter: false, status: "runtime-failed", failure: "fail-closed-cleanup" }, "Current processing state is unknown"]
    ] as const)("renders %s status truthfully", async (state, wording) => {
        const rendered = await renderPopup(state);
        try {
            expect(rendered.container.textContent).toContain(wording);
        } finally {
            await rendered.unmount();
        }
    });

    it("ignores a lower revision response and shows the typed save failure alert", async () => {
        const transport: PopupTransport = {
            sendMessage: (message) => message && typeof message === "object" && "type" in message && message.type === SET_GLOBAL_ENABLED_MESSAGE
                ? Promise.resolve({ ok: false, error: "save-failed", state: { ...active, revision: 1, globalEnabled: true } })
                : Promise.resolve(active)
        };
        const rendered = await renderPopup(active, transport);
        try {
            const input = rendered.container.querySelector("input[type=checkbox]") as HTMLInputElement;
            await act(async () => {
                input.click();
            });
            expect(input.checked).toBe(true);
            expect(rendered.container.textContent).toContain("Could not save this change. Try again.");
        } finally {
            await rendered.unmount();
        }
    });

    it("rereads a committed state after an ambiguous response and gates revisions", async () => {
        const committed: PopupState = { ...active, revision: 3, globalEnabled: false, status: "global-disabled" };
        const transport: PopupTransport = {
            sendMessage: (message) => {
                if (message && typeof message === "object" && "type" in message && message.type === SET_GLOBAL_ENABLED_MESSAGE) {
                    return Promise.reject(new Error("response lost"));
                }
                if (message && typeof message === "object" && "type" in message && message.type === GET_POPUP_STATE_MESSAGE) {
                    return Promise.resolve(committed);
                }
                return Promise.reject(new Error("unexpected"));
            }
        };
        const rendered = await renderPopup(active, transport);
        try {
            const input = rendered.container.querySelector("input[type=checkbox]") as HTMLInputElement;
            await act(async () => {
                input.click();
            });
            expect(input.checked).toBe(false);
            expect(rendered.container.textContent).toContain("The response was interrupted. Current state was reloaded.");
            expect(rendered.container.textContent).toContain("Extension is off");
        } finally {
            await rendered.unmount();
        }
    });

    it("shows a disabled mixed switch when both the command and reread are lost", async () => {
        const transport: PopupTransport = { sendMessage: () => Promise.reject(new Error("transport lost")) };
        const rendered = await renderPopup(active, transport);
        try {
            const input = rendered.container.querySelector("input[type=checkbox]") as HTMLInputElement;
            await act(async () => {
                input.click();
            });
            expect(input.disabled).toBe(true);
            expect(input.indeterminate).toBe(true);
            expect(input.getAttribute("aria-checked")).toBe("mixed");
            expect(rendered.container.textContent).toContain("Could not confirm whether the change was saved");
            expect(rendered.container.textContent).toContain("Current state is unavailable");
            expect(rendered.container.textContent).not.toContain("Active on github.com");
        } finally {
            await rendered.unmount();
        }
    });

    it("renders and edits an exact no-adapter host without calling it unsupported", async () => {
        const initial: PopupState = { availability: "ready", revision: 2, globalEnabled: true, hostname: "example.test", siteEnabled: true, hasAdapter: false, status: "no-rules" };
        let writes = 0;
        const transport: PopupTransport = {
            sendMessage: (message) => {
                if (message && typeof message === "object" && "type" in message && message.type === SET_SITE_ENABLED_MESSAGE) {
                    writes += 1;
                    return Promise.resolve({ ok: true, acceptedRevision: 3, surface: "popup", state: { ...initial, revision: 3, siteEnabled: false, status: "site-disabled" } });
                }
                return Promise.resolve(initial);
            }
        };
        const rendered = await renderPopup(initial, transport);
        try {
            expect(rendered.container.textContent).toContain("Rules are not available for example.test yet");
            expect(rendered.container.textContent).not.toMatch(/unsupported/i);
            const siteInput = rendered.container.querySelector('input[aria-label="Enabled on example.test"]') as HTMLInputElement;
            expect(siteInput).not.toBeNull();
            expect(siteInput.checked).toBe(true);
            await act(async () => {
                siteInput.click();
            });
            expect(writes).toBe(1);
            expect(rendered.container.textContent).toContain("Disabled on example.test");
        } finally {
            await rendered.unmount();
        }
    });

    it("keeps typed invalid-hostname responses distinct from response loss", async () => {
        const invalid: PopupTransport = {
            sendMessage: (message) => {
                if (message && typeof message === "object" && "type" in message && message.type === SET_SITE_ENABLED_MESSAGE) {
                    return Promise.resolve({ ok: false, error: "invalid-hostname", surface: "popup", state: active });
                }
                return Promise.resolve(active);
            }
        };
        const rendered = await renderPopup(active, invalid);
        try {
            const siteInput = rendered.container.querySelector('input[aria-label="Enabled on github.com"]') as HTMLInputElement;
            await act(async () => {
                siteInput.click();
            });
            expect(rendered.container.textContent).toContain("hostname is invalid");
            expect(rendered.container.textContent).not.toContain("response was interrupted");
        } finally {
            await rendered.unmount();
        }
    });

    it("links to extension-local Settings and preserves the disabled-site wording", async () => {
        const disabled: PopupState = { ...active, siteEnabled: false, status: "site-disabled" };
        const rendered = await renderPopup(disabled);
        try {
            const settings = rendered.container.querySelector('a[href="options.html"]');
            expect(settings?.textContent).toBe("Settings");
            expect(rendered.container.textContent).toContain("Disabled on github.com");
        } finally {
            await rendered.unmount();
        }
    });

    it("preserves the authoritative checked site state after a typed save failure", async () => {
        let rereads = 0;
        const transport: PopupTransport = {
            sendMessage: (message) => {
                if (message && typeof message === "object" && "type" in message && message.type === SET_SITE_ENABLED_MESSAGE) {
                    return Promise.resolve({ ok: false, error: "save-failed", surface: "popup", state: active });
                }
                rereads += 1;
                return Promise.resolve(active);
            }
        };
        const rendered = await renderPopup(active, transport);
        try {
            const input = rendered.container.querySelector('input[aria-label="Enabled on github.com"]') as HTMLInputElement;
            await act(async () => {
                input.click();
            });
            expect(input.checked).toBe(true);
            expect(rendered.container.textContent).toContain("Could not save this change. Try again.");
            expect(rereads).toBe(0);
        } finally {
            await rendered.unmount();
        }
    });

    it("rereads the authoritative site state after a lost response", async () => {
        const committed: PopupState = { ...active, revision: 3, siteEnabled: false, status: "site-disabled" };
        let rereads = 0;
        const transport: PopupTransport = {
            sendMessage: (message) => {
                if (message && typeof message === "object" && "type" in message && message.type === SET_SITE_ENABLED_MESSAGE) {
                    return Promise.reject(new Error("response lost"));
                }
                if (message && typeof message === "object" && "type" in message && message.type === GET_POPUP_STATE_MESSAGE) {
                    rereads += 1;
                    return Promise.resolve(committed);
                }
                return Promise.reject(new Error("unexpected"));
            }
        };
        const rendered = await renderPopup(active, transport);
        try {
            const input = rendered.container.querySelector('input[aria-label="Enabled on github.com"]') as HTMLInputElement;
            await act(async () => {
                input.click();
            });
            expect(input.checked).toBe(false);
            expect(rereads).toBe(1);
            expect(rendered.container.textContent).toContain("The response was interrupted. Current state was reloaded.");
            expect(rendered.container.textContent).toContain("Disabled on github.com");
        } finally {
            await rendered.unmount();
        }
    });

    it("fails closed with a disabled mixed global switch when site command and reread both fail", async () => {
        const transport: PopupTransport = {
            sendMessage: (message) => {
                if (message && typeof message === "object" && "type" in message && (message.type === SET_SITE_ENABLED_MESSAGE || message.type === GET_POPUP_STATE_MESSAGE)) {
                    return Promise.reject(new Error("transport lost"));
                }
                return Promise.resolve(active);
            }
        };
        const rendered = await renderPopup(active, transport);
        try {
            const siteInput = rendered.container.querySelector('input[aria-label="Enabled on github.com"]') as HTMLInputElement;
            await act(async () => {
                siteInput.click();
            });
            const globalInput = rendered.container.querySelector('input[aria-label="Global enabled"]') as HTMLInputElement;
            expect(globalInput.disabled).toBe(true);
            expect(globalInput.indeterminate).toBe(true);
            expect(globalInput.getAttribute("aria-checked")).toBe("mixed");
            expect(rendered.container.querySelector('input[aria-label="Enabled on github.com"]')).toBeNull();
            expect(rendered.container.textContent).toContain("Could not confirm whether the change was saved");
            expect(rendered.container.textContent).toContain("Current state is unavailable");
        } finally {
            await rendered.unmount();
        }
    });

    it("ignores an actual stale lower-revision site response", async () => {
        const stale: PopupState = { ...active, revision: 1, siteEnabled: false, status: "site-disabled" };
        const transport: PopupTransport = {
            sendMessage: (message) => message && typeof message === "object" && "type" in message && message.type === SET_SITE_ENABLED_MESSAGE
                ? Promise.resolve({ ok: true, acceptedRevision: 1, surface: "popup", state: stale })
                : Promise.resolve(active)
        };
        const rendered = await renderPopup(active, transport);
        try {
            const input = rendered.container.querySelector('input[aria-label="Enabled on github.com"]') as HTMLInputElement;
            await act(async () => {
                input.click();
            });
            expect(input.checked).toBe(true);
            expect(rendered.container.textContent).toContain("Active on github.com");
            expect(rendered.container.textContent).not.toContain("Disabled on github.com");
        } finally {
            await rendered.unmount();
        }
    });

    it("keeps the exact-host control usable while global processing is off", async () => {
        const off: PopupState = { ...active, globalEnabled: false, status: "global-disabled" };
        let write: unknown;
        const transport: PopupTransport = {
            sendMessage: (message) => {
                if (message && typeof message === "object" && "type" in message && message.type === SET_SITE_ENABLED_MESSAGE) {
                    write = message;
                    return Promise.resolve({ ok: true, acceptedRevision: 3, surface: "popup", state: { ...off, revision: 3, siteEnabled: false, status: "global-disabled" } });
                }
                return Promise.resolve(off);
            }
        };
        const rendered = await renderPopup(off, transport);
        try {
            const input = rendered.container.querySelector('input[aria-label="Enabled on github.com"]') as HTMLInputElement;
            expect(input.disabled).toBe(false);
            await act(async () => {
                input.click();
            });
            expect(write).toMatchObject({ type: SET_SITE_ENABLED_MESSAGE, hostname: "github.com", enabled: false, surface: "popup" });
            expect(rendered.container.textContent).toContain("Extension is off");
            expect(input.checked).toBe(false);
        } finally {
            await rendered.unmount();
        }
    });

    it.each([
        [{ ...active, globalEnabled: false, status: "runtime-failed", failure: "registration" }, "Could not process this page"],
        [{ ...active, globalEnabled: false, status: "runtime-failed", failure: "matching-tabs-query" }, "Could not process this page"],
        [{ ...active, globalEnabled: false, status: "runtime-failed", failure: "current-tab-teardown" }, "Could not process this page"],
        [{ ...active, globalEnabled: false, status: "global-disabled" }, "Extension is off"]
    ] as const)("gives relevant current-adapter failures precedence over global-off (%s)", async (state, wording) => {
        const rendered = await renderPopup(state);
        try {
            expect(rendered.container.textContent).toContain(wording);
            expect(rendered.container.querySelector('input[aria-label="Enabled on github.com"]')).not.toBeNull();
        } finally {
            await rendered.unmount();
        }
    });

    it("reads the authoritative post-reset defaults on a fresh popup mount", async () => {
        const resetState: PopupState = { availability: "ready", revision: 0, globalEnabled: true, hostname: "github.com", siteEnabled: true, hasAdapter: true, status: "active" };
        let reads = 0;
        const rendered = await renderPopup(undefined, {
            sendMessage: (message) => {
                if (message && typeof message === "object" && "type" in message && message.type === GET_POPUP_STATE_MESSAGE) {
                    reads += 1;
                    return Promise.resolve(resetState);
                }
                return Promise.reject(new Error("unexpected popup mutation"));
            }
        });
        try {
            expect(reads).toBe(1);
            expect(rendered.container.textContent).toContain("Active on github.com");
            expect(rendered.container.querySelector<HTMLInputElement>('input[aria-label="Global enabled"]')?.checked).toBe(true);
            expect(rendered.container.querySelector("button")?.textContent).toBe("Report this site");
        } finally {
            await rendered.unmount();
        }
    });

    it.each([
        [active, "Dates are not working correctly"],
        [{ ...active, globalEnabled: false, status: "global-disabled" }, "Dates are not working correctly"],
        [{ ...active, siteEnabled: false, status: "site-disabled" }, "Dates are not working correctly"],
        [{ ...active, status: "runtime-failed", failure: "document-status" }, "Dates are not working correctly"],
        [{ ...active, hostname: "example.test", hasAdapter: false, status: "no-rules" }, "Add support for this site"],
        [{ ...active, hostname: "example.test", hasAdapter: false, globalEnabled: false, status: "global-disabled" }, "Add support for this site"]
    ] as const)("opens exactly one site-specific report from eligible %s state", async (state, reason) => {
        if (state.hostname === null) {
            throw new Error("eligible popup hostname missing");
        }
        const currentUrl = `https://${state.hostname}/issues/4?filter=recent#comment`;
        const fixture = createReportingFixture({ url: currentUrl, incognito: false });
        let settingsMessages = 0;
        const rendered = await renderPopup(state, { sendMessage: () => {
            settingsMessages += 1; return Promise.resolve(state);
        } }, fixture.reporter);
        try {
            expect(fixture.queries).toEqual([]);
            expect(fixture.opened).toEqual([]);
            expect(fixture.manifestReads()).toBe(0);
            const button = rendered.container.querySelector("button") as HTMLButtonElement;
            expect(button.textContent).toBe("Report this site");
            await act(async () => {
                button.click();
            });
            expect(fixture.queries).toEqual([{ active: true, currentWindow: true }]);
            expect(fixture.opened).toHaveLength(1);
            expect(fixture.manifestReads()).toBe(1);
            expect(settingsMessages).toBe(0);
            const url = new URL(fixture.opened[0]?.url ?? "");
            expect(`${url.origin}${url.pathname}`).toBe("https://github.com/maximtop/no-more-ago/issues/new");
            expect(Object.fromEntries(url.searchParams)).toEqual({
                template: "site-report.yml",
                reason,
                hostname: state.hostname,
                current_url: currentUrl,
                extension_version: "1.2.3",
                browser: "Chrome"
            });
        } finally {
            await rendered.unmount();
        }
    });

    it.each([
        [{ ...active, hostname: null, siteEnabled: null, hasAdapter: false, status: "inaccessible" }],
        [{ availability: "unavailable", revision: null, globalEnabled: null, hostname: "github.com", siteEnabled: null, hasAdapter: false, status: "runtime-failed", failure: "fail-closed-cleanup" }]
    ] as const)("hides reporting and performs no browser work for unavailable %s context", async (state) => {
        const fixture = createReportingFixture({ url: "https://github.com/example", incognito: false });
        const rendered = await renderPopup(state, { sendMessage: () => Promise.resolve(state) }, fixture.reporter);
        try {
            expect(rendered.container.querySelector("button")).toBeNull();
            expect(fixture.queries).toEqual([]);
            expect(fixture.opened).toEqual([]);
            expect(fixture.manifestReads()).toBe(0);
        } finally {
            await rendered.unmount();
        }
    });

    it.each([
        [undefined, "Could not find the current site"],
        [{ url: "chrome-extension://example/options.html", incognito: false }, "This page cannot be reported"],
        [{ url: "https://other.example/path", incognito: false }, "The current site changed"],
        [{ url: "https://github.com/example", incognito: true }, "this private window"]
    ] as const)("shows an actionable error without navigation for unsafe selected tab %s", async (tab, wording) => {
        const fixture = createReportingFixture(tab);
        const rendered = await renderPopup(active, { sendMessage: () => Promise.resolve(active) }, fixture.reporter);
        try {
            const button = rendered.container.querySelector("button") as HTMLButtonElement;
            await act(async () => {
                button.click();
            });
            expect(fixture.queries).toHaveLength(1);
            expect(fixture.opened).toEqual([]);
            expect(rendered.container.querySelector('[role="alert"]')?.textContent).toContain(wording);
            expect(rendered.container.textContent).toContain("Active on github.com");
        } finally {
            await rendered.unmount();
        }
    });

    it("keeps a private site's selected URL within its existing private window", async () => {
        const fixture = createReportingFixture({ url: "https://github.com/private/repository?view=issue#private", incognito: true, windowId: 17 });
        const rendered = await renderPopup(active, { sendMessage: () => Promise.resolve(active) }, fixture.reporter);
        try {
            await act(async () => {
                rendered.container.querySelector<HTMLButtonElement>("button")?.click();
            });
            expect(fixture.opened).toHaveLength(1);
            expect(fixture.opened[0]?.windowId).toBe(17);
            expect(new URL(fixture.opened[0]?.url ?? "").searchParams.get("current_url")).toBe("https://github.com/private/repository?view=issue#private");
        } finally {
            await rendered.unmount();
        }
    });

    it("suppresses same-turn duplicate clicks while the explicit report is opening", async () => {
        let calls = 0;
        let resolveReport: ((result: SiteReportResult) => void) | undefined;
        const reporter: SiteReportReporter = {
            openPopupReport: () => {
                calls += 1;
                return new Promise((resolve) => {
                    resolveReport = resolve;
                });
            },
            openOptionsReport: () => Promise.resolve({ ok: false, error: "invalid-context" })
        };
        const rendered = await renderPopup(active, { sendMessage: () => Promise.resolve(active) }, reporter);
        try {
            const button = rendered.container.querySelector("button") as HTMLButtonElement;
            await act(async () => {
                button.click(); button.click();
            });
            expect(calls).toBe(1);
            expect(button.disabled).toBe(true);
            await act(async () => {
                resolveReport?.({ ok: true, url: "https://github.com/maximtop/no-more-ago/issues/new" });
            });
            expect(button.disabled).toBe(false);
        } finally {
            await rendered.unmount();
        }
    });

    it("reports a rejected tab opening once without changing popup policy", async () => {
        let attempts = 0;
        const reporter: SiteReportReporter = {
            openPopupReport: () => {
                attempts += 1; return Promise.resolve({ ok: false, error: "open-failed" });
            },
            openOptionsReport: () => Promise.resolve({ ok: false, error: "invalid-context" })
        };
        const rendered = await renderPopup(active, { sendMessage: () => Promise.resolve(active) }, reporter);
        try {
            await act(async () => {
                rendered.container.querySelector<HTMLButtonElement>("button")?.click();
            });
            expect(attempts).toBe(1);
            expect(rendered.container.querySelector('[role="alert"]')?.textContent).toBe("Could not open the GitHub report. Try again.");
            expect(rendered.container.querySelector<HTMLInputElement>('input[aria-label="Global enabled"]')?.checked).toBe(true);
        } finally {
            await rendered.unmount();
        }
    });
});
