/**
 * @file Exercises listing validation and rendering.
 */
import { describe, expect, it } from "vitest";
import { UI_LOCALES } from "../../../src/shared/i18n/locales.ts";
import { readStoreCatalogs } from "../../../scripts/store/catalogs.ts";
import { validateStoreCatalogs } from "../../../scripts/store/validate.ts";
import { renderStoreListing } from "../../../scripts/store/render.ts";
import type { StoreCatalogs, StoreListing } from "../../../scripts/store/contracts.ts";

/**
 * Creates a complete catalog fixture without needing translations.
 *
 * @returns - Independent catalogs for mutation tests.
 */
function fixture(): StoreCatalogs {
    const catalogs = structuredClone(readStoreCatalogs());
    const english = (catalogs.listings.en as StoreListing);
    for (const { code } of UI_LOCALES) {
        catalogs.listings[code] = { ...structuredClone(english), locale: code };
    }
    return catalogs;
}

describe("store listings", () => {
    it("accepts complete drafts", () => {
        expect(validateStoreCatalogs(fixture())).toEqual([]);
    });

    it("reports missing and extra locales", () => {
        const catalogs = fixture();
        delete catalogs.listings.ru;
        catalogs.listings.xx = { ...(catalogs.listings.en as StoreListing), locale: "xx" };
        expect(validateStoreCatalogs(catalogs).join("\n")).toContain("ru: missing");
        expect(validateStoreCatalogs(catalogs).join("\n")).toContain("xx: unexpected");
    });

    it("checks content, protected names, versions and rendered length", () => {
        const catalogs = fixture();
        const russian = (catalogs.listings.ru as StoreListing);
        russian.description.intro = "Changed product name";
        russian.description.controls = "";
        russian.description.privacy = "x".repeat(4100);
        russian.release.version = "9.9.9";
        const errors = validateStoreCatalogs(catalogs).join("\n");
        expect(errors).toContain("ru: description.intro must preserve No More Ago");
        expect(errors).toContain("ru: description.controls is empty");
        expect(errors).toContain("ru: release.version");
        expect(errors).toContain("ru: description exceeds");
    });

    it("rejects links and terms invented in translated prose", () => {
        const catalogs = fixture();
        (catalogs.listings.ru as StoreListing).description.intro += " https://unexpected.example/";
        expect(validateStoreCatalogs(catalogs).join("\n")).toContain("URL");
    });

    it("renders Norwegian for Chrome without changing its source locale", () => {
        const output = renderStoreListing(fixture(), "nb");
        expect(output).toContain("Chrome locale: no");
        expect(output).toContain("Source locale: nb");
        expect(output).toContain("No More Ago");
        expect(output).toContain("Detailed description");
        expect(() => renderStoreListing(fixture(), "xx")).toThrow("Unknown locale");
    });
});

describe("maintained store package", () => {
    it("validates and renders every canonical locale", () => {
        const catalogs = readStoreCatalogs();
        expect(validateStoreCatalogs(catalogs)).toEqual([]);
        for (const { code } of UI_LOCALES) {
            expect(renderStoreListing(catalogs, code)).toContain(`Source locale: ${code}`);
        }
    });
});
