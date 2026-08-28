/**
 * @file Source-rule registry for specialized rules and the generic fallback.
 */

import { genericTimeRule } from "./generic-time";
import { githubAdapter } from "./github";
import { hackerNewsAdapter } from "./hacker-news";
import type { TimestampSourceRule } from "./types";

/**
 * Provides deterministic source-rule selection with specialized rules before the generic fallback.
 */
export class AdapterRegistry {
    /**
     * Retains the ordered specialized rules and the final generic fallback.
     *
     * @param specialized - Trusted specialized rules in selection priority order.
     * @param generic - Generic fallback rule evaluated after specialized rules.
     */
    constructor(
        private readonly specialized: readonly TimestampSourceRule[],
        private readonly generic: TimestampSourceRule,
    ) {}

    /**
     * Selects all rules whose URL matcher accepts the current page.
     *
     * @param url - Page URL to match against registered source rules.
     * @returns - Matching specialized rules followed by the generic fallback when applicable.
     */
    matching(url: URL): readonly TimestampSourceRule[] {
        const specialized = this.specialized.filter((rule) => rule.matches(url));
        return this.generic.matches(url) ? [...specialized, this.generic] : specialized;
    }
}

/**
 * Production registry with specialized-source precedence and generic fallback.
 */
export const defaultRegistry = new AdapterRegistry(
    [githubAdapter, hackerNewsAdapter],
    genericTimeRule,
);
