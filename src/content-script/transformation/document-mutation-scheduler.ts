/**
 * @file Coalesces DOM mutation records into safe document-processing batches.
 */

import {
    clearSourceHiddenProvenance,
    OWNED_OUTPUT_ATTRIBUTE,
} from "./render-exact-time";
import { capturePageOwnedTextChange } from "./render-timestamp-presentation";
import {
    TIMESTAMP_MUTATION_KIND,
    type TimestampMutationKind,
} from "../adapters/types";

/**
 * Attribute names whose page-authored changes can affect generic visibility.
 */
const VISIBILITY_ATTRIBUTES = ["hidden", "aria-hidden", "inert", "style", "class"] as const;

/**
 * Coalesced observer changes that can be processed once without revisiting overlapping DOM roots.
 */
export interface AffectedMutationBatch {
    /**
     * Added subtrees that may contain newly eligible timestamp sources.
     */
    readonly addedRoots: readonly Element[];

    /**
     * Existing timestamp sources whose attributes, owned text, or child structure changed.
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
     * Requests a flush even when the current records produce no element targets.
     *
     * This lets callers reconcile document-wide context such as an SPA URL change while
     * retaining a stable observer attribute filter.
     */
    readonly shouldFlush?: () => boolean;

    /**
     * Resolves an extension-owned output node back to its source, if ownership is still valid.
     */
    readonly getOwnedSourceForOutput: (node: Node) => Element | null;

    /**
     * Adapter-declared source attributes observed on the current URL.
     */
    readonly sourceAttributes?: readonly string[];

    /**
     * Whether the document observer must discover newly eligible text-only sources.
     */
    readonly observeCharacterData?: boolean;

    /**
     * Resolves eligible sources affected by one mutation.
     *
     * @param element - Mutated element or child-list container.
     * @param attributeName - Changed source attribute for target-local invalidation, when present.
     * @param oldValue - Attribute value before the mutation, when present.
     * @param trackedSources - Retained source ancestors owning the mutation.
     * @param mutationKind - Kind of DOM mutation being mapped.
     * @param addedNodes - Direct children added by a child-list mutation.
     * @param removedNodes - Direct children removed by a child-list mutation.
     * @returns - Matching target for an attribute or matching ancestors for a child-list change.
     */
    readonly getSourceMutationRoots?: (
        element: Element,
        attributeName: string | undefined,
        oldValue: string | null | undefined,
        trackedSources: readonly Element[],
        mutationKind: TimestampMutationKind,
        addedNodes?: readonly Node[],
        removedNodes?: readonly Node[],
    ) => readonly Element[];

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
}

/**
 * Adds an element once while preserving its first-seen order.
 *
 * @param items - Ordered element collection to update.
 * @param seen - Constant-time membership index for the collection.
 * @param value - Element to append when it is not already present.
 */
function addUnique(items: Element[], seen: Set<Element>, value: Element): void {
    if (!seen.has(value)) {
        seen.add(value);
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
     * Character-data observer retained only while in-place sources are owned.
     */
    private textObserver: MutationObserver | undefined;

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
        {
            readonly documentObserved: boolean;
            readonly oldValue: string;
            readonly text: string;
        }[]
    >();

    /**
     * Active in-place text targets indexed by their adapter-selected sources.
     */
    private readonly textTargetsBySource = new Map<Element, Text>();

    /**
     * Active in-place sources indexed by their exact page-owned text targets.
     */
    private readonly textSourcesByTarget = new Map<Text, Element>();

    /**
     * Expected changes already consumed by the text observer but not the document observer.
     */
    private readonly expectedTextChangesSeenByTextObserver = new Map<
        Text,
        { readonly oldValue: string; readonly text: string }[]
    >();

    /**
     * Expected changes already consumed by the document observer but not the text observer.
     */
    private readonly expectedTextChangesSeenByDocumentObserver = new Map<
        Text,
        { readonly oldValue: string; readonly text: string }[]
    >();

    /**
     * Sources retained for exact invalidation even when they ignore page visibility.
     */
    private readonly trackedSources = new Set<Element>();

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
            const attributeFilter = [
                ...new Set([
                    ...(this.input.sourceAttributes ?? []),
                    ...VISIBILITY_ATTRIBUTES,
                ]),
            ];
            observer.observe(this.input.document, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter,
                attributeOldValue: true,
                ...(this.input.observeCharacterData
                    ? {
                        characterData: true,
                        characterDataOldValue: true,
                    }
                    : {}),
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
        const pendingText = this.textObserver?.takeRecords() ?? [];
        this.captureTextChanges(pendingText);
        this.textObserver?.disconnect();
        this.textObserver = undefined;
        this.observer?.disconnect();
        this.observer = undefined;
        this.phase = "idle";
        this.generation += 1;
        this.suppressedRemovals.clear();
        this.expectedHiddenChanges.clear();
        this.expectedTextChanges.clear();
        this.textTargetsBySource.clear();
        this.textSourcesByTarget.clear();
        this.expectedTextChangesSeenByTextObserver.clear();
        this.expectedTextChangesSeenByDocumentObserver.clear();
        this.trackedSources.clear();
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
     * @param target - Exact page-owned text node retained for restoration.
     */
    trackOwnedTextSource(source: Element, target: Text): void {
        if (
            this.phase !== "observing"
            || source.ownerDocument !== this.input.document
            || target.ownerDocument !== this.input.document
            || !source.contains(target)
            || !source.isConnected
        ) {
            return;
        }
        const current = this.textTargetsBySource.get(source);
        if (current === target) {
            return;
        }
        if (current) {
            this.untrackOwnedTextSource(source);
        }
        this.textTargetsBySource.set(source, target);
        this.textSourcesByTarget.set(target, source);
        const observer = this.textObserver ?? this.createTextObserver();
        observer.observe(source, {
            characterData: true,
            characterDataOldValue: true,
            subtree: true,
        });
    }

    /**
     * Retargets an observed in-place source while retaining its existing subtree observation.
     *
     * @param source - Source that remains owned across the label replacement.
     * @param previousTarget - Previously retained text target.
     * @param target - Replacement text target within the same source.
     * @returns - Whether the source was retargeted without rebuilding observation.
     */
    replaceOwnedTextSource(source: Element, previousTarget: Text, target: Text): boolean {
        if (
            this.phase !== "observing"
            || this.textTargetsBySource.get(source) !== previousTarget
            || target.ownerDocument !== this.input.document
            || !source.contains(target)
            || !source.isConnected
        ) {
            return false;
        }
        this.captureTextChanges(this.textObserver?.takeRecords() ?? []);
        this.textTargetsBySource.set(source, target);
        this.textSourcesByTarget.delete(previousTarget);
        this.textSourcesByTarget.set(target, source);
        this.expectedTextChanges.delete(previousTarget);
        return true;
    }

    /**
     * Releases character-data observation for one in-place source.
     *
     * @param source - Source whose owned text is no longer rendered.
     */
    untrackOwnedTextSource(source: Element): void {
        this.untrackOwnedTextSources([source]);
    }

    /**
     * Releases character-data observation for several in-place sources in one rebuild.
     *
     * @param sources - Sources whose owned labels are no longer rendered.
     */
    untrackOwnedTextSources(sources: readonly Element[]): void {
        const released = sources.filter((source) => this.textTargetsBySource.has(source));
        if (released.length === 0) {
            return;
        }
        const observer = this.textObserver;
        this.captureTextChanges(observer?.takeRecords() ?? []);
        observer?.disconnect();
        for (const source of released) {
            const target = this.textTargetsBySource.get(source);
            this.textTargetsBySource.delete(source);
            if (target) {
                this.textSourcesByTarget.delete(target);
                this.expectedTextChanges.delete(target);
            }
        }
        if (this.textTargetsBySource.size === 0) {
            this.textObserver = undefined;
            return;
        }
        for (const activeSource of this.textTargetsBySource.keys()) {
            observer?.observe(activeSource, {
                characterData: true,
                characterDataOldValue: true,
                subtree: true,
            });
        }
    }

    /**
     * Creates a lifecycle-bound character-data observer on first use.
     *
     * @returns - New active text observer.
     */
    private createTextObserver(): MutationObserver {
        const generation = this.generation;
        const observer = new MutationObserver((records) => {
            if (
                this.phase !== "observing"
                || this.textObserver !== observer
                || this.generation !== generation
            ) {
                return;
            }
            const sourceTargets: Element[] = [];
            this.captureTextChanges(records, sourceTargets);
            if (sourceTargets.length > 0) {
                this.input.onBatch({
                    addedRoots: [],
                    sourceTargets,
                    visibilityRoots: [],
                    removedRoots: [],
                    displacedOutputSources: [],
                });
            }
        });
        this.textObserver = observer;
        return observer;
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
        changes.push({
            documentObserved: this.input.observeCharacterData === true
                && target.isConnected,
            oldValue: target.data,
            text,
        });
        this.expectedTextChanges.set(target, changes);
    }

    /**
     * Tracks a timestamp source and, when needed, ancestors whose visibility can affect it.
     *
     * @param source - Timestamp source discovered by an adapter.
     * @param trackVisibility - Whether ancestor visibility changes can suppress the source.
     */
    trackSource(source: Element, trackVisibility = true): void {
        if (source.ownerDocument !== this.input.document) {
            return;
        }
        this.trackedSources.add(source);
        if (!trackVisibility) {
            this.untrackSourceVisibility(source);
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
        this.untrackSourceVisibility(source);
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
    untrackSource(source: Element): void {
        this.trackedSources.delete(source);
        this.untrackSourceVisibility(source);
    }

    /**
     * Removes one source from retained ancestor visibility indexes.
     *
     * @param source - Timestamp source that no longer preserves page suppression.
     */
    private untrackSourceVisibility(source: Element): void {
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
     * Finds every retained source ancestor without enumerating every active source.
     *
     * @param element - Mutated element or child-list container.
     * @returns - Connected tracked sources from nearest to broadest.
     */
    private findTrackedSources(element: Element): readonly Element[] {
        const sources: Element[] = [];
        let current: Element | null = element;
        while (current && current.ownerDocument === this.input.document) {
            if (this.trackedSources.has(current)) {
                sources.push(current);
            }
            current = current.parentElement;
        }
        return sources;
    }

    /**
     * Removes retained source and visibility indexes inside detached subtrees.
     *
     * @param roots - Subtrees removed from the observed document.
     */
    private untrackRemovedRoots(roots: readonly Element[]): void {
        for (const source of [...this.trackedSources]) {
            if (roots.some((root) => source === root || root.contains(source))) {
                this.untrackSource(source);
            }
        }
    }

    /**
     * Resolves every character-data record's produced value in one reverse pass.
     *
     * @param records - Complete ordered observer delivery.
     * @returns - Produced values indexed by mutation-record identity.
     */
    private getCharacterDataNewValues(
        records: readonly MutationRecord[],
    ): ReadonlyMap<MutationRecord, string> {
        const nextValues = new Map<Text, string>();
        const values = new Map<MutationRecord, string>();
        for (let index = records.length - 1; index >= 0; index -= 1) {
            const record = records[index];
            if (record?.type === "characterData" && record.target.nodeType === 3) {
                const target = record.target as Text;
                values.set(record, nextValues.get(target) ?? target.data);
                nextValues.set(target, record.oldValue ?? target.data);
            }
        }
        return values;
    }

    /**
     * Consumes an exact extension-authored old/new text pair.
     *
     * @param target - Changed owned text target.
     * @param oldValue - Value captured before the mutation.
     * @param newValue - Value produced by the mutation.
     * @param observerKind - Observer whose delivery is being consumed.
     * @returns - Whether the record is extension-authored.
     */
    private consumeExpectedTextChange(
        target: Text,
        oldValue: string | null,
        newValue: string,
        observerKind: "document" | "text",
    ): boolean {
        const counterpartChanges = observerKind === "document"
            ? this.expectedTextChangesSeenByTextObserver
            : this.expectedTextChangesSeenByDocumentObserver;
        const counterpart = counterpartChanges.get(target);
        const duplicate = counterpart?.[0];
        if (
            counterpart
            && duplicate
            && duplicate.oldValue === oldValue
            && duplicate.text === newValue
        ) {
            counterpart.shift();
            if (counterpart.length === 0) {
                counterpartChanges.delete(target);
            }
            return true;
        }
        const changes = this.expectedTextChanges.get(target);
        const expected = changes?.[0];
        if (!changes || !expected || expected.oldValue !== oldValue || expected.text !== newValue) {
            return false;
        }
        changes.shift();
        if (changes.length === 0) {
            this.expectedTextChanges.delete(target);
        }
        if (expected.documentObserved) {
            const observedChanges = observerKind === "document"
                ? this.expectedTextChangesSeenByDocumentObserver
                : this.expectedTextChangesSeenByTextObserver;
            const observed = observedChanges.get(target) ?? [];
            observed.push(expected);
            observedChanges.set(target, observed);
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
        const newValues = this.getCharacterDataNewValues(records);
        const seenSources = sources ? new Set(sources) : undefined;
        for (const record of records) {
            if (record.type !== "characterData" || record.target.nodeType !== 3) {
                continue;
            }
            const target = record.target as Text;
            const newValue = newValues.get(record) ?? target.data;
            if (this.consumeExpectedTextChange(target, record.oldValue, newValue, "text")) {
                continue;
            }
            const source = capture(target, newValue);
            if (source && sources && seenSources) {
                addUnique(sources, seenSources, source);
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
        const addedRootSet = new Set<Element>();
        const sourceTargetSet = new Set<Element>();
        const visibilityRootSet = new Set<Element>();
        const removedRootSet = new Set<Element>();
        const displacedOutputSourceSet = new Set<Element>();
        this.captureTextChanges(this.textObserver?.takeRecords() ?? [], sourceTargets);
        for (const source of sourceTargets) {
            sourceTargetSet.add(source);
        }
        const characterDataNewValues = this.getCharacterDataNewValues(records);

        for (const record of records) {
            if (record.type === "characterData") {
                if (
                    !this.input.observeCharacterData
                    || record.target.nodeType !== Node.TEXT_NODE
                ) {
                    continue;
                }
                const target = record.target as Text;
                const newValue = characterDataNewValues.get(record) ?? target.data;
                if (
                    this.consumeExpectedTextChange(
                        target,
                        record.oldValue,
                        newValue,
                        "document",
                    )
                    || this.textSourcesByTarget.has(target)
                ) {
                    continue;
                }
                const parent = target.parentElement;
                if (!parent) {
                    continue;
                }
                for (const source of this.input.getSourceMutationRoots?.(
                    parent,
                    undefined,
                    record.oldValue,
                    this.findTrackedSources(parent),
                    TIMESTAMP_MUTATION_KIND.CHARACTER_DATA,
                ) ?? []) {
                    addUnique(sourceTargets, sourceTargetSet, source);
                }
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
                const attributeName = record.attributeName;
                const changesSource = attributeName !== null
                    && (this.input.sourceAttributes ?? []).includes(attributeName);
                if (changesSource) {
                    for (const source of this.input.getSourceMutationRoots?.(
                        target,
                        attributeName,
                        record.oldValue,
                        this.findTrackedSources(target),
                        TIMESTAMP_MUTATION_KIND.ATTRIBUTE,
                    ) ?? []) {
                        addUnique(sourceTargets, sourceTargetSet, source);
                    }
                }
                if (
                    attributeName
                    && (VISIBILITY_ATTRIBUTES as readonly string[]).includes(attributeName)
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
                        attributeName === "hidden" &&
                        expectedChange &&
                        expectedChange.oldValue === record.oldValue &&
                        reachedExpectedState
                    ) {
                        expected.shift();
                        if (expected.length === 0) {
                            this.expectedHiddenChanges.delete(target);
                        }
                    } else {
                        if (attributeName === "hidden") {
                            (this.input.clearSourceHiddenProvenance ?? clearSourceHiddenProvenance)(
                                target,
                            );
                        }
                        const changesLocalStyle = attributeName === "class"
                            || attributeName === "style";
                        let affectedSources: readonly Element[];
                        if (changesLocalStyle) {
                            affectedSources = this.sourcesByRelevantElement.has(target)
                                ? this.getAffectedSources(target)
                                : [];
                        } else {
                            affectedSources = this.getAffectedSources(target);
                        }
                        for (const source of affectedSources) {
                            addUnique(visibilityRoots, visibilityRootSet, source);
                        }
                    }
                }
                continue;
            }

            if (this.input.getOwnedSourceForOutput(record.target)) {
                continue;
            }
            if (record.target.nodeType === 1) {
                for (const source of this.input.getSourceMutationRoots?.(
                    record.target as Element,
                    undefined,
                    null,
                    this.findTrackedSources(record.target as Element),
                    TIMESTAMP_MUTATION_KIND.CHILD_LIST,
                    Array.from(record.addedNodes),
                    Array.from(record.removedNodes),
                ) ?? []) {
                    addUnique(sourceTargets, sourceTargetSet, source);
                }
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
                        addUnique(
                            displacedOutputSources,
                            displacedOutputSourceSet,
                            source,
                        );
                    }
                } else {
                    addUnique(addedRoots, addedRootSet, element);
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
                        addUnique(
                            displacedOutputSources,
                            displacedOutputSourceSet,
                            source,
                        );
                    }
                } else {
                    addUnique(removedRoots, removedRootSet, element);
                }
            }
        }

        const normalizedAdded = collapseRoots(addedRoots);
        const normalizedRemoved = collapseRoots(removedRoots);
        this.untrackRemovedRoots(normalizedRemoved);
        const normalizedTargets = sourceTargets.filter(
            (target) => !coveredBy(normalizedAdded, target),
        );
        const uniqueVisibility = visibilityRoots.filter(
            (root) => !coveredBy(normalizedAdded, root),
        );
        const normalizedVisibility = collapseRoots(uniqueVisibility);
        const normalizedDisplaced = displacedOutputSources.filter(
            (source) =>
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
            normalizedDisplaced.length === 0 &&
            !this.input.shouldFlush?.()
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
