/**
 * @file Loads owned listing data and manifest metadata.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { UI_LOCALES } from "../../src/shared/i18n/locales.ts";
import type { StoreCatalogs, StoreListing } from "./contracts.ts";

/**
 * Repository root resolved independently of the current working directory.
 */
export const STORE_ROOT = path.resolve(import.meta.dirname, "../..");

/**
 * Loads typed repository artifacts; malformed owned JSON fails loudly.
 *
 * @param root - Repository root.
 * @returns - Catalogs and metadata for offline validation/rendering.
 */
export function readStoreCatalogs(root = STORE_ROOT): StoreCatalogs {
    const directory = path.join(root, "assets/store-listings");
    const listings = Object.fromEntries(readdirSync(directory).map((file) => [
        file.endsWith(".json") ? file.slice(0, -5) : file,
        JSON.parse(readFileSync(path.join(directory, file), "utf8")) as StoreListing,
    ]));
    const messages = Object.fromEntries(UI_LOCALES.map(({ code }) => {
        const catalog = JSON.parse(readFileSync(
            path.join(root, "src/_locales", code, "messages.json"), "utf8",
        )) as Record<string, { message: string }>;
        return [code, {
            name: catalog.extension_name!.message,
            summary: catalog.extension_description!.message,
        }];
    }));
    const { version } = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as {
        version: string;
    };
    return { listings, messages, version };
}
