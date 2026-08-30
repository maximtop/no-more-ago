/**
 * @file Optional delayed timestamp capability used only through explicit test injection.
 */

import type { TimestampCandidate } from "../adapters/types";

/**
 * Identifies and resolves one unresolved source without granting browser or network capability.
 */
export interface DeferredTimestampResolver {
    /**
     * Derives an opaque current identity for one unresolved source.
     *
     * @param source - Exact unresolved source.
     * @param url - Cloned current route URL.
     * @returns - Opaque identity, or null when the source is not eligible.
     */
    identify(source: Element, url: URL): string | null;

    /**
     * Resolves one source through the injected capability.
     *
     * @param source - Exact unresolved source.
     * @param url - Cloned route URL captured for the request.
     * @param identity - Opaque identity captured for the request.
     * @returns - Promise of a candidate or terminal no-op.
     */
    resolve(
        source: Element,
        url: URL,
        identity: string,
    ): Promise<TimestampCandidate | null>;
}
