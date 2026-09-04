/**
 * @file Verifies that both surfaces run right to left under an RTL locale.
 */

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
/* eslint-disable @typescript-eslint/require-await */
import { act, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { DirectionProvider, useDirection } from "@mantine/core";
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
        i18n: { getUILanguage: () => uiLanguage, getMessage: () => "" },
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
