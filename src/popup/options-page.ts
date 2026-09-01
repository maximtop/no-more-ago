/**
 * Opens the browser-managed extension Options page.
 *
 * @file Popup-owned browser capability for opening the full Options surface.
 */

/**
 * Browser boundary used by the popup's Settings action.
 */
export type OpenOptionsPage = () => Promise<void>;

/**
 * Opens the extension's browser-managed Options page.
 *
 * @returns A promise settled by the browser after the open attempt.
 */
export function openBrowserOptionsPage(): Promise<void> {
    return chrome.runtime.openOptionsPage();
}
