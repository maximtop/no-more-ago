/**
 * Opens the browser-managed extension Options page.
 *
 * @file Popup-owned browser capability for opening the full Options surface.
 */

/**
 * Browser boundary used by the popup's Settings action.
 */
export interface OptionsPageOpener {
    /**
     * Opens the extension's browser-managed Options page.
     *
     * @returns A promise settled by the browser after the open attempt.
     */
    open(): Promise<void>;
}

/**
 * Creates the production Options-page opener.
 *
 * @returns An opener backed by the extension runtime.
 */
export function createDefaultOptionsPageOpener(): OptionsPageOpener {
    return {
        open: () => chrome.runtime.openOptionsPage(),
    };
}
