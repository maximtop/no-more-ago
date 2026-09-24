/**
 * @file Generic source visibility policy for preserving page-hidden semantics.
 */

/**
 * Checks whether an element carries an accessibility suppression attribute.
 *
 * @param element - Element whose suppression attributes are inspected.
 *
 * @returns - Whether the element is hidden from accessibility or interaction.
 */
function hasSemanticSuppression(element: Element): boolean {
    return (
        element.hasAttribute('inert')
        || element.getAttribute('aria-hidden')?.trim().toLowerCase() === 'true'
    );
}

/**
 * Checks whether an element's local computed style suppresses its rendering.
 *
 * @param element - Element whose computed style is inspected.
 *
 * @returns - Whether the element is not visibly rendered.
 */
function hasLocalStyleSuppression(element: Element): boolean {
    const view = element.ownerDocument.defaultView;
    if (!view) {
        return false;
    }
    const style = view.getComputedStyle(element);
    return style.display === 'none'
        || style.visibility === 'hidden'
        || style.visibility === 'collapse';
}

/**
 * Determines whether a generic timestamp must remain suppressed by page state.
 *
 * @param source - Generic timestamp source to inspect.
 *
 * @returns - Whether the source should not receive a generated visible output.
 */
export function isSourceSuppressed(source: Element): boolean {
    let current: Element | null = source;
    while (current) {
        if (
            hasSemanticSuppression(current)
            || current.hasAttribute('hidden')
            || hasLocalStyleSuppression(current)
        ) {
            return true;
        }
        current = current.parentElement;
    }
    return false;
}
