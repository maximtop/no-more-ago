/**
 * @file Contracts for acknowledging extension-authored DOM mutations.
 */

/**
 * Receives extension-authored DOM changes before they reach the mutation observer.
 */
export interface OwnedDomMutationSink {
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
     * @param text - Final exact text.
     */
    beforeOwnedTextChange?(target: Text, text: string): void;

    /**
     * Registers bounded character-data observation for an in-place source.
     *
     * @param source - Source whose owned label must be observed.
     */
    trackOwnedTextSource?(source: Element): void;

    /**
     * Registers a discovered source for ancestor visibility tracking.
     *
     * @param source - Source discovered by an adapter.
     */
    trackSource?(source: Element): void;
}
