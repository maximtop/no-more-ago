import { isCanonicalHostname } from "../settings/snapshot";

export const SITE_REPORT_DESTINATION = "https://github.com/maximtop/no-more-ago/issues/new" as const;
export const SITE_REPORT_TEMPLATE = "site-report.yml" as const;

export type SiteReportReason = "Add support for this site" | "Dates are not working correctly";
export type SiteReportBrowser = "Chrome" | "Edge" | "Firefox" | "Other";

export interface SiteReportContext {
  readonly reason?: SiteReportReason;
  readonly hostname?: string;
  readonly currentUrl?: string;
  readonly extensionVersion?: string;
  readonly browser?: SiteReportBrowser;
}

export interface SiteReportPopupState {
  readonly hostname: string;
  readonly hasAdapter: boolean;
}

export interface SiteReportTab {
  readonly url?: unknown;
  readonly incognito?: unknown;
  readonly windowId?: unknown;
}

export interface SiteReportBrowserRuntime {
  readonly tabs?: {
    query(query: { readonly active: true; readonly currentWindow: true }): Promise<readonly SiteReportTab[]>;
    create(properties: { readonly url: string; readonly windowId?: number }): Promise<unknown>;
  };
  readonly runtime?: { getManifest(): unknown };
  readonly navigator?: { readonly userAgent?: unknown };
}

export type SiteReportError =
  | "busy"
  | "invalid-context"
  | "browser-unavailable"
  | "missing-tab"
  | "restricted-page"
  | "hostname-mismatch"
  | "private-window"
  | "open-failed";

export type SiteReportResult =
  | { readonly ok: true; readonly url: string }
  | { readonly ok: false; readonly error: SiteReportError };

const VERSION = /^[0-9A-Za-z][0-9A-Za-z._+-]{0,31}$/u;
const CONTEXT_KEYS = new Set(["reason", "hostname", "currentUrl", "extensionVersion", "browser"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyOwnKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
  for (const key in value) if (!Object.hasOwn(value, key)) return false;
  return Object.keys(value).every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return allowed.has(key) && descriptor !== undefined && Object.hasOwn(descriptor, "value");
  });
}

function ownString(value: Record<string, unknown>, key: string): string | undefined {
  if (!Object.hasOwn(value, key)) return undefined;
  return typeof value[key] === "string" ? value[key] : undefined;
}

function validVersion(value: string): boolean {
  return VERSION.test(value);
}

function validSiteUrl(value: string, hostname: string): boolean {
  try {
    const parsed = new URL(value);
    return (parsed.protocol === "http:" || parsed.protocol === "https:")
      && parsed.username === ""
      && parsed.password === ""
      && isCanonicalHostname(parsed.hostname)
      && parsed.hostname === hostname;
  } catch {
    return false;
  }
}

/** Builds the editable public composer URL without performing navigation. */
export function composeSiteReportUrl(context: unknown): string | null {
  if (!isRecord(context) || !hasOnlyOwnKeys(context, CONTEXT_KEYS)) return null;
  const reason = Object.hasOwn(context, "reason") ? context.reason : undefined;
  const hostname = ownString(context, "hostname");
  const currentUrl = ownString(context, "currentUrl");
  const extensionVersion = ownString(context, "extensionVersion");
  const browser = ownString(context, "browser");
  if (reason !== undefined && reason !== "Add support for this site" && reason !== "Dates are not working correctly") return null;
  if (Object.hasOwn(context, "hostname") && (hostname === undefined || !isCanonicalHostname(hostname))) return null;
  if (Object.hasOwn(context, "currentUrl") && (currentUrl === undefined || hostname === undefined || !validSiteUrl(currentUrl, hostname))) return null;
  if (Object.hasOwn(context, "extensionVersion") && (extensionVersion === undefined || !validVersion(extensionVersion))) return null;
  if (Object.hasOwn(context, "browser") && (browser !== "Chrome" && browser !== "Edge" && browser !== "Firefox" && browser !== "Other")) return null;

  const url = new URL(SITE_REPORT_DESTINATION);
  url.searchParams.set("template", SITE_REPORT_TEMPLATE);
  if (reason !== undefined) url.searchParams.set("reason", reason);
  if (hostname !== undefined) url.searchParams.set("hostname", hostname);
  if (currentUrl !== undefined) url.searchParams.set("current_url", currentUrl);
  if (extensionVersion !== undefined) url.searchParams.set("extension_version", extensionVersion);
  if (browser !== undefined) url.searchParams.set("browser", browser);
  return url.toString();
}

export function browserContextFromUserAgent(userAgent: unknown): SiteReportBrowser {
  if (typeof userAgent !== "string") return "Other";
  if (/Firefox\//u.test(userAgent)) return "Firefox";
  if (/Edg\//u.test(userAgent)) return "Edge";
  if (/(?:Chrome|Chromium)\//u.test(userAgent)) return "Chrome";
  return "Other";
}

function extensionVersion(runtime: SiteReportBrowserRuntime): string | null {
  if (!runtime.runtime) return null;
  try {
    const manifest = runtime.runtime.getManifest();
    if (!isRecord(manifest) || !Object.hasOwn(manifest, "version") || typeof manifest.version !== "string" || !validVersion(manifest.version)) return null;
    return manifest.version;
  } catch {
    return null;
  }
}

function environment(runtime: SiteReportBrowserRuntime): Pick<SiteReportContext, "extensionVersion" | "browser"> | null {
  const version = extensionVersion(runtime);
  return version === null ? null : { extensionVersion: version, browser: browserContextFromUserAgent(runtime.navigator?.userAgent) };
}

function validPopupState(value: unknown): value is SiteReportPopupState {
  return isRecord(value)
    && Object.hasOwn(value, "hostname")
    && Object.hasOwn(value, "hasAdapter")
    && typeof value.hostname === "string"
    && isCanonicalHostname(value.hostname)
    && typeof value.hasAdapter === "boolean";
}

function validTab(value: unknown): value is SiteReportTab {
  if (!isRecord(value)) return false;
  for (const key in value) if (!Object.hasOwn(value, key)) return false;
  for (const key of ["url", "incognito"] as const) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !Object.hasOwn(descriptor, "value")) return false;
  }
  return typeof value.url === "string" && typeof value.incognito === "boolean";
}

export interface SiteReportReporter {
  openPopupReport(state: SiteReportPopupState): Promise<SiteReportResult>;
  openOptionsReport(): Promise<SiteReportResult>;
}

export function createSiteReportReporter(runtime: SiteReportBrowserRuntime): SiteReportReporter {
  let inFlight = false;
  const open = async (url: string, windowId?: number): Promise<SiteReportResult> => {
    if (!runtime.tabs) return { ok: false, error: "browser-unavailable" };
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
      if (inFlight) return { ok: false, error: "busy" };
      if (!validPopupState(state)) return { ok: false, error: "invalid-context" };
      if (!runtime.tabs?.query) return { ok: false, error: "browser-unavailable" };
      inFlight = true;
      try {
        let tabs: readonly SiteReportTab[];
        try { tabs = await runtime.tabs.query({ active: true, currentWindow: true }); }
        catch { return { ok: false, error: "missing-tab" }; }
        if (tabs.length !== 1 || !validTab(tabs[0])) return { ok: false, error: "missing-tab" };
        const tab = tabs[0];
        let parsed: URL;
        try { parsed = new URL(tab.url as string); } catch { return { ok: false, error: "restricted-page" }; }
        if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || parsed.username !== "" || parsed.password !== "") return { ok: false, error: "restricted-page" };
        if (!isCanonicalHostname(parsed.hostname)) return { ok: false, error: "restricted-page" };
        if (parsed.hostname !== state.hostname) return { ok: false, error: "hostname-mismatch" };
        const env = environment(runtime);
        if (env === null) return { ok: false, error: "invalid-context" };
        const url = composeSiteReportUrl({ ...env, reason: state.hasAdapter ? "Dates are not working correctly" : "Add support for this site", hostname: state.hostname, currentUrl: tab.url });
        if (url === null) return { ok: false, error: "invalid-context" };
        if (tab.incognito === true) {
          if (!Object.hasOwn(tab, "windowId") || typeof tab.windowId !== "number" || !Number.isSafeInteger(tab.windowId) || tab.windowId < 0) return { ok: false, error: "private-window" };
          return await open(url, tab.windowId);
        }
        return await open(url);
      } finally { inFlight = false; }
    },
    async openOptionsReport(): Promise<SiteReportResult> {
      if (inFlight) return { ok: false, error: "busy" };
      if (!runtime.tabs?.create) return { ok: false, error: "browser-unavailable" };
      inFlight = true;
      try {
        const env = environment(runtime);
        if (env === null) return { ok: false, error: "invalid-context" };
        const url = composeSiteReportUrl(env);
        if (url === null) return { ok: false, error: "invalid-context" };
        return await open(url);
      } finally { inFlight = false; }
    }
  };
}

/**
 * Creates the extension's default reporter without touching browser state.
 * Browser APIs are wrapped here and are only called by an explicit report
 * action inside createSiteReportReporter.
 */
export function createDefaultSiteReportReporter(): SiteReportReporter {
  const browser = typeof chrome === "undefined" ? undefined : chrome;
  const runtime: SiteReportBrowserRuntime = {
    ...(browser?.tabs ? { tabs: {
      query: (query) => browser.tabs.query(query),
      create: (properties) => browser.tabs.create(properties)
    } } : {}),
    ...(browser?.runtime ? { runtime: { getManifest: () => browser.runtime.getManifest() } } : {}),
    ...(typeof navigator === "undefined" ? {} : { navigator: { get userAgent() { return navigator.userAgent; } } })
  };
  return createSiteReportReporter(runtime);
}
