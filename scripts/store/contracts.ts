/**
 * @file Repository-owned Chrome listing contracts and publication references.
 */

/**
 * Paragraph order in the rendered listing.
 */
export const DESCRIPTION_KEYS = ["intro", "controls", "compatibility", "privacy"] as const;

/**
 * Screenshot order shared by captions and image generation.
 */
export const CAPTION_KEYS = ["replacement", "control", "appearance"] as const;

/**
 * Chrome is the only supported store in this preparation workflow.
 */
export const STORE_ID = "chrome";

/**
 * Public store preparation command names.
 */
export const STORE_COMMAND = { VALIDATE: "validate", RENDER: "render" } as const;

/**
 * Independent review outcomes stored with evidence.
 */
export const REVIEW_OUTCOME = { PASSED: "passed", FINDINGS: "findings" } as const;

/**
 * Derived states reported by validation and rendering.
 */
export const REVIEW_STATUS = {
    UNREVIEWED: "unreviewed", STALE: "stale", REVIEWED: "reviewed", FINDINGS: "findings",
} as const;

/**
 * Project editorial budget, not a verified Chrome dashboard maximum.
 */
export const DESCRIPTION_BUDGET = 4000;

/**
 * Literal product and service names protected in translation.
 */
export const PROTECTED_TERMS = ["No More Ago", "Bluesky"] as const;

/**
 * Common destinations; privacy becomes public only after its document is published.
 */
export const STORE_LINKS = {
    homepage: "https://github.com/maximtop/no-more-ago",
    support: "https://github.com/maximtop/no-more-ago/issues",
    privacy: "https://github.com/maximtop/no-more-ago/blob/master/docs/PRIVACY.md",
} as const;

/**
 * One English or translated listing, maintained by this repository.
 */
export interface StoreListing {
    /**
     * Canonical UI registry code.
     */
    locale: string;

    /**
     * Ordered product paragraphs.
     */
    description: Record<(typeof DESCRIPTION_KEYS)[number], string>;

    /**
     * Notes for the current release.
     */
    release: {
        /**
         * Package version without a tag prefix.
         */
        version: string;

        /**
         * Translated initial-release summary.
         */
        text: string;
    };

    /**
     * Caption copy, including locales whose images are not generated yet.
     */
    captions: Record<(typeof CAPTION_KEYS)[number], {
        /**
         * Short headline.
         */
        heading: string;

        /**
         * Supporting sentence.
         */
        body: string;
    }>;
}

/**
 * Evidence of an independent semantic review.
 */
export interface StoreReview {
    /**
     * English source revision reviewed.
     */
    sourceHash: string;

    /**
     * Translation revision reviewed.
     */
    contentHash: string;

    /**
     * Reviewer identity or agent task.
     */
    reviewer: string;

    /**
     * ISO calendar date.
     */
    date: string;

    /**
     * Review result; only passed records certify reviewed content.
     */
    outcome: (typeof REVIEW_OUTCOME)[keyof typeof REVIEW_OUTCOME];

    /**
     * Findings and corrections recorded by the reviewer.
     */
    notes: string;
}

/**
 * All owned data needed by offline store preparation.
 */
export interface StoreCatalogs {
    /**
     * Parsed listing files keyed by filename locale.
     */
    listings: Record<string, StoreListing>;

    /**
     * Existing manifest metadata keyed by canonical locale.
     */
    messages: Record<string, {
        /**
         * Manifest product name.
         */
        name: string;

        /**
         * Manifest description.
         */
        summary: string;
    }>;

    /**
     * Review records, which may be absent during editing.
     */
    reviews: Record<string, StoreReview>;

    /**
     * Current package version.
     */
    version: string;
}
