/**
 * @file Realm-independent HTML element recognition shared by timestamp adapters.
 */

const HTML_NAMESPACE = 'http://www.w3.org/1999/xhtml' as const;

/**
 * Checks whether an element belongs to the standard HTML namespace.
 *
 * @param element - Element from any document realm.
 *
 * @returns - Whether the element is an HTML element.
 */
export function isHtmlElement(element: Element): boolean {
    return element.namespaceURI === HTML_NAMESPACE;
}
