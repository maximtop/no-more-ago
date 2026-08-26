/**
 * @file Renders exact timestamps and records reversible ownership metadata on DOM nodes.
 */

/**
 * Attribute linking a generated time node to the source it replaced.
 */
export const OWNED_SOURCE_ATTRIBUTE = "data-no-more-ago-source";

/**
 * Attribute marking nodes created and therefore safe to remove by this extension.
 */
export const OWNED_OUTPUT_ATTRIBUTE = "data-no-more-ago-output";

/**
 * Private ownership record pairing one source element with its generated time node and marker token.
 */
interface OwnedPairRecord {

    /**
     * DOM element whose timestamp is being transformed.
     */
    readonly source: Element;

    /**
     * Extension-owned time element rendered beside the source.
     */
    readonly output: HTMLTimeElement;

    /**
     * Opaque marker tying a source and generated output together.
     */
    readonly token: string;

    /**
     * Whether rendering hid the original source element.
     */
    readonly sourceWasHidden: boolean;
}

/**
 * Connected source/output pair exposed to targeted reconciliation without scanning the document.
 */
export interface OwnedSourceEntry {

    /**
     * DOM element whose timestamp is being transformed.
     */
    readonly source: Element;

    /**
     * Extension-owned time element rendered beside the source.
     */
    readonly output: HTMLTimeElement;
}

/**
 * Records source state needed to restore a page when extension-owned output is removed.
 */
export interface OwnedOutputMutationSink {
    /**
     * Captures restoration data immediately before an owned output node is removed.
     */
    beforeOwnedOutputRemoval(output: HTMLTimeElement): void;
}

const recordsByDocument = new WeakMap<Document, Map<Element, OwnedPairRecord>>();
const SOURCE_MARKER = /^(visible|hidden):(.+)$/;

/**
 * Decodes a source marker only when it carries the extension's expected ownership prefix and token.
 *
 * @param value - Candidate ownership marker value.
 * @returns - Decoded ownership token, or null when the marker is foreign or malformed.
 */
function parseSourceMarker(value: string | null): { state: "visible" | "hidden"; token: string } | null {
    const match = value?.match(SOURCE_MARKER);
    if (!match) {
        return null;
    }
    const state = match[1];
    const token = match[2];
    if ((state !== "visible" && state !== "hidden") || !token) {
        return null;
    }
    return { state, token };
}

/**
 * Retrieves the ownership records associated with a document.
 *
 * @param document - Document whose ownership registry is requested.
 * @returns - Mutable ownership records retained for the document.
 */
function getRecords(document: Document): Map<Element, OwnedPairRecord> {
    const existing = recordsByDocument.get(document);
    if (existing) {
        return existing;
    }
    const records = new Map<Element, OwnedPairRecord>();
    recordsByDocument.set(document, records);
    return records;
}

/**
 * Generates an opaque token that prevents unrelated page nodes from claiming extension ownership.
 *
 * @param document - Document whose crypto source generates the token.
 * @returns - New opaque ownership token.
 */
function createToken(document: Document): string | null {
    const crypto = document.defaultView?.crypto;
    if (!crypto || typeof crypto.randomUUID !== "function") {
        return null;
    }
    return crypto.randomUUID();
}

/**
 * Builds the marker that lets restoration verify an unchanged source element.
 *
 * @param record - Ownership record for the source-output pair.
 * @returns - Exact marker expected on the source element.
 */
function expectedSourceMarker(record: OwnedPairRecord): string {
    return `${record.sourceWasHidden ? "hidden" : "visible"}:${record.token}`;
}

/**
 * Builds the marker that lets restoration verify an extension-owned output node.
 *
 * @param record - Ownership record for the source-output pair.
 * @returns - Exact marker expected on the generated output.
 */
function expectedOutputMarker(record: OwnedPairRecord): string {
    return record.token;
}

/**
 * Updates a generated time element while retaining the source-to-output link.
 *
 * @param output - Verified extension-owned time element to update.
 * @param datetime - Trusted source datetime preserved on the output.
 * @param text - Newly formatted exact date text.
 */
function updateOutput(output: HTMLTimeElement, datetime: string, text: string): void {
    output.dateTime = datetime;
    output.textContent = text;
}

/**
 * Resolves a generated output node back to its source only after marker verification succeeds.
 *
 * @param node - Candidate generated output node.
 * @returns - Verified connected source element, or null when ownership fails.
 */
export function getOwnedSourceForOutput(node: Node): Element | null {
    const document = node.ownerDocument;
    if (!document) {
        return null;
    }
    const records = recordsByDocument.get(document);
    if (!records) {
        return null;
    }
    for (const record of records.values()) {
        if (
            record.output === node &&
      record.output.getAttribute(OWNED_OUTPUT_ATTRIBUTE) === expectedOutputMarker(record)
        ) {
            return record.source;
        }
    }
    return null;
}

/**
 * Returns only connected, marker-verified sources already owned by this
 * document. It never scans the DOM and never discovers new candidates.
 *
 * @param document - Document whose owned sources are requested.
 * @returns - Connected and marker-verified source entries.
 */
export function getOwnedSourceEntries(document: Document): readonly OwnedSourceEntry[] {
    const records = recordsByDocument.get(document);
    if (!records) {
        return [];
    }
    const entries: OwnedSourceEntry[] = [];
    for (const record of records.values()) {
        if (!record.source.isConnected || !record.output.isConnected) {
            continue;
        }
        if (parseSourceMarker(record.source.getAttribute(OWNED_SOURCE_ATTRIBUTE)) === null) {
            continue;
        }
        if (record.output.getAttribute(OWNED_OUTPUT_ATTRIBUTE) !== expectedOutputMarker(record)) {
            continue;
        }
        entries.push({ source: record.source, output: record.output });
    }
    return entries;
}

/**
 * Reuses or creates an extension-owned time node, hides its source when required, and returns
 * null rather than adopting markup whose ownership marker cannot be verified.
 *
 * @param source - Page-owned time element selected by a trusted adapter.
 * @param datetime - Trusted source datetime to preserve on the generated node.
 * @param text - Exact formatted date text to display.
 * @returns - Verified generated time element, or null on an ownership conflict.
 */
export function renderExactTime(
    source: Element,
    datetime: string,
    text: string
): HTMLTimeElement | null {
    const document = source.ownerDocument;
    const records = getRecords(document);
    const existing = records.get(source);

    if (existing) {
        const sourceMarker = parseSourceMarker(source.getAttribute(OWNED_SOURCE_ATTRIBUTE));
        if (
            existing.source !== source ||
      sourceMarker === null ||
      `${sourceMarker.state}:${sourceMarker.token}` !== expectedSourceMarker(existing) ||
      existing.output.getAttribute(OWNED_OUTPUT_ATTRIBUTE) !== expectedOutputMarker(existing)
        ) {
            return null;
        }
        if (!source.parentNode) {
            return null;
        }
        if (source.nextElementSibling !== existing.output) {
            source.after(existing.output);
        }
        updateOutput(existing.output, datetime, text);
        return existing.output;
    }

    if (source.hasAttribute(OWNED_SOURCE_ATTRIBUTE)) {
        parseSourceMarker(source.getAttribute(OWNED_SOURCE_ATTRIBUTE));
        return null;
    }
    const token = createToken(document);
    if (!token || !source.parentNode) {
        return null;
    }

    const record: OwnedPairRecord = {
        source,
        output: document.createElement("time"),
        token,
        sourceWasHidden: source.hasAttribute("hidden")
    };
    updateOutput(record.output, datetime, text);
    record.output.setAttribute(OWNED_OUTPUT_ATTRIBUTE, expectedOutputMarker(record));
    source.after(record.output);
    source.setAttribute(OWNED_SOURCE_ATTRIBUTE, expectedSourceMarker(record));
    source.setAttribute("hidden", "");
    records.set(source, record);
    return record.output;
}

/**
 * Removes a marker-verified generated node, restores the source visibility captured at render
 * time, and notifies the optional mutation sink before page-visible state changes.
 *
 * @param record - Marker-verified source-output ownership record.
 * @param mutations - Optional sink notified before owned output removal.
 */
function restoreRecord(record: OwnedPairRecord, mutations?: OwnedOutputMutationSink): void {
    const { source, output } = record;
    const validOutput = output.getAttribute(OWNED_OUTPUT_ATTRIBUTE) === expectedOutputMarker(record);
    if (validOutput && output.isConnected && mutations) {
        mutations.beforeOwnedOutputRemoval(output);
    }
    if (source.getAttribute(OWNED_SOURCE_ATTRIBUTE) === expectedSourceMarker(record)) {
        source.removeAttribute(OWNED_SOURCE_ATTRIBUTE);
        source.toggleAttribute("hidden", record.sourceWasHidden);
    }
    if (validOutput) {
        output.removeAttribute(OWNED_OUTPUT_ATTRIBUTE);
        output.remove();
    }
}

/**
 * Removes a marker-verified generated output, restores source visibility, and records the
 * removal for callers that need to reverse the mutation later.
 *
 * @param source - Page-owned source element to restore.
 * @param mutations - Optional sink notified before owned output removal.
 */
export function restoreExactTime(source: Element, mutations?: OwnedOutputMutationSink): void {
    const records = recordsByDocument.get(source.ownerDocument);
    const record = records?.get(source);
    if (!record) {
        return;
    }
    restoreRecord(record, mutations);
    records?.delete(source);
}

/**
 * Restores every marker-verified owned pair below a root, then removes its ownership records so
 * later processing can discover the source again.
 *
 * @param root - Document or element subtree whose owned pairs are restored.
 * @param mutations - Optional sink notified before each owned output removal.
 */
export function restoreExactTimes(root: ParentNode, mutations?: OwnedOutputMutationSink): void {
    const rootNode = root as Node;
    const document = rootNode.nodeType === 9 ? rootNode as Document : rootNode.ownerDocument;
    if (!document) {
        return;
    }
    const records = recordsByDocument.get(document);
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
