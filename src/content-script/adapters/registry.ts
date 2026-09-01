/**
 * @file Source-rule registry for specialized rules and the generic fallback.
 */

import { genericTimeRule } from "./generic-time";
import { facebookAdapter } from "./facebook";
import { githubAdapter } from "./github";
import { hackerNewsAdapter } from "./hacker-news";
import { instagramAdapter } from "./instagram";
import { linkedinAdapter } from "./linkedin";
import { stackExchangeAdapter } from "./stack-exchange";
import { telegramWebKAdapter } from "./telegram-web-k";
import { tiktokAdapters } from "./tiktok";
import type { TimestampSourceRule } from "./types";
import { youtubeAdapter, youtubePlayerResponseRule } from "./youtube";

/**
 * Provides deterministic source-rule selection with specialized rules before the generic fallback.
 */
export class AdapterRegistry {
    /**
     * Stable ordered rule collection used for document-wide mutation observation.
     */
    private readonly ordered: readonly TimestampSourceRule[];

    /**
     * Retains the ordered specialized rules and the final generic fallback.
     *
     * @param specialized - Trusted specialized rules in selection priority order.
     * @param generic - Generic fallback rule evaluated after specialized rules.
     */
    constructor(
        private readonly specialized: readonly TimestampSourceRule[],
        private readonly generic: TimestampSourceRule,
    ) {
        this.ordered = [...specialized, generic];
    }

    /**
     * Returns every registered rule in deterministic source-precedence order.
     *
     * @returns - Stable specialized rule collection followed by the generic fallback.
     */
    all(): readonly TimestampSourceRule[] {
        return this.ordered;
    }

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

    /**
     * Returns a registry with one document-scoped specialized rule at highest priority.
     *
     * @param rule - Specialized rule to prepend or replace by identifier.
     * @returns - New registry retaining all other rules and the generic fallback.
     */
    withSpecialized(rule: TimestampSourceRule): AdapterRegistry {
        return new AdapterRegistry(
            [rule, ...this.specialized.filter((candidate) => candidate.id !== rule.id)],
            this.generic,
        );
    }
}

/**
 * Production registry with prioritized specialized rules before the generic fallback.
 */
export const defaultRegistry = new AdapterRegistry(
    [
        facebookAdapter,
        githubAdapter,
        hackerNewsAdapter,
        instagramAdapter,
        linkedinAdapter,
        stackExchangeAdapter,
        ...tiktokAdapters,
        telegramWebKAdapter,
        youtubePlayerResponseRule,
        youtubeAdapter,
    ],
    genericTimeRule,
);
