/**
 * @file Validates every shipped message catalog against the English source.
 */

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { validator } from "@adguard/translate";
import { BASE_UI_LOCALE, CHROMIUM_LOCALE_ALIAS, UI_LOCALES } from "../src/shared/i18n/locales.ts";
import { MANIFEST_DESCRIPTION_LIMIT } from "../src/shared/i18n/catalog-limits.ts";

/**
 * One entry as stored in a WebExtension message catalog.
 */
interface CatalogEntry {
    /**
     * Translated text, with `%name%` placeholders and `|` plural forms.
     */
    readonly message: string;

    /**
     * English translator note, identical in every catalog.
     */
    readonly description: string;
}

const EXPECTED_LOCALE_COUNT = 40;
const LOCALES_ROOT = path.join(import.meta.dirname, "../src/_locales");

const failures: string[] = [];

/**
 * Reads one catalog. The file is a repository artifact, so it is parsed and
 * cast rather than shape-checked; a malformed catalog fails loudly here.
 *
 * @param code - Locale directory code.
 * @returns - Parsed catalog keyed by message name.
 */
function readCatalog(code: string): Record<string, CatalogEntry> {
    const file = path.join(LOCALES_ROOT, code, "messages.json");
    return JSON.parse(readFileSync(file, "utf8")) as Record<string, CatalogEntry>;
}

const codes: readonly string[] = UI_LOCALES.map(({ code }) => code);
if (codes.length !== EXPECTED_LOCALE_COUNT || new Set(codes).size !== EXPECTED_LOCALE_COUNT) {
    failures.push(
        `The registry must hold exactly ${String(EXPECTED_LOCALE_COUNT)} unique locales.`,
    );
}
for (const [alias, source] of Object.entries(CHROMIUM_LOCALE_ALIAS)) {
    if (codes.includes(alias)) {
        failures.push(`Alias ${alias} collides with a registry locale.`);
    }
    if (!codes.includes(source)) {
        failures.push(`Alias ${alias} names the unknown source locale ${source}.`);
    }
}

const directories = readdirSync(LOCALES_ROOT).sort();
const expected = [...codes].sort();
if (JSON.stringify(directories) !== JSON.stringify(expected)) {
    failures.push(
        `Catalog directories [${directories.join(", ")}] must match the registry `
        + `[${expected.join(", ")}].`,
    );
}

const base = readCatalog(BASE_UI_LOCALE);
const baseKeys = Object.keys(base).sort();
const baseName = (base.extension_name as CatalogEntry | undefined)?.message;

for (const entry of UI_LOCALES) {
    if (!directories.includes(entry.code)) {
        continue;
    }
    const catalog = readCatalog(entry.code);
    const keys = Object.keys(catalog).sort();
    if (catalog.catalog_locale?.message !== entry.code.replaceAll("_", "-")) {
        failures.push(`${entry.code}: catalog_locale must identify its own catalog.`);
    }
    for (const key of baseKeys.filter((candidate) => !keys.includes(candidate))) {
        failures.push(`${entry.code}: missing key ${key}.`);
    }
    for (const key of keys.filter((candidate) => !baseKeys.includes(candidate))) {
        failures.push(`${entry.code}: extra key ${key}.`);
    }
    for (const key of baseKeys.filter((candidate) => keys.includes(candidate))) {
        const baseEntry = base[key] as CatalogEntry;
        const translated = catalog[key] as CatalogEntry;
        if (translated.description !== baseEntry.description) {
            failures.push(`${entry.code}: ${key} description must stay the English note.`);
        }
        try {
            if (!validator.isTranslationValid(
                baseEntry.message,
                translated.message,
                entry.adguardCode,
            )) {
                failures.push(`${entry.code}: ${key} does not preserve placeholders or tags.`);
            }
        } catch (error) {
            // isTranslationValid throws for a wrong plural form count and for
            // unbalanced tags, so the locale and key are attached here.
            failures.push(`${entry.code}: ${key} — ${(error as Error).message}.`);
        }
    }
    const description = (catalog.extension_description as CatalogEntry | undefined)?.message;
    if (description !== undefined && description.length > MANIFEST_DESCRIPTION_LIMIT) {
        failures.push(
            `${entry.code}: extension_description is ${String(description.length)} characters; `
            + `the manifest limit is ${String(MANIFEST_DESCRIPTION_LIMIT)}.`,
        );
    }
    const name = (catalog.extension_name as CatalogEntry | undefined)?.message;
    if (name !== undefined && name !== baseName) {
        failures.push(
            `${entry.code}: extension_name is a brand literal and must not be translated.`,
        );
    }
}

if (failures.length > 0) {
    for (const failure of failures) {
        console.error(failure);
    }
    process.exitCode = 1;
} else {
    console.log(`Validated ${String(codes.length)} catalogs against ${BASE_UI_LOCALE}.`);
}
