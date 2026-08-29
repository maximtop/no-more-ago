/**
 * @file Selects unambiguous page-owned text targets for in-place timestamp presentation.
 */

/**
 * Finds the only meaningful text node in an element without child elements.
 *
 * @param container - Page-owned element whose label is inspected.
 * @returns - One unambiguous text target, or null for empty or complex content.
 */
export function findSimpleTextTarget(container: Element): Text | null {
    if (container.children.length > 0) {
        return null;
    }
    const targets = Array.from(container.childNodes).filter(
        (node): node is Text =>
            node.nodeType === Node.TEXT_NODE && (node as Text).data.trim() !== "",
    );
    return targets.length === 1 ? targets[0] ?? null : null;
}
