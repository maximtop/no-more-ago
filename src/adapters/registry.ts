/**
 * @file Site-adapter registry used to select a trusted parser for the current page.
 */

import { githubAdapter } from "./github";
import type { SiteAdapter } from "./types";

/**
 * Provides deterministic URL-to-adapter selection; the first matching trusted adapter wins.
 *
 */
export class AdapterRegistry {
    /**
     * Retains the ordered trusted adapters; selection later stops at the first URL match.
     *
     * @param adapters - Trusted adapters in selection priority order.
     */
    constructor(private readonly adapters: readonly SiteAdapter[]) {}

    /**
     * Selects the first adapter whose URL matcher accepts the current page.
     *
     * @param url - Page URL to match against registered adapters.
     * @returns - First matching adapter, or null when none accepts the URL.
     */
    select(url: URL): SiteAdapter | null {
        return this.adapters.find((adapter) => adapter.matches(url)) ?? null;
    }
}

/**
 * Production adapter registry; GitHub is the only site currently granted timestamp extraction trust.
 */
export const defaultRegistry = new AdapterRegistry([githubAdapter]);
