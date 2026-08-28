/**
 * @file Owns and restores exact text within existing page-owned timestamp DOM.
 */

import type { OwnedDomMutationSink } from "./owned-dom-mutations";

/**
 * Document-local reversible state for one in-place presentation.
 */
interface OwnedTextRecord {
    /**
     * Timestamp source selected by an adapter.
     */
    readonly source: Element;

    /**
     * Existing page-owned label node.
     */
    readonly target: Text;

    /**
     * Latest exact page-authored label retained for restoration.
     */
    pageText: string;

    /**
     * Last label written by the extension.
     */
    renderedText: string;
}

/**
 * Owned in-place source exposed to targeted presentation refresh.
 */
export interface OwnedTextSourceEntry {
    /**
     * Timestamp source selected by an adapter.
     */
    readonly source: Element;

    /**
     * Existing page-owned text currently used for presentation.
     */
    readonly output: Text;
}

const recordsByDocument = new WeakMap<Document, Map<Element, OwnedTextRecord>>();

/**
 * Retrieves or creates the ownership registry for one document.
 *
 * @param document - Document whose registry is requested.
 * @returns - Mutable in-place ownership records.
 */
function getRecords(document: Document): Map<Element, OwnedTextRecord> {
    const existing = recordsByDocument.get(document);
    if (existing) {
        return existing;
    }
    const records = new Map<Element, OwnedTextRecord>();
    recordsByDocument.set(document, records);
    return records;
}

/**
 * Finds an ownership record by exact page-owned text identity.
 *
 * @param node - Candidate owned text node.
 * @returns - Matching record, or null when the node is not owned.
 */
function findRecordForTarget(node: Node): OwnedTextRecord | null {
    const document = node.ownerDocument;
    const records = document ? recordsByDocument.get(document) : undefined;
    if (!records) {
        return null;
    }
    for (const record of records.values()) {
        if (record.target === node) {
            return record;
        }
    }
    return null;
}

/**
 * Restores the latest page label unless the page has already replaced it.
 *
 * @param record - In-place ownership record to restore.
 * @param mutations - Optional observer acknowledgement sink.
 */
function restoreRecord(record: OwnedTextRecord, mutations?: OwnedDomMutationSink): void {
    if (record.target.data !== record.renderedText) {
        record.pageText = record.target.data;
        return;
    }
    if (record.target.data !== record.pageText) {
        mutations?.beforeOwnedTextChange?.(record.target, record.pageText);
        record.target.data = record.pageText;
    }
}

/**
 * Checks whether a source currently has an in-place ownership record.
 *
 * @param source - Candidate source element.
 * @returns - Whether the source is owned by this renderer.
 */
export function hasOwnedTextSource(source: Element): boolean {
    return recordsByDocument.get(source.ownerDocument)?.has(source) ?? false;
}

/**
 * Resolves an exact owned text node back to its source.
 *
 * @param node - Candidate text node.
 * @returns - Owning source, or null when the node is not owned.
 */
export function getOwnedSourceForText(node: Node): Element | null {
    return findRecordForTarget(node)?.source ?? null;
}

/**
 * Records one page-authored text value as the next restoration baseline.
 *
 * @param node - Exact owned target reported by the observer.
 * @param text - Page-authored value represented by the mutation record.
 * @returns - Owning source, or null when the node is not owned.
 */
export function capturePageOwnedTextChange(node: Node, text: string): Element | null {
    const record = findRecordForTarget(node);
    if (!record) {
        return null;
    }
    record.pageText = text;
    return record.source;
}

/**
 * Finds owned sources that contain a specific child-list mutation target.
 *
 * @param node - Mutation target to relate to owned sources.
 * @returns - Only sources equal to or containing the supplied node.
 */
export function getOwnedTextSourcesContainingNode(node: Node): readonly Element[] {
    const document = node.ownerDocument;
    const records = document ? recordsByDocument.get(document) : undefined;
    if (!records) {
        return [];
    }
    const sources: Element[] = [];
    for (const record of records.values()) {
        if (record.source === node || record.source.contains(node)) {
            sources.push(record.source);
        }
    }
    return sources;
}

/**
 * Lists connected in-place sources without scanning page DOM.
 *
 * @param document - Document whose records are requested.
 * @returns - Connected source and retained target entries.
 */
export function getOwnedTextSourceEntries(document: Document): readonly OwnedTextSourceEntry[] {
    const records = recordsByDocument.get(document);
    if (!records) {
        return [];
    }
    return Array.from(records.values())
        .filter((record) => record.source.isConnected)
        .map((record) => ({ source: record.source, output: record.target }));
}

/**
 * Writes an exact label into an existing page-owned text node.
 *
 * @param source - Trusted timestamp source.
 * @param target - Existing unambiguous label node.
 * @param text - Formatted exact label.
 * @param mutations - Optional observer acknowledgement sink.
 * @returns - The same text node, or null when ownership is unsafe.
 */
export function renderExactText(
    source: Element,
    target: Text,
    text: string,
    mutations?: OwnedDomMutationSink,
): Text | null {
    if (target.ownerDocument !== source.ownerDocument || !source.contains(target)) {
        return null;
    }
    const records = getRecords(source.ownerDocument);
    const existing = records.get(source);
    if (existing && existing.target !== target) {
        restoreRecord(existing, mutations);
        records.delete(source);
    }
    const retained = records.get(source);
    if (retained) {
        if (target.data !== retained.renderedText) {
            retained.pageText = target.data;
        }
        retained.renderedText = text;
    } else {
        records.set(source, { source, target, pageText: target.data, renderedText: text });
    }
    mutations?.trackOwnedTextSource?.(source);
    if (target.data !== text) {
        mutations?.beforeOwnedTextChange?.(target, text);
        target.data = text;
    }
    return target;
}

/**
 * Restores and releases one in-place source.
 *
 * @param source - Owned source to restore.
 * @param mutations - Optional observer acknowledgement sink.
 */
export function restoreExactText(source: Element, mutations?: OwnedDomMutationSink): void {
    const records = recordsByDocument.get(source.ownerDocument);
    const record = records?.get(source);
    if (!record) {
        return;
    }
    restoreRecord(record, mutations);
    records?.delete(source);
}

/**
 * Restores and releases every in-place source within a root.
 *
 * @param root - Document or subtree whose sources are restored.
 * @param mutations - Optional observer acknowledgement sink.
 */
export function restoreExactTexts(root: ParentNode, mutations?: OwnedDomMutationSink): void {
    const rootNode = root as Node;
    const document = rootNode.nodeType === 9 ? rootNode as Document : rootNode.ownerDocument;
    const records = document ? recordsByDocument.get(document) : undefined;
    if (!records) {
        return;
    }
    for (const [source, record] of records) {
        if (rootNode.nodeType !== 9 && source !== rootNode && !rootNode.contains(source)) {
            continue;
        }
        restoreRecord(record, mutations);
        records.delete(source);
    }
}
