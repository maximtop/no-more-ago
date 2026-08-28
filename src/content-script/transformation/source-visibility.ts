/**
 * @file Generic source visibility policy for preserving page-hidden semantics.
 */

import type { OwnedDomMutationSink } from "./render-exact-time";

/**
 * Checks whether an element carries an accessibility suppression attribute.
 *
 * @param element - Element whose suppression attributes are inspected.
 * @returns - Whether the element is hidden from accessibility or interaction.
 */
function hasSemanticSuppression(element: Element): boolean {
    return (
        element.hasAttribute("inert")
        || element.getAttribute("aria-hidden")?.trim().toLowerCase() === "true"
    );
}

/**
 * Checks whether an element's local computed style suppresses its rendering.
 *
 * @param element - Element whose computed style is inspected.
 * @param hiddenByExtension - Whether the extension owns the source's hidden attribute.
 * @param mutations - Optional sink for tracking temporary extension-owned changes.
 * @returns - Whether the element is not visibly rendered.
 */
function hasLocalStyleSuppression(
    element: Element,
    hiddenByExtension: boolean,
    mutations?: OwnedDomMutationSink,
): boolean {
    const view = element.ownerDocument.defaultView;
    if (!view) {
        return false;
    }
    const style = view.getComputedStyle(element);
    const pageDisplayNone = style.display === "none"
        && (!hiddenByExtension || isPageDisplayNone(element, view, mutations));
    return pageDisplayNone
        || style.visibility === "hidden"
        || style.visibility === "collapse";
}

/**
 * Checks page CSS separately from the user-agent rule applied by the hidden attribute.
 *
 * @param element - Source element whose page styling is inspected.
 * @param view - Window used to calculate the element's style.
 * @param mutations - Optional sink for tracking temporary extension-owned changes.
 * @returns - Whether page styling hides the source after extension hiding is removed.
 */
function isPageDisplayNone(
    element: Element,
    view: Window,
    mutations?: OwnedDomMutationSink,
): boolean {
    if (element instanceof HTMLElement && element.style.display === "none") {
        return true;
    }
    if (!element.hasAttribute("hidden")) {
        return false;
    }
    mutations?.beforeOwnedSourceHiddenChange(element, false);
    element.removeAttribute("hidden");
    try {
        return view.getComputedStyle(element).display === "none";
    } finally {
        mutations?.beforeOwnedSourceHiddenChange(element, true);
        element.setAttribute("hidden", "");
    }
}

/**
 * Determines whether a generic timestamp must remain suppressed by page state.
 *
 * @param source - Generic timestamp source to inspect.
 * @param hiddenByExtension - Whether this extension owns the source's hidden attribute.
 * @param mutations - Optional sink for tracking temporary extension-owned changes.
 * @returns - Whether the source should not receive a generated visible output.
 */
export function isSourceSuppressed(
    source: Element,
    hiddenByExtension: boolean,
    mutations?: OwnedDomMutationSink,
): boolean {
    let current: Element | null = source;
    let isSource = true;
    while (current) {
        if (hasSemanticSuppression(current)) {
            return true;
        }
        if (current.hasAttribute("hidden") && (isSource ? !hiddenByExtension : true)) {
            return true;
        }
        current = current.parentElement;
        isSource = false;
    }
    return hasLocalStyleSuppression(source, hiddenByExtension, mutations);
}
