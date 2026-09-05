/**
 * @file Loads owned listing data and compares independent review revisions.
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { UI_LOCALES } from "../../src/shared/i18n/locales.ts";
import { REVIEW_OUTCOME, REVIEW_STATUS } from "./contracts.ts";
import type { StoreCatalogs, StoreListing, StoreReview } from "./contracts.ts";

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
    const reviews = JSON.parse(readFileSync(
        path.join(root, "assets/store/reviews.json"), "utf8",
    )) as Record<string, StoreReview>;
    return { listings, messages, reviews, version };
}

/**
 * Identifies the exact owned listing content reviewed, including its locale.
 *
 * @param listing - Source content.
 * @returns - SHA-256 revision.
 */
export function listingHash(listing: StoreListing): string {
    return createHash("sha256").update(JSON.stringify(listing)).digest("hex");
}

/**
 * Reports review freshness without treating unfinished review as invalid content.
 *
 * @param listing - Current translation.
 * @param english - Current source.
 * @param review - Optional independent assessment.
 * @returns - Human-readable review state.
 */
export function reviewStatus(
    listing: StoreListing,
    english: StoreListing,
    review?: StoreReview,
): string {
    if (!review) {
        return REVIEW_STATUS.UNREVIEWED;
    }
    if (review.sourceHash !== listingHash(english)
        || review.contentHash !== listingHash(listing)) {
        return REVIEW_STATUS.STALE;
    }
    return review.outcome === REVIEW_OUTCOME.PASSED
        ? REVIEW_STATUS.REVIEWED : REVIEW_STATUS.FINDINGS;
}
