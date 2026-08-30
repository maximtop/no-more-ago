/**
 * @file Contracts for route-scoped timestamp extraction and lifecycle handoffs.
 */

/**
 * Controls source tiers for one document route context.
 */
export interface TimestampExtractionPolicy {
    /**
     * Checks whether one rule may extract from an exact discovered source.
     *
     * @param ruleId - Stable source-rule identifier.
     * @param source - Exact discovered source.
     * @returns - Whether extraction is allowed.
     */
    allowsRule(ruleId: string, source: Element): boolean;
}

/**
 * Active route-scoped observer receiving only bounded scheduler roots.
 */
export interface DocumentRouteHandoffSession {
    /**
     * Reconciles route-specific observers against one bounded structure batch.
     *
     * @param input - Added and removed roots from the main document scheduler.
     * @param input.addedRoots - Connected roots added to the document.
     * @param input.removedRoots - Roots removed from the document.
     */
    noteStructure(input: {
        /**
         * Connected roots added to the document.
         */
        readonly addedRoots: readonly Element[];

        /**
         * Roots removed from the document.
         */
        readonly removedRoots: readonly Element[];
    }): void;

    /**
     * Disconnects observation and invalidates queued reconciliation work.
     */
    dispose(): void;
}

/**
 * Immutable extraction policy that can create one active generation session.
 */
export interface DocumentRouteHandoffPolicy extends TimestampExtractionPolicy {
    /**
     * Creates the exact-node observer for one active route generation.
     *
     * @param input - Current document, route, generation, and reconciliation capability.
     * @param input.document - Document owned by the controller.
     * @param input.currentUrl - Cloned current route URL.
     * @param input.generation - Current controller lifecycle generation.
     * @param input.requestReconciliation - Requests one full current-context pass.
     * @returns - Disposable active session.
     */
    activate(input: {
        /**
         * Document owned by the controller.
         */
        readonly document: Document;

        /**
         * Cloned current route URL.
         */
        readonly currentUrl: URL;

        /**
         * Current controller lifecycle generation.
         */
        readonly generation: number;

        /**
         * Requests one full current-context pass.
         */
        readonly requestReconciliation: () => void;
    }): DocumentRouteHandoffSession;
}

/**
 * Complete route-policy transition operations.
 */
export const DOCUMENT_ROUTE_HANDOFF_TRANSITION = {
    NOOP: "noop",
    PRESERVE: "preserve",
    CLEAR: "clear",
    REPLACE: "replace",
} as const;

/**
 * Total operation applied to retained route provenance after a changed URL.
 */
export type DocumentRouteHandoffTransition =
    | {
        /**
         * Updates the retained URL without restarting extraction or route observation.
         */
        readonly kind: typeof DOCUMENT_ROUTE_HANDOFF_TRANSITION.NOOP;
    }
    | {
        /**
         * Keeps the retained optional policy unchanged.
         */
        readonly kind: typeof DOCUMENT_ROUTE_HANDOFF_TRANSITION.PRESERVE;
    }
    | {
        /**
         * Removes the retained optional policy.
         */
        readonly kind: typeof DOCUMENT_ROUTE_HANDOFF_TRANSITION.CLEAR;
    }
    | {
        /**
         * Replaces the retained policy with the supplied successor.
         */
        readonly kind: typeof DOCUMENT_ROUTE_HANDOFF_TRANSITION.REPLACE;

        /**
         * Successor policy installed for the changed route.
         */
        readonly policy: DocumentRouteHandoffPolicy;
    };

/**
 * Classifies one changed route without inspecting page DOM.
 */
export type DocumentRouteHandoffClassifier = (input: {
    /**
     * Cloned route URL before the change.
     */
    readonly previousUrl: URL;

    /**
     * Cloned route URL after the change.
     */
    readonly currentUrl: URL;
}) => DocumentRouteHandoffTransition;

/**
 * Default route classifier for callers that do not retain site-specific provenance.
 *
 * @returns - A transition that clears any retained policy.
 */
export const clearDocumentRouteHandoff: DocumentRouteHandoffClassifier = () => ({
    kind: DOCUMENT_ROUTE_HANDOFF_TRANSITION.CLEAR,
});
