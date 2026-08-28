/**
 * @file Coalesces DOM mutation records into safe document-processing batches.
 */

import {
    clearSourceHiddenProvenance,
    OWNED_OUTPUT_ATTRIBUTE,
} from "./render-exact-time";

/**
 * Attribute names whose page-authored changes can affect generic visibility.
 */
const VISIBILITY_ATTRIBUTES = ["hidden", "aria-hidden", "inert", "style"] as const;

/**
 * Complete observer attribute filter for timestamp and visibility changes.
 */
const OBSERVED_ATTRIBUTES = ["datetime", ...VISIBILITY_ATTRIBUTES] as const;

/**
 * Coalesced observer changes that can be processed once without revisiting overlapping DOM roots.
 */
export interface AffectedMutationBatch {
    /**
     * Added subtrees that may contain newly eligible timestamp sources.
     */
    readonly addedRoots: readonly Element[];

    /**
     * Existing time elements whose datetime attribute changed in place.
     */
    readonly datetimeTargets: readonly Element[];

    /**
     * Source or ancestor roots whose visibility policy may have changed.
     */
    readonly visibilityRoots: readonly Element[];

    /**
     * Removed subtrees that may contain extension-owned output requiring restoration.
     */
    readonly removedRoots: readonly Element[];

    /**
     * Sources whose generated output moved or was removed by page code.
     */
    readonly displacedOutputSources: readonly Element[];
}

/**
 * Callbacks and ownership lookup used to turn browser mutation records into safe document work.
 */
interface SchedulerInput {
    /**
     * Owning document used to scope DOM ownership metadata.
     */
    readonly document: Document;

    /**
     * Processes one coalesced mutation batch after the scheduler flushes.
     */
    readonly onBatch: (batch: AffectedMutationBatch) => void;

    /**
     * Resolves an extension-owned output node back to its source, if ownership is still valid.
     */
    readonly getOwnedSourceForOutput: (node: Node) => Element | null;

    /**
     * Clears renderer hidden ownership when a page-authored mutation is observed.
     */
    readonly clearSourceHiddenProvenance?: (source: Element) => void;
}

/**
 * Adds an element once while preserving its first-seen order.
 *
 * @param items - Ordered element collection to update.
 * @param value - Element to append when it is not already present.
 */
function addUnique(items: Element[], value: Element): void {
    if (!items.includes(value)) {
        items.push(value);
    }
}

/**
 * Collapses overlapping mutation roots to avoid processing descendants twice.
 *
 * @param roots - Candidate mutation roots in discovery order.
 * @returns - Minimal ordered roots with covered descendants removed.
 */
function collapseRoots(roots: readonly Element[]): Element[] {
    return roots.filter(
        (root, index) =>
            !roots.some((other, otherIndex) => otherIndex !== index && other.contains(root)),
    );
}

/**
 * Avoids redundant work when an element already lies inside a scheduled mutation root.
 *
 * @param roots - Mutation roots already scheduled for processing.
 * @param element - Candidate element to test for coverage.
 * @returns - Whether an existing root already contains the element.
 */
function coveredBy(roots: readonly Element[], element: Element): boolean {
    return roots.some((root) => root.contains(element));
}

/**
 * Batches observer records into minimal roots so dynamic pages are reprocessed once per change set.
 *
 */
export class DocumentMutationScheduler {
    /**
     * Prevents duplicate observer setup and makes callbacks from a stopped scheduler inert.
     */
    private phase: "idle" | "observing" = "idle";

    /**
     * Active browser observer, retained only while the scheduler owns the document lifecycle.
     */
    private observer: MutationObserver | undefined;

    /**
     * Monotonic lifecycle token that invalidates callbacks queued before a stop or restart.
     */
    private generation = 0;

    /**
     * Maps page-removed output nodes to their generation so restoration is not reported twice.
     */
    private readonly suppressedRemovals = new Map<Node, number>();

    /**
     * Expected renderer-authored hidden changes awaiting their observer delivery.
     */
    private readonly expectedHiddenChanges = new Map<
        Element,
        { readonly hidden: boolean; readonly oldValue: string | null }[]
    >();

    /**
     * Initializes mutation bookkeeping without observing the document until start() is called.
     *
     * @param input - Document, observer, callbacks, and scheduling dependencies.
     */
    constructor(private readonly input: SchedulerInput) {}

    /**
     * Starts observing the document and batches later mutation records.
     */
    start(): void {
        if (this.phase === "observing") {
            return;
        }
        const generation = ++this.generation;
        const observer = new MutationObserver((records) => {
            if (
                this.phase !== "observing" ||
                this.observer !== observer ||
                this.generation !== generation
            ) {
                return;
            }
            this.handle(records);
        });
        try {
            observer.observe(this.input.document, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: [...OBSERVED_ATTRIBUTES],
                attributeOldValue: true,
            });
        } catch (error) {
            observer.disconnect();
            throw error;
        }
        this.observer = observer;
        this.phase = "observing";
    }

    /**
     * Disconnects the observer and drops any pending mutation batch.
     */
    stop(): void {
        this.observer?.disconnect();
        this.observer = undefined;
        this.phase = "idle";
        this.generation += 1;
        this.suppressedRemovals.clear();
        this.expectedHiddenChanges.clear();
    }

    /**
     * Records source restoration work before an extension-owned output is removed.
     *
     * @param output - Extension-owned output about to be removed.
     */
    beforeOwnedOutputRemoval(output: HTMLTimeElement): void {
        if (
            this.phase === "observing" &&
            output.ownerDocument === this.input.document &&
            output.isConnected &&
            output.hasAttribute(OWNED_OUTPUT_ATTRIBUTE)
        ) {
            this.suppressedRemovals.set(output, this.generation);
        }
    }

    /**
     * Records an expected renderer-authored hidden mutation before it reaches the observer.
     *
     * @param source - Source element whose hidden state will change.
     * @param hidden - Final hidden state authored by the renderer.
     */
    beforeOwnedSourceHiddenChange(source: Element, hidden: boolean): void {
        if (source.ownerDocument !== this.input.document || !source.isConnected) {
            return;
        }
        const changes = this.expectedHiddenChanges.get(source) ?? [];
        changes.push({
            hidden,
            oldValue: source.getAttribute("hidden"),
        });
        this.expectedHiddenChanges.set(source, changes);
    }

    /**
     * Collects affected roots from observer records and schedules one flush.
     *
     * @param records - Mutation records delivered by the observer.
     */
    private handle(records: readonly MutationRecord[]): void {
        const addedRoots: Element[] = [];
        const datetimeTargets: Element[] = [];
        const visibilityRoots: Element[] = [];
        const removedRoots: Element[] = [];
        const displacedOutputSources: Element[] = [];

        for (const record of records) {
            if (record.type === "attributes") {
                if (record.target.nodeType !== 1) {
                    continue;
                }
                const target = record.target as Element;
                if (this.input.getOwnedSourceForOutput(target)) {
                    continue;
                }
                if (record.attributeName === "datetime") {
                    addUnique(datetimeTargets, target);
                } else if (
                    record.attributeName &&
                    (VISIBILITY_ATTRIBUTES as readonly string[]).includes(record.attributeName)
                ) {
                    const expected = this.expectedHiddenChanges.get(target);
                    const expectedChange = expected?.[0];
                    const followingChange = expected?.[1];
                    const reachedExpectedState = expectedChange
                        ? followingChange
                            ? (followingChange.oldValue !== null) === expectedChange.hidden
                            : target.hasAttribute("hidden") === expectedChange.hidden
                        : false;
                    if (
                        record.attributeName === "hidden" &&
                        expectedChange &&
                        expectedChange.oldValue === record.oldValue &&
                        reachedExpectedState
                    ) {
                        expected.shift();
                        if (expected.length === 0) {
                            this.expectedHiddenChanges.delete(target);
                        }
                    } else {
                        if (record.attributeName === "hidden") {
                            (this.input.clearSourceHiddenProvenance ?? clearSourceHiddenProvenance)(
                                target,
                            );
                        }
                        addUnique(visibilityRoots, target);
                    }
                }
                continue;
            }

            if (this.input.getOwnedSourceForOutput(record.target)) {
                continue;
            }

            for (const node of record.addedNodes) {
                if (node.nodeType !== 1) {
                    continue;
                }
                const element = node as Element;
                const source = this.input.getOwnedSourceForOutput(element);
                if (source) {
                    if (
                        source.parentNode !== element.parentNode ||
                        source.nextElementSibling !== element
                    ) {
                        addUnique(displacedOutputSources, source);
                    }
                } else {
                    addUnique(addedRoots, element);
                }
            }

            for (const node of record.removedNodes) {
                if (node.nodeType !== 1) {
                    continue;
                }
                const element = node as Element;
                const suppressedGeneration = this.suppressedRemovals.get(element);
                if (suppressedGeneration === this.generation) {
                    this.suppressedRemovals.delete(element);
                    continue;
                }
                const source = this.input.getOwnedSourceForOutput(element);
                if (source) {
                    if (
                        source.parentNode !== element.parentNode ||
                        source.nextElementSibling !== element
                    ) {
                        addUnique(displacedOutputSources, source);
                    }
                } else {
                    addUnique(removedRoots, element);
                }
            }
        }

        const normalizedAdded = collapseRoots(addedRoots);
        const normalizedRemoved = collapseRoots(removedRoots);
        const normalizedTargets = datetimeTargets.filter(
            (target, index) =>
                !datetimeTargets.slice(0, index).includes(target) &&
                !coveredBy(normalizedAdded, target),
        );
        const uniqueVisibility = visibilityRoots.filter(
            (root, index) =>
                !visibilityRoots.slice(0, index).includes(root) &&
                !coveredBy(normalizedAdded, root),
        );
        const normalizedVisibility = collapseRoots(uniqueVisibility);
        const normalizedDisplaced = displacedOutputSources.filter(
            (source, index) =>
                !displacedOutputSources.slice(0, index).includes(source) &&
                !coveredBy(normalizedAdded, source) &&
                !normalizedTargets.includes(source),
        );

        this.suppressedRemovals.clear();
        this.expectedHiddenChanges.clear();
        if (
            normalizedAdded.length === 0 &&
            normalizedTargets.length === 0 &&
            normalizedVisibility.length === 0 &&
            normalizedRemoved.length === 0 &&
            normalizedDisplaced.length === 0
        ) {
            return;
        }
        this.input.onBatch({
            addedRoots: normalizedAdded,
            datetimeTargets: normalizedTargets,
            visibilityRoots: normalizedVisibility,
            removedRoots: normalizedRemoved,
            displacedOutputSources: normalizedDisplaced,
        });
    }
}
