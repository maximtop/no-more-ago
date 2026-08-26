/**
 * @file Opens prefilled GitHub issue forms for site-support reports.
 */

import * as v from "valibot";
import { SAFE_EXTENSION_VERSION_PATTERN } from "../core/extension-version";
import { isCanonicalHostname } from "../settings/snapshot";

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

const hostnameSchema = v.pipe(v.string(), v.check(isCanonicalHostname));
const versionSchema = v.pipe(v.string(), v.regex(SAFE_EXTENSION_VERSION_PATTERN));
const reportContextSchema = v.strictObject({
    reason: v.exactOptional(v.picklist(SITE_REPORT_REASONS)),
    hostname: v.exactOptional(hostnameSchema),
    currentUrl: v.exactOptional(v.string()),
    extensionVersion: v.exactOptional(versionSchema),
    browser: v.exactOptional(v.picklist(SITE_REPORT_BROWSERS)),
});
const popupStateSchema = v.strictObject({
    hostname: hostnameSchema,
    hasAdapter: v.boolean(),
});

/**
 * Site-report reason inferred from the supported values.
 */
export type SiteReportReason = (typeof SITE_REPORT_REASONS)[number];

/**
 * Site-report browser inferred from the supported values.
 */
export type SiteReportBrowser = (typeof SITE_REPORT_BROWSERS)[number];

/**
 * Validated fields serialized into the GitHub issue form.
 */
export type SiteReportContext = v.InferOutput<typeof reportContextSchema>;

/**
 * Popup state required to report the current site.
 */
export type SiteReportPopupState = v.InferOutput<typeof popupStateSchema>;

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
    readonly url?: unknown;

    /**
     * Whether the tab belongs to a private window.
     */
    readonly incognito?: unknown;

    /**
     * Window in which a private report must be opened.
     */
    readonly windowId?: unknown;
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
        getManifest(): unknown;
    };

    /**
     * Browser identification source.
     */
    readonly navigator?: {
        /**
         * Current browser user-agent string.
         */
        readonly userAgent?: unknown;
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
 * Creates a validated prefilled GitHub issue URL.
 *
 * @param context - Site-report fields to serialize.
 * @returns - GitHub issue URL, or null for invalid fields.
 */
export function composeSiteReportUrl(context: unknown): string | null {
    const parsed = v.safeParse(reportContextSchema, context);
    if (!parsed.success) {
        return null;
    }
    const value = parsed.output;
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
    return /(?:Chrome|Chromium)\//u.test(userAgent) ? "Chrome" : "Other";
}

/**
 * Reads the current validated extension version.
 *
 * @param runtime - Browser runtime dependency.
 * @returns - Valid extension version, or null when unavailable.
 */
function extensionVersion(runtime: SiteReportBrowserRuntime): string | null {
    try {
        const manifest = runtime.runtime?.getManifest();
        if (typeof manifest !== "object" || manifest === null) {
            return null;
        }
        const version = (manifest as { readonly version?: unknown }).version;
        return typeof version === "string" && SAFE_EXTENSION_VERSION_PATTERN.test(version)
            ? version
            : null;
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
            const parsedState = v.safeParse(popupStateSchema, state);
            if (!parsedState.success) {
                return { ok: false, error: "invalid-context" };
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
                if (!tab || typeof tab.url !== "string") {
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
                if (url.hostname !== parsedState.output.hostname) {
                    return { ok: false, error: "hostname-mismatch" };
                }
                const env = environment();
                if (!env) {
                    return { ok: false, error: "invalid-context" };
                }
                const reportUrl = composeSiteReportUrl({
                    ...env,
                    reason: parsedState.output.hasAdapter
                        ? SITE_REPORT_REASONS[1]
                        : SITE_REPORT_REASONS[0],
                    hostname: parsedState.output.hostname,
                    currentUrl: tab.url,
                });
                if (!reportUrl) {
                    return { ok: false, error: "invalid-context" };
                }
                if (tab.incognito === true) {
                    if (
                        typeof tab.windowId !== "number"
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
