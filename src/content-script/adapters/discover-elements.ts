/**
 * @file Shared bounded element discovery for timestamp adapters.
 */

/**
 * Finds matching elements at one root and below it without duplicating the root.
 *
 * @param root - Document or element subtree to inspect.
 * @param selector - Selector that bounds descendant discovery.
 * @param accepts - Adapter predicate applied to both the root and descendants.
 * @returns - Accepted elements in root-first document order.
 */
export function discoverElements(
    root: ParentNode,
    selector: string,
    accepts: (element: Element) => boolean,
): readonly Element[] {
    const candidates: Element[] = [];
    if (root.nodeType === Node.ELEMENT_NODE) {
        const element = root as Element;
        if (accepts(element)) {
            candidates.push(element);
        }
    }
    for (const element of root.querySelectorAll(selector)) {
        if (accepts(element)) {
            candidates.push(element);
        }
    }
    return candidates;
}
