/**
 * @file Canonical extension-relative filenames shared by runtime and build code.
 */

/**
 * Background service-worker bundle filename.
 */
export const BACKGROUND_SCRIPT_FILE = 'background.js' as const;

/**
 * Content-runtime bundle filename.
 */
export const CONTENT_SCRIPT_FILE = 'content.js' as const;

/**
 * Facebook main-world payload bridge bundle filename.
 */
export const FACEBOOK_PAYLOAD_BRIDGE_SCRIPT_FILE = 'facebook-payload-bridge.js' as const;

/**
 * Popup document filename.
 */
export const POPUP_PAGE_FILE = 'popup.html' as const;

/**
 * Options document filename.
 */
export const OPTIONS_PAGE_FILE = 'options.html' as const;

/**
 * Browser extension manifest filename.
 */
export const MANIFEST_FILE = 'manifest.json' as const;

/**
 * Icon sizes emitted into every browser artifact and declared by its manifest.
 */
export const EXTENSION_ICON_SIZES = [16, 32, 48, 128] as const;

/**
 * Base filename of the toolbar icon emitted at every icon size.
 */
export const EXTENSION_ICON_BASENAME = 'icon' as const;
