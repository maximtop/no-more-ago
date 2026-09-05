/**
 * @file Offline command-line interface for Chrome listing preparation.
 */
import { readStoreCatalogs } from "./catalogs.ts";
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
        console.log(`Validated ${String(Object.keys(catalogs.listings).length)} Chrome listings.`);
    } else if (command === STORE_COMMAND.RENDER && store === STORE_ID && locale) {
        const output = renderStoreListing(catalogs, locale);
        process.stdout.write(output);
    } else {
        throw new Error("Usage: store:validate | store:render chrome <canonical-locale>");
    }
} catch (error) {
    console.error((error as Error).message);
    process.exitCode = 1;
}
