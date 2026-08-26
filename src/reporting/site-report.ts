/**
 * Builds and opens prefilled GitHub issue forms for site-support reports.
 *
 * @file Site-report URL validation and Chrome tab integration.
 */

import { isCanonicalHostname } from "../settings/snapshot";

/**
 * GitHub issue composer used for site-report submissions.
 */
export const SITE_REPORT_DESTINATION =
    "https://github.com/maximtop/no-more-ago/issues/new" as const;

/**
 * Issue-form template selected in the GitHub composer.
 */
export const SITE_REPORT_TEMPLATE = "site-report.yml" as const;

/**
 * User-visible reason prefilled in the report form.
 */
export type SiteReportReason = "Add support for this site" | "Dates are not working correctly";

/**
 * Browser family inferred from the user agent for the report form.
 */
export type SiteReportBrowser = "Chrome" | "Edge" | "Firefox" | "Other";

/**
 * Validated fields serialized into the issue-form query string.
 */
export interface SiteReportContext {
    /**
     * Reason selected in the report form.
     */
    readonly reason?: SiteReportReason;

    /**
     * Canonical site hostname reported to GitHub.
     */
    readonly hostname?: string;

    /**
     * HTTP(S) page URL, restricted to the reported hostname and no credentials.
     */
    readonly currentUrl?: string;

    /**
     * Manifest version, limited to the extension's accepted version format.
     */
    readonly extensionVersion?: string;

    /**
     * Browser family included with the report.
     */
    readonly browser?: SiteReportBrowser;
}

/**
 * Popup state needed to classify a report for the active site.
 */
export interface SiteReportPopupState {
    /**
     * Canonical hostname shown by the popup.
     */
    readonly hostname: string;

    /**
     * Whether an adapter already handles the hostname.
     */
    readonly hasAdapter: boolean;
}

/**
 * Minimal untrusted subset of a Chrome tab result.
 */
export interface SiteReportTab {
    /**
     * Active tab URL; validated before it is included in a report.
     */
    readonly url?: unknown;

    /**
     * Whether Chrome reports the tab as belonging to an incognito window.
     */
    readonly incognito?: unknown;

    /**
     * Window identifier used to keep an incognito composer in its source window.
     */
    readonly windowId?: unknown;
}

/**
 * Chrome APIs needed to inspect the active tab and open the issue composer.
 */
export interface SiteReportBrowserRuntime {
    /**
     * Subset of the Chrome Tabs API used by reporting actions.
     */
    readonly tabs?: {
        /**
         * Returns tabs matching Chrome's active-tab query.
         */
        query(query: {
            /**
             * Limits the query to the active tab.
             */
            readonly active: true;

            /**
             * Limits the query to the current window.
             */
            readonly currentWindow: true;
        }): Promise<readonly SiteReportTab[]>;

        /**
         * Opens the composer URL in Chrome, optionally in a specific window.
         */
        create(properties: {
            /**
             * URL to open in the new tab.
             */
            readonly url: string;

            /**
             * Target window ID when preserving an incognito context.
             */
            readonly windowId?: number;
        }): Promise<unknown>;
    };

    /**
     * Subset of the Chrome Runtime API used to read the manifest version.
     */
    readonly runtime?: {
        /**
         * Returns the extension manifest containing the version field.
         */
        getManifest(): unknown;
    };

    /**
     * Browser user-agent source used for browser-family detection.
     */
    readonly navigator?: {
        /**
         * Raw user-agent string, treated as untrusted input.
         */
        readonly userAgent?: unknown;
    };
}

/**
 * Stable failure reasons returned instead of throwing from report actions.
 */
export type SiteReportError =
    | "busy"
    | "invalid-context"
    | "browser-unavailable"
    | "missing-tab"
    | "restricted-page"
    | "hostname-mismatch"
    | "private-window"
    | "open-failed";

/**
 * Report action outcome, including the composer URL when a tab was opened.
 */
export type SiteReportResult =
    | { readonly ok: true; readonly url: string }
    | { readonly ok: false; readonly error: SiteReportError };

const VERSION = /^[0-9A-Za-z][0-9A-Za-z._+-]{0,31}$/u;
const CONTEXT_KEYS = new Set(["reason", "hostname", "currentUrl", "extensionVersion", "browser"]);

/**
 * Narrows a non-array object so its own data properties can be inspected safely.
 *
 * @param value - Untrusted form context value.
 * @returns - Whether the value is a non-array object record.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Rejects inherited, accessor, and unexpected keys from untrusted form context.
 *
 * @param value - Untrusted record whose properties are inspected.
 * @param allowed - Complete set of accepted own property names.
 * @returns - Whether the record contains only allowed own data properties.
 */
function hasOnlyOwnKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
    for (const key in value) {
        if (!Object.hasOwn(value, key)) {
            return false;
        }
    }
    return Object.keys(value).every((key) => {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        return allowed.has(key) && descriptor !== undefined && Object.hasOwn(descriptor, "value");
    });
}

/**
 * Reads an own string property without invoking inherited lookup.
 *
 * @param value - Record containing untrusted form fields.
 * @param key - Own property name to read.
 * @returns - String property value, or undefined when absent or non-string.
 */
function ownString(value: Record<string, unknown>, key: string): string | undefined {
    if (!Object.hasOwn(value, key)) {
        return undefined;
    }
    return typeof value[key] === "string" ? value[key] : undefined;
}

/**
 * Accepts the bounded manifest-version format allowed in report URLs.
 *
 * @param value - Candidate extension version.
 * @returns - Whether the version is safe and bounded for a report URL.
 */
function validVersion(value: string): boolean {
    return VERSION.test(value);
}

/**
 * Accepts a credential-free HTTP(S) URL whose canonical hostname matches exactly.
 *
 * @param value - Candidate page URL.
 * @param hostname - Canonical hostname the URL must match.
 * @returns - Whether the URL is safe, credential-free HTTP(S) for that host.
 */
function validSiteUrl(value: string, hostname: string): boolean {
    try {
        const parsed = new URL(value);
        return (
            (parsed.protocol === "http:" || parsed.protocol === "https:") &&
            parsed.username === "" &&
            parsed.password === "" &&
            isCanonicalHostname(parsed.hostname) &&
            parsed.hostname === hostname
        );
    } catch {
        return false;
    }
}

/**
 * Validates untrusted report fields and returns a prefilled GitHub issue URL.
 *
 * @param context - Untrusted site-report context.
 * @returns - Prefilled GitHub issue URL, or null when validation fails.
 */
export function composeSiteReportUrl(context: unknown): string | null {
    if (!isRecord(context) || !hasOnlyOwnKeys(context, CONTEXT_KEYS)) {
        return null;
    }
    const reason = Object.hasOwn(context, "reason") ? context.reason : undefined;
    const hostname = ownString(context, "hostname");
    const currentUrl = ownString(context, "currentUrl");
    const extensionVersion = ownString(context, "extensionVersion");
    const browser = ownString(context, "browser");
    if (
        reason !== undefined &&
        reason !== "Add support for this site" &&
        reason !== "Dates are not working correctly"
    ) {
        return null;
    }
    if (
        Object.hasOwn(context, "hostname") &&
        (hostname === undefined || !isCanonicalHostname(hostname))
    ) {
        return null;
    }
    if (
        Object.hasOwn(context, "currentUrl") &&
        (currentUrl === undefined || hostname === undefined || !validSiteUrl(currentUrl, hostname))
    ) {
        return null;
    }
    if (
        Object.hasOwn(context, "extensionVersion") &&
        (extensionVersion === undefined || !validVersion(extensionVersion))
    ) {
        return null;
    }
    if (
        Object.hasOwn(context, "browser") &&
        browser !== "Chrome" &&
        browser !== "Edge" &&
        browser !== "Firefox" &&
        browser !== "Other"
    ) {
        return null;
    }

    const url = new URL(SITE_REPORT_DESTINATION);
    url.searchParams.set("template", SITE_REPORT_TEMPLATE);
    if (reason !== undefined) {
        url.searchParams.set("reason", reason);
    }
    if (hostname !== undefined) {
        url.searchParams.set("hostname", hostname);
    }
    if (currentUrl !== undefined) {
        url.searchParams.set("current_url", currentUrl);
    }
    if (extensionVersion !== undefined) {
        url.searchParams.set("extension_version", extensionVersion);
    }
    if (browser !== undefined) {
        url.searchParams.set("browser", browser);
    }
    return url.toString();
}

/**
 * Maps a raw user agent to the browser label expected by the report form.
 *
 * @param userAgent - Untrusted browser user-agent value.
 * @returns - Supported browser label for the report form.
 */
export function browserContextFromUserAgent(userAgent: unknown): SiteReportBrowser {
    if (typeof userAgent !== "string") {
        return "Other";
    }
    if (/Firefox\//u.test(userAgent)) {
        return "Firefox";
    }
    if (/Edg\//u.test(userAgent)) {
        return "Edge";
    }
    if (/(?:Chrome|Chromium)\//u.test(userAgent)) {
        return "Chrome";
    }
    return "Other";
}

/**
 * Reads and validates the manifest version, returning null when unavailable or malformed.
 *
 * @param runtime - Browser runtime dependency exposing manifest metadata.
 * @returns - Valid extension version, or null when unavailable or malformed.
 */
function extensionVersion(runtime: SiteReportBrowserRuntime): string | null {
    if (!runtime.runtime) {
        return null;
    }
    try {
        const manifest = runtime.runtime.getManifest();
        if (
            !isRecord(manifest) ||
            !Object.hasOwn(manifest, "version") ||
            typeof manifest.version !== "string" ||
            !validVersion(manifest.version)
        ) {
            return null;
        }
        return manifest.version;
    } catch {
        return null;
    }
}

/**
 * Collects validated manifest and browser details for a report form.
 *
 * @param runtime - Browser runtime and navigator dependencies.
 * @returns - Validated extension version and browser label, or null.
 */
function environment(
    runtime: SiteReportBrowserRuntime,
): Pick<SiteReportContext, "extensionVersion" | "browser"> | null {
    const version = extensionVersion(runtime);
    return version === null
        ? null
        : {
            extensionVersion: version,
            browser: browserContextFromUserAgent(runtime.navigator?.userAgent),
        };
}

/**
 * Narrows popup state to a canonical hostname and adapter-presence flag.
 *
 * @param value - Untrusted popup state.
 * @returns - Whether it contains a canonical hostname and adapter flag.
 */
function validPopupState(value: unknown): value is SiteReportPopupState {
    return (
        isRecord(value) &&
        Object.hasOwn(value, "hostname") &&
        Object.hasOwn(value, "hasAdapter") &&
        typeof value.hostname === "string" &&
        isCanonicalHostname(value.hostname) &&
        typeof value.hasAdapter === "boolean"
    );
}

/**
 * Narrows a tab response to own URL and incognito data properties before use.
 *
 * @param value - Untrusted browser tab response.
 * @returns - Whether it contains safe own URL and incognito properties.
 */
function validTab(value: unknown): value is SiteReportTab {
    if (!isRecord(value)) {
        return false;
    }
    for (const key in value) {
        if (!Object.hasOwn(value, key)) {
            return false;
        }
    }
    for (const key of ["url", "incognito"] as const) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (descriptor === undefined || !Object.hasOwn(descriptor, "value")) {
            return false;
        }
    }
    return typeof value.url === "string" && typeof value.incognito === "boolean";
}

/**
 * Actions exposed to the popup and options surfaces for opening report forms.
 */
export interface SiteReportReporter {
    /**
     * Opens a report for the active popup site, preserving incognito window scope.
     */
    openPopupReport(state: SiteReportPopupState): Promise<SiteReportResult>;

    /**
     * Opens a generic report form containing extension and browser details.
     */
    openOptionsReport(): Promise<SiteReportResult>;
}

/**
 * Creates serialized report actions over injected Chrome API dependencies.
 *
 * @param runtime - Browser APIs and environment dependencies for report creation.
 * @returns - Serialized site-report action.
 */
export function createSiteReportReporter(runtime: SiteReportBrowserRuntime): SiteReportReporter {
    let inFlight = false;
    const open = async (url: string, windowId?: number): Promise<SiteReportResult> => {
        if (!runtime.tabs) {
            return { ok: false, error: "browser-unavailable" };
        }
        try {
            const properties = windowId === undefined ? { url } : { url, windowId };
            await runtime.tabs.create(properties);
            return { ok: true, url };
        } catch {
            return { ok: false, error: "open-failed" };
        }
    };

    return {
        async openPopupReport(state): Promise<SiteReportResult> {
            if (inFlight) {
                return { ok: false, error: "busy" };
            }
            if (!validPopupState(state)) {
                return { ok: false, error: "invalid-context" };
            }
            if (!runtime.tabs?.query) {
                return { ok: false, error: "browser-unavailable" };
            }
            inFlight = true;
            try {
                let tabs: readonly SiteReportTab[];
                try {
                    tabs = await runtime.tabs.query({ active: true, currentWindow: true });
                } catch {
                    return { ok: false, error: "missing-tab" };
                }
                if (tabs.length !== 1 || !validTab(tabs[0])) {
                    return { ok: false, error: "missing-tab" };
                }
                const tab = tabs[0];
                let parsed: URL;
                try {
                    parsed = new URL(tab.url as string);
                } catch {
                    return { ok: false, error: "restricted-page" };
                }
                if (
                    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
                    parsed.username !== "" ||
                    parsed.password !== ""
                ) {
                    return { ok: false, error: "restricted-page" };
                }
                if (!isCanonicalHostname(parsed.hostname)) {
                    return { ok: false, error: "restricted-page" };
                }
                if (parsed.hostname !== state.hostname) {
                    return { ok: false, error: "hostname-mismatch" };
                }
                const env = environment(runtime);
                if (env === null) {
                    return { ok: false, error: "invalid-context" };
                }
                const url = composeSiteReportUrl({
                    ...env,
                    reason: state.hasAdapter
                        ? "Dates are not working correctly"
                        : "Add support for this site",
                    hostname: state.hostname,
                    currentUrl: tab.url,
                });
                if (url === null) {
                    return { ok: false, error: "invalid-context" };
                }
                if (tab.incognito === true) {
                    if (
                        !Object.hasOwn(tab, "windowId") ||
                        typeof tab.windowId !== "number" ||
                        !Number.isSafeInteger(tab.windowId) ||
                        tab.windowId < 0
                    ) {
                        return { ok: false, error: "private-window" };
                    }
                    return await open(url, tab.windowId);
                }
                return await open(url);
            } finally {
                inFlight = false;
            }
        },
        async openOptionsReport(): Promise<SiteReportResult> {
            if (inFlight) {
                return { ok: false, error: "busy" };
            }
            if (!runtime.tabs?.create) {
                return { ok: false, error: "browser-unavailable" };
            }
            inFlight = true;
            try {
                const env = environment(runtime);
                if (env === null) {
                    return { ok: false, error: "invalid-context" };
                }
                const url = composeSiteReportUrl(env);
                if (url === null) {
                    return { ok: false, error: "invalid-context" };
                }
                return await open(url);
            } finally {
                inFlight = false;
            }
        },
    };
}

/**
 * Creates the default reporter lazily, so Chrome APIs run only after a report action.
 *
 * @returns - Lazily initialized reporter backed by available Chrome APIs.
 */
export function createDefaultSiteReportReporter(): SiteReportReporter {
    const browser = typeof chrome === "undefined" ? undefined : chrome;
    const runtime: SiteReportBrowserRuntime = {
        ...(browser?.tabs
            ? {
                tabs: {
                    query: (query) => browser.tabs.query(query),
                    create: (properties) => browser.tabs.create(properties),
                },
            }
            : {}),
        ...(browser?.runtime
            ? { runtime: { getManifest: () => browser.runtime.getManifest() } }
            : {}),
        ...(typeof navigator === "undefined"
            ? {}
            : {
                navigator: {
                    get userAgent() {
                        return navigator.userAgent;
                    },
                },
            }),
    };
    return createSiteReportReporter(runtime);
}
