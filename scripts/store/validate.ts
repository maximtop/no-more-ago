/**
 * @file Validates listing content and Chrome field constraints.
 */
import { MANIFEST_NAME_LIMIT, MANIFEST_DESCRIPTION_LIMIT }
    from "../../src/shared/i18n/catalog-limits.ts";
import { UI_LOCALES } from "../../src/shared/i18n/locales.ts";
import {
    DESCRIPTION_KEYS, DESCRIPTION_BUDGET,
    PROTECTED_TERMS, STORE_LINKS,
} from "./contracts.ts";
import type { StoreCatalogs, StoreListing } from "./contracts.ts";
import { detailedDescription } from "./render.ts";

/**
 * Enumerates required translatable fields in their maintained order.
 *
 * @param listing - Owned catalog.
 * @returns - Field paths and values.
 */
function textFields(listing: StoreListing): [string, string][] {
    return [
        ...DESCRIPTION_KEYS.map((key): [string, string] => [
            `description.${key}`, listing.description[key],
        ]),
        ["release.text", listing.release.text],
    ];
}

/**
 * Checks exact keys at one known contract boundary.
 *
 * @param actual - Owned object's keys.
 * @param expected - Required contract keys.
 * @returns - Whether the key sets agree.
 */
function sameKeys(actual: string[], expected: readonly string[]): boolean {
    return actual.length === expected.length && expected.every((key) => actual.includes(key));
}

/**
 * Validates data that the project intentionally maintains as reviewable artifacts.
 *
 * @param catalogs - Loaded listing collection.
 * @returns - All actionable content failures.
 */
export function validateStoreCatalogs(catalogs: StoreCatalogs): string[] {
    const errors: string[] = [];
    const expected: readonly string[] = UI_LOCALES.map(({ code }) => code);
    for (const code of expected) {
        if (!catalogs.listings[code]) {
            errors.push(`${code}: missing listing`);
        }
    }
    for (const code of Object.keys(catalogs.listings)) {
        if (!expected.includes(code)) {
            errors.push(`${code}: unexpected listing`);
        }
    }
    const english = catalogs.listings.en;
    if (!english) {
        return errors;
    }
    const source = new Map(textFields(english));
    for (const [code, listing] of Object.entries(catalogs.listings)) {
        if (listing.locale !== code) {
            errors.push(`${code}: locale must match filename`);
        }
        if (!sameKeys(Object.keys(listing), ["locale", "description", "release"])
            || !sameKeys(Object.keys(listing.description), DESCRIPTION_KEYS)
            || !sameKeys(Object.keys(listing.release), ["version", "text"])) {
            errors.push(`${code}: fields must match the English listing contract`);
        }
        for (const [field, value] of textFields(listing)) {
            if (!value?.trim()) {
                errors.push(`${code}: ${field} is empty or missing`);
                continue;
            }
            const original = source.get(field) ?? "";
            for (const term of PROTECTED_TERMS) {
                if (original.includes(term) && !value.includes(term)) {
                    errors.push(`${code}: ${field} must preserve ${term}`);
                }
            }
            const urls = value.match(/https?:\/\/[^\s]+/gu) ?? [];
            if (urls.some((url) => !original.includes(url))) {
                errors.push(`${code}: ${field} introduces an unexpected URL`);
            }
        }
        if (listing.release.version !== catalogs.version) {
            errors.push(`${code}: release.version must be ${catalogs.version}`);
        }
        if (detailedDescription(listing).length > DESCRIPTION_BUDGET) {
            errors.push(
                `${code}: description exceeds ${String(DESCRIPTION_BUDGET)} editorial budget`,
            );
        }
        const metadata = catalogs.messages[code];
        if (metadata) {
            if (metadata.name !== catalogs.messages.en?.name
                || metadata.name.length > MANIFEST_NAME_LIMIT) {
                errors.push(`${code}: manifest name must preserve No More Ago`);
            }
            if (!metadata.summary.trim() || metadata.summary.length > MANIFEST_DESCRIPTION_LIMIT) {
                errors.push(`${code}: manifest summary exceeds budget or is empty`);
            }
        }
    }
    for (const [key, url] of Object.entries(STORE_LINKS)) {
        if (new URL(url).protocol !== "https:") {
            errors.push(`${key}: shared URL must use HTTPS`);
        }
    }
    return errors;
}
