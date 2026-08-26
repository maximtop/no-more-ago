/**
 * @file Canonical validation contract for short printable extension versions.
 */

/**
 * Printable extension-version syntax accepted by reporting and diagnostic boundaries.
 */
export const SAFE_EXTENSION_VERSION_PATTERN = /^[0-9A-Za-z][0-9A-Za-z._+-]{0,31}$/u;
