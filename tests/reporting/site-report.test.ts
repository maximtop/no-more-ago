import { describe, expect, it } from "vitest";
import {
    browserContextFromUserAgent,
    composeSiteReportUrl,
    createSiteReportReporter,
    type SiteReportBrowserRuntime,
    type SiteReportTab
} from "../../src/reporting/site-report";

const manifest = { version: "1.2.3" };

function runtime(tab?: SiteReportTab, options: { readonly create?: () => Promise<unknown>; readonly manifest?: unknown; readonly userAgent?: string } = {}): SiteReportBrowserRuntime & { queries: number; creates: Array<Record<string, unknown>> } {
    const result = {
        queries: 0,
        creates: [] as Array<Record<string, unknown>>,
        tabs: {
            query: () => { result.queries += 1; return Promise.resolve(tab ? [tab] : []); },
            create: (properties: Record<string, unknown>) => { result.creates.push(properties); return options.create ? options.create() : Promise.resolve(undefined); }
        },
        runtime: { getManifest: () => options.manifest ?? manifest },
        navigator: { userAgent: options.userAgent ?? "Mozilla/5.0 Chrome/139.0.0.0" }
    };
    return result;
}

describe("site report composer", () => {
    it("uses one fixed GitHub destination and editable encoded fields", () => {
        const url = composeSiteReportUrl({
            reason: "Dates are not working correctly",
            hostname: "github.com",
            currentUrl: "https://github.com/acme/repo/issues/1?filter=all#discussion",
            extensionVersion: "1.2.3",
            browser: "Chrome"
        });
        if (!url) throw new Error("report URL was not composed");
        const parsed = new URL(url);
        expect(parsed.origin).toBe("https://github.com");
        expect(parsed.pathname).toBe("/maximtop/no-more-ago/issues/new");
        expect(parsed.searchParams.get("template")).toBe("site-report.yml");
        expect(parsed.searchParams.get("reason")).toBe("Dates are not working correctly");
        expect(parsed.searchParams.get("hostname")).toBe("github.com");
        expect(parsed.searchParams.get("current_url")).toBe("https://github.com/acme/repo/issues/1?filter=all#discussion");
        expect(parsed.searchParams.get("extension_version")).toBe("1.2.3");
        expect(parsed.searchParams.get("browser")).toBe("Chrome");
    });

    it("keeps generic Options site fields and reason editable and blank", () => {
        const url = composeSiteReportUrl({ extensionVersion: "1.2.3", browser: "Firefox" });
        if (!url) throw new Error("generic report URL was not composed");
        const params = new URL(url).searchParams;
        expect(params.get("template")).toBe("site-report.yml");
        expect(params.has("reason")).toBe(false);
        expect(params.has("hostname")).toBe(false);
        expect(params.has("current_url")).toBe(false);
        expect(params.get("browser")).toBe("Firefox");
    });

    it.each([
        [{ hostname: "github.com", currentUrl: "ftp://github.com/a" }],
        [{ hostname: "github.com", currentUrl: "https://user:pass@github.com/a" }],
        [{ hostname: "github.com", currentUrl: "https://example.com/a" }],
        [{ hostname: "github.com", extensionVersion: "not valid" }],
        [{ hostname: "github.com", reason: "unexpected" }],
        [{ hostname: "github.com", currentUrl: "https://github.com/a", secret: "private" }]
    ])("rejects unsafe or non-contract composer context %j", (context) => {
        expect(composeSiteReportUrl(context)).toBeNull();
    });

    it.each([
        ["Firefox/142.0", "Firefox"],
        ["Mozilla Edg/139.0", "Edge"],
        ["Mozilla Chrome/139.0", "Chrome"],
        ["OtherBrowser/1.0", "Other"]
    ] as const)("derives coarse browser context for %s", (userAgent, expected) => {
        expect(browserContextFromUserAgent(userAgent)).toBe(expected);
    });
});

describe("site report browser boundary", () => {
    it("does no tab work before an explicit report call and opens the adapter reason", async () => {
        const browser = runtime({ url: "https://github.com/acme/repo", incognito: false, windowId: 4 });
        const reporter = createSiteReportReporter(browser);
        expect(browser.queries).toBe(0);
        expect(browser.creates).toHaveLength(0);
        const result = await reporter.openPopupReport({ hostname: "github.com", hasAdapter: true });
        expect(result.ok).toBe(true);
        expect(browser.queries).toBe(1);
        expect(browser.creates).toHaveLength(1);
        const url = new URL(String(browser.creates[0]?.url));
        expect(url.searchParams.get("reason")).toBe("Dates are not working correctly");
        expect(url.searchParams.get("current_url")).toBe("https://github.com/acme/repo");
        expect(browser.creates[0]?.windowId).toBeUndefined();
    });

    it("selects the add-support reason for a no-adapter site", async () => {
        const browser = runtime({ url: "http://example.test/path", incognito: false });
        const result = await createSiteReportReporter(browser).openPopupReport({ hostname: "example.test", hasAdapter: false });
        expect(result.ok).toBe(true);
        expect(new URL(String(browser.creates[0]?.url)).searchParams.get("reason")).toBe("Add support for this site");
    });

    it("keeps a private report in its originating window", async () => {
        const browser = runtime({ url: "https://github.com/private", incognito: true, windowId: 42 });
        const result = await createSiteReportReporter(browser).openPopupReport({ hostname: "github.com", hasAdapter: true });
        expect(result.ok).toBe(true);
        expect(browser.creates[0]?.windowId).toBe(42);
    });

    it.each([
        [{ url: "chrome://settings", incognito: false }, "restricted-page"],
        [{ url: "https://example.com/private", incognito: false }, "hostname-mismatch"],
        [{ url: "https://user:pass@github.com/private", incognito: false }, "restricted-page"],
        [{ url: "https://github.com/private", incognito: true }, "private-window"]
    ] as const)("rejects unsafe active tab context %j", async (tab, error) => {
        const browser = runtime(tab);
        const result = await createSiteReportReporter(browser).openPopupReport({ hostname: "github.com", hasAdapter: true });
        expect(result).toEqual({ ok: false, error });
        expect(browser.creates).toHaveLength(0);
    });

    it("opens a generic Options report without querying the active tab", async () => {
        const browser = runtime(undefined);
        const result = await createSiteReportReporter(browser).openOptionsReport();
        expect(result.ok).toBe(true);
        expect(browser.queries).toBe(0);
        const params = new URL(String(browser.creates[0]?.url)).searchParams;
        expect(params.has("hostname")).toBe(false);
        expect(params.has("current_url")).toBe(false);
        expect(params.has("reason")).toBe(false);
    });

    it("does not retry a failed open or duplicate an in-flight request", async () => {
        let release: (() => void) | undefined;
        const pending = new Promise<void>((resolve) => { release = resolve; });
        const browser = runtime({ url: "https://github.com/repo", incognito: false }, { create: () => pending });
        const reporter = createSiteReportReporter(browser);
        const first = reporter.openPopupReport({ hostname: "github.com", hasAdapter: true });
        const duplicate = await reporter.openPopupReport({ hostname: "github.com", hasAdapter: true });
        expect(duplicate).toEqual({ ok: false, error: "busy" });
        release?.();
        expect((await first).ok).toBe(true);
        expect(browser.creates).toHaveLength(1);

        const failedBrowser = runtime({ url: "https://github.com/repo", incognito: false }, { create: () => Promise.reject(new Error("blocked")) });
        const failed = await createSiteReportReporter(failedBrowser).openPopupReport({ hostname: "github.com", hasAdapter: true });
        expect(failed).toEqual({ ok: false, error: "open-failed" });
        expect(failedBrowser.creates).toHaveLength(1);
    });

    it("fails closed when trusted environment metadata is unavailable", async () => {
        const browser = runtime({ url: "https://github.com/repo", incognito: false }, { manifest: {} });
        const result = await createSiteReportReporter(browser).openPopupReport({ hostname: "github.com", hasAdapter: true });
        expect(result).toEqual({ ok: false, error: "invalid-context" });
        expect(browser.creates).toHaveLength(0);
    });
});
