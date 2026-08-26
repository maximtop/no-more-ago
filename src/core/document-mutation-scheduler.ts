/**
 * @file Coalesces DOM mutation records into safe document-processing batches.
 */

import { OWNED_OUTPUT_ATTRIBUTE } from "./render-exact-time";

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
}

/**
 * Adds an element once while preserving its first-seen order.
 */
function addUnique(items: Element[], value: Element): void {
    if (!items.includes(value)) {
        items.push(value);
    }
}

/**
 * Collapses overlapping mutation roots to avoid processing descendants twice.
 */
function collapseRoots(roots: readonly Element[]): Element[] {
    return roots.filter((root, index) =>
        !roots.some((other, otherIndex) => otherIndex !== index && other.contains(root))
    );
}

/**
 * Avoids redundant work when an element already lies inside a scheduled mutation root.
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
     * Initializes mutation bookkeeping without observing the document until start() is called.
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
                attributeFilter: ["datetime"]
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
    }

    /**
     * Records source restoration work before an extension-owned output is removed.
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
     * Collects affected roots from observer records and schedules one flush.
     */
    private handle(records: readonly MutationRecord[]): void {
        const addedRoots: Element[] = [];
        const datetimeTargets: Element[] = [];
        const removedRoots: Element[] = [];
        const displacedOutputSources: Element[] = [];

        for (const record of records) {
            if (record.type === "attributes") {
                if (record.target.nodeType === 1 && !this.input.getOwnedSourceForOutput(record.target)) {
                    addUnique(datetimeTargets, record.target as Element);
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
                    if (source.parentNode !== element.parentNode || source.nextElementSibling !== element) {
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
                    if (source.parentNode !== element.parentNode || source.nextElementSibling !== element) {
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
            (target, index) => !datetimeTargets.slice(0, index).includes(target) && !coveredBy(normalizedAdded, target)
        );
        const normalizedDisplaced = displacedOutputSources.filter(
            (source, index) =>
                !displacedOutputSources.slice(0, index).includes(source) &&
        !coveredBy(normalizedAdded, source) &&
        !normalizedTargets.includes(source)
        );

        this.suppressedRemovals.clear();
        if (
            normalizedAdded.length === 0 &&
      normalizedTargets.length === 0 &&
      normalizedRemoved.length === 0 &&
      normalizedDisplaced.length === 0
        ) {
            return;
        }
        this.input.onBatch({
            addedRoots: normalizedAdded,
            datetimeTargets: normalizedTargets,
            removedRoots: normalizedRemoved,
            displacedOutputSources: normalizedDisplaced
        });
    }
}
