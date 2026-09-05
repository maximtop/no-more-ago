/**
 * @file Rebuilds the English Chrome visual package from maintained capture sources.
 */
import path from "node:path";
import { renderStoreArtwork } from "./artwork.ts";
import { readStoreCatalogs, STORE_ROOT } from "./catalogs.ts";

const catalogs = readStoreCatalogs();
const output = path.join(STORE_ROOT, "assets/store/chrome");
const captures = path.join(STORE_ROOT, "assets/store/captures");
renderStoreArtwork(catalogs.listings.en!, captures, output);
console.log(`English Chrome images written to ${output}`);
