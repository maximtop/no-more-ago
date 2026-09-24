/**
 * @file DOM attributes identifying verified extension-owned timestamp pairs.
 */

/**
 * Attribute linking a generated time node to the source it replaced.
 */
export const OWNED_SOURCE_ATTRIBUTE = 'data-no-more-ago-source' as const;

/**
 * Attribute marking nodes created and therefore safe for this extension to remove.
 */
export const OWNED_OUTPUT_ATTRIBUTE = 'data-no-more-ago-output' as const;
