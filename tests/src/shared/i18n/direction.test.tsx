/**
 * @file Verifies that both surfaces run right to left under an RTL locale.
 */

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
/* eslint-disable @typescript-eslint/require-await */
import { act, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { DirectionProvider, useDirection } from "@mantine/core";
import { readFileSync } from "node:fs";
import { APPEARANCE, FORMAT_MODE, TIME_ZONE_MODE } from "../../../../src/shared/settings/snapshot";
import { SITE_SCOPE_MODE } from "../../../../src/shared/settings/site-scope";
import { STATE_AVAILABILITY } from "../../../../src/shared/messaging/view-state-values";
import { installMatchMedia } from "../../../support/dom";

beforeAll(() => {
    (
        globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    installMatchMedia();
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
    document.documentElement.removeAttribute("dir");
    document.documentElement.removeAttribute("lang");
});

/**
 * Stubs the extension i18n API for one browser UI language.
 *
 * @param uiLanguage - Language the stubbed API reports.
 */
function stubLocale(uiLanguage: string): void {
    vi.stubGlobal("chrome", {
        i18n: {
            getUILanguage: () => uiLanguage,
            getMessage: (key: string) => key === "catalog_locale" ? uiLanguage : "",
        },
    });
    vi.resetModules();
}

/**
 * Reports the Mantine direction seen by components inside the provider.
 *
 * @returns - A probe element carrying the context direction.
 */
function DirectionProbe(): ReactElement {
    return <span data-testid="probe" data-dir={useDirection().dir} />;
}

describe("right-to-left surfaces", () => {
    it("feeds the resolved direction into Mantine's direction context", async () => {
        stubLocale("ar");
        const { uiDirection } = await import("../../../../src/shared/i18n/translator");
        const container = document.createElement("div");
        document.body.append(container);
        await act(async () => {
            createRoot(container).render(
                <DirectionProvider initialDirection={uiDirection()} detectDirection={false}>
                    <DirectionProbe />
                </DirectionProvider>,
            );
        });
        expect(container.querySelector("[data-testid='probe']")?.getAttribute("data-dir"))
            .toBe("rtl");
        container.remove();
    });

    it("stamps the document right to left before the popup renders", async () => {
        stubLocale("ar");
        const { applyDocumentLocale } = await import("../../../../src/shared/i18n/translator");
        const { PopupApp } = await import("../../../../src/popup/app");
        applyDocumentLocale("extension_name");
        const container = document.createElement("div");
        document.body.append(container);
        await act(async () => {
            createRoot(container).render(
                <PopupApp subscribe={() => ({ unsubscribe: () => undefined })} />,
            );
        });
        expect(document.documentElement.dir).toBe("rtl");
        expect(document.documentElement.lang).toBe("ar");
        expect(container.querySelector("main")).not.toBeNull();
        container.remove();
    });

    it("isolates technical inputs and the date preview in RTL Settings", async () => {
        stubLocale("ar");
        const { applyDocumentLocale } = await import("../../../../src/shared/i18n/translator");
        const { OptionsApp } = await import("../../../../src/options/app");
        applyDocumentLocale("options_document_title");
        const style = document.createElement("style");
        style.textContent = readFileSync("src/shared/ui/tokens.css", "utf8");
        document.head.append(style);
        const container = document.createElement("div");
        document.body.append(container);
        const root = createRoot(container);
        try {
            await act(async () => {
                root.render(
                    <OptionsApp
                        initialState={{
                            availability: STATE_AVAILABILITY.READY,
                            revision: 1,
                            globalEnabled: true,
                            scopeMode: SITE_SCOPE_MODE.ALL_EXCEPT_EXCLUDED,
                            excludedSites: ["docs.example.com"],
                            allowedSites: [],
                        }}
                        initialDisplayState={{
                            availability: STATE_AVAILABILITY.READY,
                            revision: 1,
                            appearance: APPEARANCE.SYSTEM,
                            debugEnabled: false,
                            display: {
                                formatMode: FORMAT_MODE.CUSTOM,
                                pattern: "yyyy-MM-dd HH:mm",
                                timeZone: { mode: TIME_ZONE_MODE.IANA, identifier: "Europe/Paris" },
                            },
                        }}
                        initialDebugState={{
                            availability: STATE_AVAILABILITY.READY, revision: 1, enabled: false,
                        }}
                        subscribe={() => ({ unsubscribe: () => undefined })}
                    />,
                );
            });
            const hostname = container.querySelector(".options-site-hostname") as HTMLElement;
            expect(hostname.textContent).toBe("docs.example.com");
            expect(getComputedStyle(hostname).direction).toBe("ltr");
            expect(getComputedStyle(hostname).unicodeBidi).toBe("isolate");
            await act(async () => {
                const tab = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
                    .find((button) => button.textContent === "Display");
                expect(tab).toBeDefined();
                tab?.click();
            });
            const inputs = [...container.querySelectorAll<HTMLInputElement>("input")];
            for (const value of ["yyyy-MM-dd HH:mm", "Europe/Paris"]) {
                const input = inputs.find((candidate) => candidate.value === value);
                expect(input).toBeDefined();
                expect(getComputedStyle(input as HTMLInputElement).direction).toBe("ltr");
                expect(getComputedStyle(input as HTMLInputElement).unicodeBidi).toBe("isolate");
            }
            const preview = container.querySelector('.options-preview [role="status"]');
            expect(preview?.textContent).toBe("2026-08-27 21:32");
            expect(getComputedStyle(preview as HTMLElement).direction).toBe("ltr");
            expect(getComputedStyle(preview as HTMLElement).unicodeBidi).toBe("isolate");
        } finally {
            await act(async () => {
                root.unmount();
            });
            container.remove();
            style.remove();
        }
    });

    it("stamps the document left to right for a Latin locale", async () => {
        stubLocale("de");
        const { applyDocumentLocale } = await import("../../../../src/shared/i18n/translator");
        const { OptionsApp } = await import("../../../../src/options/app");
        applyDocumentLocale("options_document_title");
        const container = document.createElement("div");
        document.body.append(container);
        await act(async () => {
            createRoot(container).render(
                <OptionsApp subscribe={() => ({ unsubscribe: () => undefined })} />,
            );
        });
        expect(document.documentElement.dir).toBe("ltr");
        expect(document.documentElement.lang).toBe("de");
        container.remove();
    });
});
