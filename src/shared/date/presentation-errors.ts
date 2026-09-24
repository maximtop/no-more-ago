/**
 * @file Canonical error values returned by exact-date presentation.
 */

/**
 * Error reported when a selected display time zone is unavailable.
 */
export const UNAVAILABLE_TIME_ZONE_ERROR = 'unavailable-time-zone' as const;

/**
 * Error reported when a custom date pattern cannot produce valid output.
 */
export const INVALID_DATE_FORMAT_ERROR = 'invalid-format' as const;

/**
 * Presentation error returned by exact-date formatting.
 */
export type DatePresentationError = | typeof UNAVAILABLE_TIME_ZONE_ERROR
    | typeof INVALID_DATE_FORMAT_ERROR;
