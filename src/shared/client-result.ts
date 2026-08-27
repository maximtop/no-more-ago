/**
 * @file Canonical discriminants for validated client-operation results.
 */

/**
 * Result kinds shared by popup and options clients and their consumers.
 */
export const CLIENT_RESULT_KIND = {
    RESPONSE: "response",
    AMBIGUOUS: "ambiguous",
    ERROR: "error",
} as const;
