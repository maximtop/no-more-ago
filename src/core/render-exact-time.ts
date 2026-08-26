export const OWNED_SOURCE_ATTRIBUTE = "data-no-more-ago-source";
export const OWNED_OUTPUT_ATTRIBUTE = "data-no-more-ago-output";

interface OwnedPairRecord {
    readonly source: Element;
    readonly output: HTMLTimeElement;
    readonly token: string;
    readonly sourceWasHidden: boolean;
}

export interface OwnedSourceEntry {
    readonly source: Element;
    readonly output: HTMLTimeElement;
}

export interface OwnedOutputMutationSink {
    beforeOwnedOutputRemoval(output: HTMLTimeElement): void;
}

const recordsByDocument = new WeakMap<Document, Map<Element, OwnedPairRecord>>();
const SOURCE_MARKER = /^(visible|hidden):(.+)$/;

function parseSourceMarker(value: string | null): { state: "visible" | "hidden"; token: string } | null {
    const match = value?.match(SOURCE_MARKER);
    if (!match) return null;
    const state = match[1];
    const token = match[2];
    if ((state !== "visible" && state !== "hidden") || !token) return null;
    return { state, token };
}

function getRecords(document: Document): Map<Element, OwnedPairRecord> {
    const existing = recordsByDocument.get(document);
    if (existing) return existing;
    const records = new Map<Element, OwnedPairRecord>();
    recordsByDocument.set(document, records);
    return records;
}

function createToken(document: Document): string | null {
    const crypto = document.defaultView?.crypto;
    if (!crypto || typeof crypto.randomUUID !== "function") return null;
    return crypto.randomUUID();
}

function expectedSourceMarker(record: OwnedPairRecord): string {
    return `${record.sourceWasHidden ? "hidden" : "visible"}:${record.token}`;
}

function expectedOutputMarker(record: OwnedPairRecord): string {
    return record.token;
}

function updateOutput(output: HTMLTimeElement, datetime: string, text: string): void {
    output.dateTime = datetime;
    output.textContent = text;
}

export function getOwnedSourceForOutput(node: Node): Element | null {
    const document = node.ownerDocument;
    if (!document) return null;
    const records = recordsByDocument.get(document);
    if (!records) return null;
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
 */
export function getOwnedSourceEntries(document: Document): readonly OwnedSourceEntry[] {
    const records = recordsByDocument.get(document);
    if (!records) return [];
    const entries: OwnedSourceEntry[] = [];
    for (const record of records.values()) {
        if (!record.source.isConnected || !record.output.isConnected) continue;
        if (parseSourceMarker(record.source.getAttribute(OWNED_SOURCE_ATTRIBUTE)) === null) continue;
        if (record.output.getAttribute(OWNED_OUTPUT_ATTRIBUTE) !== expectedOutputMarker(record)) continue;
        entries.push({ source: record.source, output: record.output });
    }
    return entries;
}

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
        if (!source.parentNode) return null;
        if (source.nextElementSibling !== existing.output) source.after(existing.output);
        updateOutput(existing.output, datetime, text);
        return existing.output;
    }

    if (source.hasAttribute(OWNED_SOURCE_ATTRIBUTE)) {
        parseSourceMarker(source.getAttribute(OWNED_SOURCE_ATTRIBUTE));
        return null;
    }
    const token = createToken(document);
    if (!token || !source.parentNode) return null;

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

function restoreRecord(record: OwnedPairRecord, mutations?: OwnedOutputMutationSink): void {
    const { source, output } = record;
    const validOutput = output.getAttribute(OWNED_OUTPUT_ATTRIBUTE) === expectedOutputMarker(record);
    if (validOutput && output.isConnected && mutations) mutations.beforeOwnedOutputRemoval(output);
    if (source.getAttribute(OWNED_SOURCE_ATTRIBUTE) === expectedSourceMarker(record)) {
        source.removeAttribute(OWNED_SOURCE_ATTRIBUTE);
        source.toggleAttribute("hidden", record.sourceWasHidden);
    }
    if (validOutput) {
        output.removeAttribute(OWNED_OUTPUT_ATTRIBUTE);
        output.remove();
    }
}

export function restoreExactTime(source: Element, mutations?: OwnedOutputMutationSink): void {
    const records = recordsByDocument.get(source.ownerDocument);
    const record = records?.get(source);
    if (!record) return;
    restoreRecord(record, mutations);
    records?.delete(source);
}

export function restoreExactTimes(root: ParentNode, mutations?: OwnedOutputMutationSink): void {
    const rootNode = root as Node;
    const document = rootNode.nodeType === 9 ? rootNode as Document : rootNode.ownerDocument;
    if (!document) return;
    const records = recordsByDocument.get(document);
    if (!records) return;

    for (const [source, record] of records) {
        if (rootNode.nodeType !== 9 && source !== rootNode && !rootNode.contains(source)) continue;
        restoreRecord(record, mutations);
        records.delete(source);
    }
}
