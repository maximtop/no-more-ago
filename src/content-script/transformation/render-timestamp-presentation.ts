/**
 * @file Dispatches validated timestamp presentation and unifies restoration ownership.
 */

import {
    TIMESTAMP_PRESENTATION_KIND,
    type TimestampPresentation,
} from '../adapters/types';

import {
    getOwnedTextSourceEntries,
    renderExactText,
    restoreExactText,
    restoreExactTexts,
} from './render-exact-text';
import {
    getOwnedSourceEntries as getOwnedTimeSourceEntries,
    renderExactTime,
    restoreExactTime,
    restoreExactTimes,
} from './render-exact-time';

import type { OwnedDomMutationSink } from './owned-dom-mutations';

export {
    capturePageOwnedTextChange,
    readPageOwnedText,
} from './render-exact-text';
export { getOwnedSourceForOutput } from './render-exact-time';

/**
 * Successful output from either supported presentation strategy.
 */
export type TimestampRenderResult = | {
    /**
     * Generated-output strategy discriminant.
     */
    readonly kind: typeof TIMESTAMP_PRESENTATION_KIND.ADJACENT_TIME;

    /**
     * Generated extension-owned time element.
     */
    readonly output: HTMLTimeElement;
}
    | {
        /**
         * In-place strategy discriminant.
         */
        readonly kind: typeof TIMESTAMP_PRESENTATION_KIND.IN_PLACE_TEXT;

        /**
         * Existing page-owned text node.
         */
        readonly output: Text;
    };

/**
 * Owned source exposed to targeted presentation refresh.
 */
export interface OwnedTimestampSourceEntry {
    /**
     * Timestamp source retained by a renderer.
     */
    readonly source: Element;

    /**
     * Generated or page-owned presentation node.
     */
    readonly output: HTMLTimeElement | Text;
}

/**
 * Returns owned sources for settings-driven targeted refresh.
 *
 * @param document - Document whose ownership registries are queried.
 *
 * @returns - Connected adjacent and in-place source entries.
 */
export function getOwnedTimestampSourceEntries(
    document: Document,
): readonly OwnedTimestampSourceEntry[] {
    return [...getOwnedTimeSourceEntries(document), ...getOwnedTextSourceEntries(document)];
}

/**
 * Renders one validated timestamp using its adapter-selected strategy.
 *
 * @param source - Trusted timestamp source.
 * @param datetime - Adapter-supplied validated datetime, or null for derived in-place output.
 * @param presentation - Validated presentation descriptor.
 * @param text - Formatted exact label.
 * @param mutations - Optional observer acknowledgement sink.
 *
 * @returns - Discriminated rendered output, or null on an ownership conflict.
 */
export function renderTimestampPresentation(
    source: Element,
    datetime: string | null,
    presentation: TimestampPresentation,
    text: string,
    mutations?: OwnedDomMutationSink,
): TimestampRenderResult | null {
    if (presentation.kind === TIMESTAMP_PRESENTATION_KIND.IN_PLACE_TEXT) {
        restoreExactTime(source, mutations);
        const renderedText = `${presentation.textPrefix ?? ''}${text}${
            presentation.textSuffix ?? ''}`;
        const output = renderExactText(
            source,
            presentation.target,
            renderedText,
            mutations,
        );
        return output ? { kind: presentation.kind, output } : null;
    }
    if (datetime === null) {
        return null;
    }
    restoreExactText(source, mutations);
    const output = renderExactTime(source, datetime, text, mutations);
    return output ? { kind: presentation.kind, output } : null;
}

/**
 * Restores one source regardless of its active presentation strategy.
 *
 * @param source - Owned source to restore.
 * @param mutations - Optional observer acknowledgement sink.
 */
export function restoreTimestampPresentation(
    source: Element,
    mutations?: OwnedDomMutationSink,
): void {
    restoreExactTime(source, mutations);
    restoreExactText(source, mutations);
}

/**
 * Restores all owned presentations within a document or subtree.
 *
 * @param root - Root or batch of roots whose owned sources are restored.
 * @param mutations - Optional observer acknowledgement sink.
 */
export function restoreTimestampPresentations(
    root: ParentNode | readonly ParentNode[],
    mutations?: OwnedDomMutationSink,
): void {
    const roots: readonly ParentNode[] = Array.isArray(root)
        ? root as readonly ParentNode[]
        : [root as ParentNode];
    for (const candidate of roots) {
        restoreExactTimes(candidate, mutations);
    }
    restoreExactTexts(roots, mutations);
}
