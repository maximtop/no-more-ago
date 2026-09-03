/**
 * @file Opens prefilled GitHub issue forms for site-support reports.
 */

/**
 * GitHub issue composer used for site reports.
 */
export const SITE_REPORT_DESTINATION =
    "https://github.com/maximtop/no-more-ago/issues/new" as const;

/**
 * Issue-form template selected in the GitHub composer.
 */
export const SITE_REPORT_TEMPLATE = "site-report.yml" as const;

/**
 * Reasons supported by the site-report form.
 */
export const SITE_REPORT_REASONS = [
    "Add support for this site",
    "Dates are not working correctly",
] as const;

/**
 * Browser labels supported by the site-report form.
 */
export const SITE_REPORT_BROWSERS = ["Chrome", "Edge", "Firefox", "Other"] as const;

/**
 * Stable site-report failures shown by extension views.
 */
export const SITE_REPORT_ERRORS = [
    "busy",
    "invalid-context",
    "browser-unavailable",
    "missing-tab",
    "restricted-page",
    "hostname-mismatch",
    "private-window",
    "open-failed",
] as const;

/**
 * Site-report reason inferred from the supported values.
 */
export type SiteReportReason = (typeof SITE_REPORT_REASONS)[number];

/**
 * Site-report browser inferred from the supported values.
 */
export type SiteReportBrowser = (typeof SITE_REPORT_BROWSERS)[number];

/**
 * Extension-derived fields serialized into the GitHub issue form.
 */
export interface SiteReportContext {
    /**
     * Preselected issue-form reason.
     */
    readonly reason?: SiteReportReason;

    /**
     * Canonical hostname the report is about.
     */
    readonly hostname?: string;

    /**
     * Current page URL, included only when it belongs to the reported hostname.
     */
    readonly currentUrl?: string;

    /**
     * Current extension version read from the manifest.
     */
    readonly extensionVersion?: string;

    /**
     * Coarse browser label derived from the user agent.
     */
    readonly browser?: SiteReportBrowser;
}

/**
 * Popup state required to report the current site.
 */
export interface SiteReportPopupState {
    /**
     * Canonical hostname shown by the popup for the active tab.
     */
    readonly hostname: string;
}

/**
 * Stable site-report failure.
 */
export type SiteReportError = (typeof SITE_REPORT_ERRORS)[number];

/**
 * Result of opening the site-report composer.
 */
export type SiteReportResult =
    | {
        /**
         * Marks a successfully opened report.
         */
        readonly ok: true;

        /**
         * GitHub composer URL opened for the user.
         */
        readonly url: string;
    }
    | {
        /**
         * Marks a report that could not be opened.
         */
        readonly ok: false;

        /**
         * Stable failure shown by the extension view.
         */
        readonly error: SiteReportError;
    };

/**
 * Active-tab fields used to compose a site report.
 */
export interface SiteReportTab {
    /**
     * Current page URL.
     */
    readonly url?: string | undefined;

    /**
     * Whether the tab belongs to a private window.
     */
    readonly incognito?: boolean | undefined;

    /**
     * Window in which a private report must be opened.
     */
    readonly windowId?: number | undefined;
}

/**
 * Manifest fields used in a site report.
 */
export interface SiteReportManifest {
    /**
     * Current extension version.
     */
    readonly version: string;
}

/**
 * Browser APIs required to inspect the active tab and open a report.
 */
export interface SiteReportBrowserRuntime {
    /**
     * Tab query and creation methods.
     */
    readonly tabs?: {
        /**
         * Returns the active tab in the current window.
         */
        query(query: {
            /**
             * Restricts the query to the active tab.
             */
            readonly active: true;

            /**
             * Restricts the query to the focused window.
             */
            readonly currentWindow: true;
        }): Promise<readonly SiteReportTab[]>;

        /**
         * Opens the supplied report URL.
         */
        create(properties: {
            /**
             * Report URL to open.
             */
            readonly url: string;

            /**
             * Originating private window, when required.
             */
            readonly windowId?: number;
        }): Promise<unknown>;
    };

    /**
     * Manifest metadata source.
     */
    readonly runtime?: {
        /**
         * Returns the current extension manifest.
         */
        getManifest(): SiteReportManifest;
    };

    /**
     * Browser identification source.
     */
    readonly navigator?: {
        /**
         * Current browser user-agent string.
         */
        readonly userAgent?: string | undefined;
    };
}

/**
 * Actions exposed to popup and options views.
 */
export interface SiteReportReporter {
    /**
     * Opens a report for the active popup site.
     */
    openPopupReport(state: SiteReportPopupState): Promise<SiteReportResult>;

    /**
     * Opens a generic report containing extension environment details.
     */
    openOptionsReport(): Promise<SiteReportResult>;
}

/**
 * Checks whether a URL belongs to the exact reported HTTP(S) hostname.
 *
 * @param value - Page URL to validate.
 * @param hostname - Expected canonical hostname.
 * @returns - Whether the URL is safe to include in the report.
 */
function isReportableUrl(value: string, hostname: string): boolean {
    try {
        const url = new URL(value);
        return (
            (url.protocol === "http:" || url.protocol === "https:")
            && url.username === ""
            && url.password === ""
            && url.hostname === hostname
        );
    } catch {
        return false;
    }
}

/**
 * Creates a prefilled GitHub issue URL for one report context.
 *
 * A current URL is included only when it provably belongs to the reported
 * hostname, so a report never publishes an unrelated page address.
 *
 * @param context - Site-report fields to serialize.
 * @returns - GitHub issue URL, or null when the page URL cannot be published.
 */
export function composeSiteReportUrl(context: SiteReportContext): string | null {
    const value = context;
    if (
        value.currentUrl !== undefined
        && (value.hostname === undefined || !isReportableUrl(value.currentUrl, value.hostname))
    ) {
        return null;
    }
    const url = new URL(SITE_REPORT_DESTINATION);
    url.searchParams.set("template", SITE_REPORT_TEMPLATE);
    if (value.reason !== undefined) {
        url.searchParams.set("reason", value.reason);
    }
    if (value.hostname !== undefined) {
        url.searchParams.set("hostname", value.hostname);
    }
    if (value.currentUrl !== undefined) {
        url.searchParams.set("current_url", value.currentUrl);
    }
    if (value.extensionVersion !== undefined) {
        url.searchParams.set("extension_version", value.extensionVersion);
    }
    if (value.browser !== undefined) {
        url.searchParams.set("browser", value.browser);
    }
    return url.toString();
}

/**
 * Maps a user agent to the browser label expected by the issue form.
 *
 * @param userAgent - Browser user-agent value.
 * @returns - Supported browser label.
 */
export function browserContextFromUserAgent(userAgent: string | undefined): SiteReportBrowser {
    if (userAgent === undefined) {
        return "Other";
    }
    if (/Firefox\//u.test(userAgent)) {
        return "Firefox";
    }
    if (/Edg\//u.test(userAgent)) {
        return "Edge";
    }
    return /(?:Chrome|Chromium)\//u.test(userAgent) ? "Chrome" : "Other";
}

/**
 * Reads the current extension version.
 *
 * @param runtime - Browser runtime dependency.
 * @returns - Valid extension version, or null when unavailable.
 */
function extensionVersion(runtime: SiteReportBrowserRuntime): string | null {
    try {
        return runtime.runtime?.getManifest().version ?? null;
    } catch {
        return null;
    }
}

/**
 * Creates site-report actions over browser APIs.
 *
 * @param runtime - Browser APIs used to collect context and open tabs.
 * @returns - Site-report action service.
 */
export function createSiteReportReporter(runtime: SiteReportBrowserRuntime): SiteReportReporter {
    let busy = false;
    const environment = (): Pick<SiteReportContext, "extensionVersion" | "browser"> | null => {
        const version = extensionVersion(runtime);
        return version === null
            ? null
            : {
                extensionVersion: version,
                browser: browserContextFromUserAgent(runtime.navigator?.userAgent),
            };
    };
    const open = async (url: string, windowId?: number): Promise<SiteReportResult> => {
        if (!runtime.tabs) {
            return { ok: false, error: "browser-unavailable" };
        }
        try {
            await runtime.tabs.create(windowId === undefined ? { url } : { url, windowId });
            return { ok: true, url };
        } catch {
            return { ok: false, error: "open-failed" };
        }
    };
    return {
        async openPopupReport(state): Promise<SiteReportResult> {
            if (busy) {
                return { ok: false, error: "busy" };
            }
            if (!runtime.tabs) {
                return { ok: false, error: "browser-unavailable" };
            }
            busy = true;
            try {
                let tabs;
                try {
                    tabs = await runtime.tabs.query({ active: true, currentWindow: true });
                } catch {
                    return { ok: false, error: "missing-tab" };
                }
                const tab = tabs.length === 1 ? tabs[0] : undefined;
                if (!tab?.url) {
                    return { ok: false, error: "missing-tab" };
                }
                let url: URL;
                try {
                    url = new URL(tab.url);
                } catch {
                    return { ok: false, error: "restricted-page" };
                }
                if (url.protocol !== "http:" && url.protocol !== "https:") {
                    return { ok: false, error: "restricted-page" };
                }
                if (url.username !== "" || url.password !== "") {
                    return { ok: false, error: "restricted-page" };
                }
                if (url.hostname !== state.hostname) {
                    return { ok: false, error: "hostname-mismatch" };
                }
                const env = environment();
                if (!env) {
                    return { ok: false, error: "invalid-context" };
                }
                const reportUrl = composeSiteReportUrl({
                    ...env,
                    reason: SITE_REPORT_REASONS[1],
                    hostname: state.hostname,
                    currentUrl: tab.url,
                });
                if (!reportUrl) {
                    return { ok: false, error: "invalid-context" };
                }
                if (tab.incognito === true) {
                    if (
                        tab.windowId === undefined
                        || !Number.isSafeInteger(tab.windowId)
                        || tab.windowId < 0
                    ) {
                        return { ok: false, error: "private-window" };
                    }
                    return await open(reportUrl, tab.windowId);
                }
                return await open(reportUrl);
            } finally {
                busy = false;
            }
        },
        async openOptionsReport(): Promise<SiteReportResult> {
            if (busy) {
                return { ok: false, error: "busy" };
            }
            busy = true;
            try {
                const env = environment();
                if (!env) {
                    return { ok: false, error: "invalid-context" };
                }
                const url = composeSiteReportUrl(env);
                return url
                    ? await open(url)
                    : { ok: false, error: "invalid-context" };
            } finally {
                busy = false;
            }
        },
    };
}

/**
 * Creates the default reporter backed by available Chrome APIs.
 *
 * @returns - Site-report service for extension views.
 */
export function createDefaultSiteReportReporter(): SiteReportReporter {
    if (typeof chrome === "undefined") {
        return createSiteReportReporter({});
    }
    return createSiteReportReporter({
        tabs: {
            query: (query) => chrome.tabs.query(query),
            create: (properties) => chrome.tabs.create(properties),
        },
        runtime: { getManifest: () => chrome.runtime.getManifest() },
        ...(typeof navigator === "undefined"
            ? {}
            : {
                navigator: {
                    get userAgent(): string {
                        return navigator.userAgent;
                    },
                },
            }),
    });
}
