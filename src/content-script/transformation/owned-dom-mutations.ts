/**
 * @file Contracts for acknowledging extension-authored DOM mutations.
 */

/**
 * Receives extension-authored DOM changes before they reach the mutation observer.
 */
export interface OwnedDomMutationSink {
    /**
     * Applies one reconciliation's text-target changes with one final observer rebuild.
     *
     * @param update - Synchronous rendering or restoration work.
     * @returns - Value returned by the supplied work.
     */
    batchTextObservationUpdates?<Result>(update: () => Result): Result;

    /**
     * Records removal of a verified generated output.
     *
     * @param output - Extension-owned time node about to be removed.
     */
    beforeOwnedOutputRemoval(output: HTMLTimeElement): void;

    /**
     * Records an extension-authored hidden-state change.
     *
     * @param source - Source whose hidden state will change.
     * @param hidden - Final hidden state.
     */
    beforeOwnedSourceHiddenChange(source: Element, hidden: boolean): void;

    /**
     * Records an extension-authored text change.
     *
     * @param target - Owned page text about to change.
     * @param text - Final text value.
     */
    beforeOwnedTextChange?(target: Text, text: string): void;

    /**
     * Registers bounded character-data observation for an in-place source.
     *
     * @param source - Source whose owned label must be observed.
     * @param target - Exact page-owned text node whose changes must be retained.
     */
    trackOwnedTextSource?(source: Element, target: Text): void;

    /**
     * Retargets an already observed in-place source.
     *
     * @param source - Source that remains owned across the target replacement.
     * @param previousTarget - Previously retained page-owned text node.
     * @param target - Replacement page-owned text node inside the same source.
     * @returns - Whether the active observation was retargeted.
     */
    replaceOwnedTextSource?(
        source: Element,
        previousTarget: Text,
        target: Text,
    ): boolean;

    /**
     * Releases character-data observation for an in-place source.
     *
     * @param source - Source whose owned label is no longer rendered.
     */
    untrackOwnedTextSource?(source: Element): void;

    /**
     * Releases character-data observation for several in-place sources in one rebuild.
     *
     * @param sources - Sources whose owned labels are no longer rendered.
     */
    untrackOwnedTextSources?(sources: readonly Element[]): void;

    /**
     * Registers bounded character-data observation for a discovered page label.
     *
     * @param source - Candidate source whose current label controls eligibility.
     * @param target - Smallest page node containing only the candidate label.
     */
    trackPageTextSource?(source: Element, target: Node): void;

    /**
     * Releases candidate-label observation for one discovered source.
     *
     * @param source - Source that no longer has an observable presentation candidate.
     */
    untrackPageTextSource?(source: Element): void;

    /**
     * Registers a discovered source for ancestor visibility tracking.
     *
     * @param source - Source discovered by an adapter.
     * @param trackVisibility - Whether ancestor visibility changes can suppress the source.
     */
    trackSource?(source: Element, trackVisibility?: boolean): void;

    /**
     * Releases ancestor visibility tracking for one discovered source.
     *
     * @param source - Source that no longer preserves page suppression.
     */
    untrackSource?(source: Element): void;
}
