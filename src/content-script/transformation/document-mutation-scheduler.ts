/**
 * @file Coalesces DOM mutation records into safe document-processing batches.
 */

import {
    clearSourceHiddenProvenance,
    OWNED_OUTPUT_ATTRIBUTE,
} from "./render-exact-time";
import {
    capturePageOwnedTextChange,
    getOwnedTextSourcesContainingNode,
    hasOwnedTimestampSource,
} from "./render-timestamp-presentation";

/**
 * Attribute names whose page-authored changes can affect generic visibility.
 */
const VISIBILITY_ATTRIBUTES = ["hidden", "aria-hidden", "inert", "style", "class"] as const;

/**
 * Attribute names whose page-authored changes can affect timestamp resolution.
 */
const TIMESTAMP_ATTRIBUTES = ["datetime", "title"] as const;

/**
 * Complete observer attribute filter for timestamp and visibility changes.
 */
const OBSERVED_ATTRIBUTES = [...TIMESTAMP_ATTRIBUTES, ...VISIBILITY_ATTRIBUTES] as const;

/**
 * Coalesced observer changes that can be processed once without revisiting overlapping DOM roots.
 */
export interface AffectedMutationBatch {
    /**
     * Added subtrees that may contain newly eligible timestamp sources.
     */
    readonly addedRoots: readonly Element[];

    /**
     * Existing timestamp sources whose timestamp attribute or owned text changed in place.
     */
    readonly sourceTargets: readonly Element[];

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

    /**
     * Records an observed page-authored text value and returns its source.
     *
     * @param node - Changed text node.
     * @param text - New page-authored value.
     * @returns - Owning source, or null when the node is not owned.
     */
    readonly capturePageOwnedTextChange?: (node: Node, text: string) => Element | null;

    /**
     * Returns owned sources containing a child-list mutation target.
     *
     * @param node - Mutation target node.
     * @returns - Containing owned sources.
     */
    readonly getOwnedTextSourcesContainingNode?: (node: Node) => readonly Element[];

    /**
     * Checks whether a source belongs to either presentation renderer.
     *
     * @param source - Candidate source element.
     * @returns - Whether the source is owned.
     */
    readonly isOwnedSource?: (source: Element) => boolean;
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
     * Expected extension-authored text changes awaiting observer delivery.
     */
    private readonly expectedTextChanges = new Map<
        Text,
        { readonly oldValue: string; readonly text: string }[]
    >();

    /**
     * Sources discovered by the active adapter pass, indexed by relevant ancestors.
     */
    private readonly sourcesByRelevantElement = new Map<Element, Set<Element>>();

    /**
     * Relevant source and ancestor elements retained for deterministic untracking.
     */
    private readonly relevantElementsBySource = new Map<Element, readonly Element[]>();

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
        const pending = this.observer?.takeRecords() ?? [];
        this.captureTextChanges(pending);
        this.observer?.disconnect();
        this.observer = undefined;
        this.phase = "idle";
        this.generation += 1;
        this.suppressedRemovals.clear();
        this.expectedHiddenChanges.clear();
        this.expectedTextChanges.clear();
        this.sourcesByRelevantElement.clear();
        this.relevantElementsBySource.clear();
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
     * Registers bounded character-data observation for one owned in-place source.
     *
     * @param source - Owned source whose label changes must be observed.
     */
    trackOwnedTextSource(source: Element): void {
        if (
            this.phase !== "observing"
            || source.ownerDocument !== this.input.document
            || !source.isConnected
        ) {
            return;
        }
        this.observer?.observe(source, {
            characterData: true,
            characterDataOldValue: true,
            subtree: true,
        });
    }

    /**
     * Records an extension-authored text change before it reaches the observer.
     *
     * @param target - Owned text node about to change.
     * @param text - Final exact value.
     */
    beforeOwnedTextChange(target: Text, text: string): void {
        if (this.phase !== "observing" || target.ownerDocument !== this.input.document) {
            return;
        }
        const changes = this.expectedTextChanges.get(target) ?? [];
        changes.push({ oldValue: target.data, text });
        this.expectedTextChanges.set(target, changes);
    }

    /**
     * Tracks a timestamp source and each ancestor whose visibility can affect it.
     *
     * @param source - Timestamp source discovered by an adapter.
     */
    trackSource(source: Element): void {
        if (source.ownerDocument !== this.input.document) {
            return;
        }
        const relevantElements: Element[] = [];
        let current: Element | null = source;
        while (current) {
            relevantElements.push(current);
            current = current.parentElement;
        }
        const previous = this.relevantElementsBySource.get(source);
        if (
            previous?.length === relevantElements.length
            && previous.every((element, index) => element === relevantElements[index])
        ) {
            return;
        }
        this.untrackSource(source);
        for (const element of relevantElements) {
            const sources = this.sourcesByRelevantElement.get(element) ?? new Set<Element>();
            sources.add(source);
            this.sourcesByRelevantElement.set(element, sources);
        }
        this.relevantElementsBySource.set(source, relevantElements);
    }

    /**
     * Removes one source from every retained visibility index.
     *
     * @param source - Timestamp source no longer tracked at its previous location.
     */
    private untrackSource(source: Element): void {
        const relevantElements = this.relevantElementsBySource.get(source);
        if (!relevantElements) {
            return;
        }
        for (const element of relevantElements) {
            const sources = this.sourcesByRelevantElement.get(element);
            if (!sources) {
                continue;
            }
            sources.delete(source);
            if (sources.size === 0) {
                this.sourcesByRelevantElement.delete(element);
            }
        }
        this.relevantElementsBySource.delete(source);
    }

    /**
     * Returns connected tracked sources affected by a visibility mutation.
     *
     * @param element - Mutated source or ancestor.
     * @returns - Sources whose visibility policy may have changed.
     */
    private getAffectedSources(element: Element): readonly Element[] {
        const sources = this.sourcesByRelevantElement.get(element);
        if (!sources) {
            return [];
        }
        const connected: Element[] = [];
        for (const source of [...sources]) {
            if (
                source.ownerDocument === this.input.document
                && source.isConnected
                && (source === element || element.contains(source))
            ) {
                connected.push(source);
            } else {
                this.untrackSource(source);
            }
        }
        return connected;
    }

    /**
     * Removes visibility indexes for tracked sources inside a detached subtree.
     *
     * @param root - Subtree removed from the observed document.
     */
    private untrackRemovedRoot(root: Element): void {
        const sources = this.sourcesByRelevantElement.get(root);
        if (!sources) {
            return;
        }
        for (const source of [...sources]) {
            if (source === root || root.contains(source)) {
                this.untrackSource(source);
            }
        }
    }

    /**
     * Resolves the value produced by one character-data record.
     *
     * @param records - Complete ordered observer delivery.
     * @param index - Index of the record being interpreted.
     * @param target - Text target changed by the record.
     * @returns - Intermediate or final value produced by that record.
     */
    private getCharacterDataNewValue(
        records: readonly MutationRecord[],
        index: number,
        target: Text,
    ): string {
        for (let nextIndex = index + 1; nextIndex < records.length; nextIndex += 1) {
            const next = records[nextIndex];
            if (next?.type === "characterData" && next.target === target) {
                return next.oldValue ?? target.data;
            }
        }
        return target.data;
    }

    /**
     * Consumes an exact extension-authored old/new text pair.
     *
     * @param target - Changed owned text target.
     * @param oldValue - Value captured before the mutation.
     * @param newValue - Value produced by the mutation.
     * @returns - Whether the record is extension-authored.
     */
    private consumeExpectedTextChange(
        target: Text,
        oldValue: string | null,
        newValue: string,
    ): boolean {
        const changes = this.expectedTextChanges.get(target);
        const expected = changes?.[0];
        if (!changes || !expected || expected.oldValue !== oldValue || expected.text !== newValue) {
            return false;
        }
        changes.shift();
        if (changes.length === 0) {
            this.expectedTextChanges.delete(target);
        }
        return true;
    }

    /**
     * Captures page-authored text baselines from an ordered observer delivery.
     *
     * @param records - Mutation records to inspect.
     * @param sources - Optional batch target collection to update.
     */
    private captureTextChanges(records: readonly MutationRecord[], sources?: Element[]): void {
        const capture = this.input.capturePageOwnedTextChange ?? capturePageOwnedTextChange;
        for (let index = 0; index < records.length; index += 1) {
            const record = records[index];
            if (record?.type !== "characterData" || record.target.nodeType !== 3) {
                continue;
            }
            const target = record.target as Text;
            const newValue = this.getCharacterDataNewValue(records, index, target);
            if (this.consumeExpectedTextChange(target, record.oldValue, newValue)) {
                continue;
            }
            const source = capture(target, newValue);
            if (source && sources) {
                addUnique(sources, source);
            }
        }
    }

    /**
     * Collects affected roots from observer records and schedules one flush.
     *
     * @param records - Mutation records delivered by the observer.
     */
    private handle(records: readonly MutationRecord[]): void {
        const addedRoots: Element[] = [];
        const sourceTargets: Element[] = [];
        const visibilityRoots: Element[] = [];
        const removedRoots: Element[] = [];
        const displacedOutputSources: Element[] = [];

        this.captureTextChanges(records, sourceTargets);
        for (const record of records) {
            if (record.type === "characterData") {
                continue;
            }
            if (record.type === "attributes") {
                if (record.target.nodeType !== 1) {
                    continue;
                }
                const target = record.target as Element;
                if (this.input.getOwnedSourceForOutput(target)) {
                    continue;
                }
                if (
                    record.attributeName
                    && (TIMESTAMP_ATTRIBUTES as readonly string[]).includes(record.attributeName)
                ) {
                    addUnique(sourceTargets, target);
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
                        const changesLocalStyle = record.attributeName === "class"
                            || record.attributeName === "style";
                        let affectedSources: readonly Element[];
                        if (changesLocalStyle) {
                            affectedSources = this.sourcesByRelevantElement.has(target)
                                ? this.getAffectedSources(target)
                                : [];
                        } else {
                            affectedSources = this.getAffectedSources(target);
                        }
                        for (const source of affectedSources) {
                            addUnique(visibilityRoots, source);
                        }
                    }
                }
                continue;
            }

            const containing = this.input.getOwnedTextSourcesContainingNode
                ?? getOwnedTextSourcesContainingNode;
            for (const source of containing(record.target)) {
                addUnique(sourceTargets, source);
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
                    this.untrackRemovedRoot(element);
                }
            }
        }

        const normalizedAdded = collapseRoots(addedRoots);
        const normalizedRemoved = collapseRoots(removedRoots);
        const isOwned = this.input.isOwnedSource ?? hasOwnedTimestampSource;
        const normalizedTargets = sourceTargets.filter(
            (target, index) =>
                !sourceTargets.slice(0, index).includes(target) &&
                (!coveredBy(normalizedAdded, target) || isOwned(target)),
        );
        const uniqueVisibility = visibilityRoots.filter(
            (root, index) =>
                !visibilityRoots.slice(0, index).includes(root) &&
                (!coveredBy(normalizedAdded, root) || isOwned(root)),
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
        this.expectedTextChanges.clear();
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
            sourceTargets: normalizedTargets,
            visibilityRoots: normalizedVisibility,
            removedRoots: normalizedRemoved,
            displacedOutputSources: normalizedDisplaced,
        });
    }
}
