/**
 * @file Offline command-line interface for Chrome listing preparation.
 */
import { readStoreCatalogs, reviewStatus } from "./catalogs.ts";
import { STORE_COMMAND, STORE_ID } from "./contracts.ts";
import { renderStoreListing } from "./render.ts";
import { validateStoreCatalogs } from "./validate.ts";

const [command, store, locale] = process.argv.slice(2);
try {
    const catalogs = readStoreCatalogs();
    const failures = validateStoreCatalogs(catalogs);
    if (failures.length > 0) {
        throw new Error(failures.join("\n"));
    }
    if (command === STORE_COMMAND.VALIDATE) {
        for (const [code, listing] of Object.entries(catalogs.listings)) {
            console.log(`${code}: ${reviewStatus(listing, catalogs.listings.en!,
                catalogs.reviews[code])}`);
        }
        console.log(`Validated ${String(Object.keys(catalogs.listings).length)} Chrome listings.`);
    } else if (command === STORE_COMMAND.RENDER && store === STORE_ID && locale) {
        const output = renderStoreListing(catalogs, locale);
        console.error(`Review: ${reviewStatus(catalogs.listings[locale]!,
            catalogs.listings.en!, catalogs.reviews[locale])}`);
        process.stdout.write(output);
    } else {
        throw new Error("Usage: store:validate | store:render chrome <canonical-locale>");
    }
} catch (error) {
    console.error((error as Error).message);
    process.exitCode = 1;
}
