/**
 * @file Renders local listing data into clearly separated Chrome field values.
 */
import { CHROMIUM_LOCALE_ALIAS, UI_LOCALES } from "../../src/shared/i18n/locales.ts";
import { DESCRIPTION_KEYS, STORE_LINKS } from "./contracts.ts";
import type { StoreCatalogs, StoreListing } from "./contracts.ts";

/**
 * Joins paragraphs and versioned notes into the actual dashboard field.
 *
 * @param listing - Selected translation.
 * @returns - Detailed-description text.
 */
export function detailedDescription(listing: StoreListing): string {
    return [
        ...DESCRIPTION_KEYS.map((key) => listing.description[key]),
        `${listing.release.version}\n${listing.release.text}`,
    ].join("\n\n");
}

/**
 * Renders values with explicit field boundaries and manifest provenance.
 *
 * @param catalogs - Owned listing and manifest data.
 * @param locale - Canonical locale requested by the operator.
 * @returns - Paste-ready field sections with an operational header.
 */
export function renderStoreListing(catalogs: StoreCatalogs, locale: string): string {
    if (!UI_LOCALES.some(({ code }) => code === locale)) {
        throw new Error(`Unknown locale: ${locale}`);
    }
    const listing = catalogs.listings[locale];
    const metadata = catalogs.messages[locale];
    if (!listing || !metadata) {
        throw new Error(`Missing listing: ${locale}`);
    }
    const destination = Object.entries(CHROMIUM_LOCALE_ALIAS)
        .find(([, source]) => source === locale)?.[0] ?? locale;
    return [
        `Source locale: ${locale}\nChrome locale: ${destination}`,
        "Copy only the values between field headings. Images: shared English set.",
        `=== Name (from manifest) ===\n${metadata.name}`,
        `=== Summary (from manifest) ===\n${metadata.summary}`,
        `=== Detailed description ===\n${detailedDescription(listing)}`,
        ...Object.entries(STORE_LINKS).map(([key, value]) => `=== ${key} URL ===\n${value}`),
        "Privacy URL is intended; publish docs/PRIVACY.md before using it in a live listing.",
        "",
    ].join("\n\n");
}
