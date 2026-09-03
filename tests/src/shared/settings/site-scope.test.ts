/**
 * @file Verifies site-scope decisions, transitions, and hostname normalization.
 */

import { describe, expect, it } from "vitest";
import {
    isCanonicalHostname,
    normalizeHostnameInput,
} from "../../../../src/shared/settings/hostname";
import {
    DEFAULT_SITE_SCOPE,
    MAX_SITE_LIST_ENTRIES,
    SITE_SCOPE_MODE,
    isSiteListFull,
    isSiteProcessingEnabled,
    parseSiteScopePolicy,
    withSiteProcessing,
    type SiteScopePolicy,
} from "../../../../src/shared/settings/site-scope";

const scope = (
    mode: SiteScopePolicy["mode"],
    excludedSites: readonly string[] = [],
    allowedSites: readonly string[] = [],
): SiteScopePolicy => ({ mode, excludedSites, allowedSites });

describe("site scope decisions", () => {
    it("processes everything except excluded hostnames by default", () => {
        expect(DEFAULT_SITE_SCOPE.mode).toBe(SITE_SCOPE_MODE.ALL_EXCEPT_EXCLUDED);
        expect(isSiteProcessingEnabled(DEFAULT_SITE_SCOPE, "github.com")).toBe(true);
        expect(
            isSiteProcessingEnabled(
                scope(SITE_SCOPE_MODE.ALL_EXCEPT_EXCLUDED, ["github.com"]),
                "github.com",
            ),
        ).toBe(false);
    });

    it("processes only allowed hostnames in selected-only mode", () => {
        const selected = scope(SITE_SCOPE_MODE.SELECTED_ONLY, ["news.ycombinator.com"], [
            "github.com",
        ]);
        expect(isSiteProcessingEnabled(selected, "github.com")).toBe(true);
        expect(isSiteProcessingEnabled(selected, "news.ycombinator.com")).toBe(false);
        expect(isSiteProcessingEnabled(scope(SITE_SCOPE_MODE.SELECTED_ONLY), "github.com"))
            .toBe(false);
    });
});

describe("site scope transitions", () => {
    it("moves a hostname into and out of the excluded list only", () => {
        const start = scope(SITE_SCOPE_MODE.ALL_EXCEPT_EXCLUDED, [], ["kept.test"]);
        const excluded = withSiteProcessing(start, "github.com", false);
        expect(excluded.excludedSites).toEqual(["github.com"]);
        expect(excluded.allowedSites).toEqual(["kept.test"]);
        expect(withSiteProcessing(excluded, "github.com", true).excludedSites).toEqual([]);
    });

    it("moves a hostname into and out of the allowed list only", () => {
        const start = scope(SITE_SCOPE_MODE.SELECTED_ONLY, ["kept.test"], []);
        const allowed = withSiteProcessing(start, "github.com", true);
        expect(allowed.allowedSites).toEqual(["github.com"]);
        expect(allowed.excludedSites).toEqual(["kept.test"]);
        expect(withSiteProcessing(allowed, "github.com", false).allowedSites).toEqual([]);
    });

    it("never stores a duplicate entry", () => {
        const once = withSiteProcessing(DEFAULT_SITE_SCOPE, "github.com", false);
        expect(withSiteProcessing(once, "github.com", false).excludedSites)
            .toEqual(["github.com"]);
    });
});

describe("site scope validation", () => {
    it("freezes a valid policy and removes duplicates", () => {
        const parsed = parseSiteScopePolicy(
            scope(SITE_SCOPE_MODE.SELECTED_ONLY, [], ["github.com", "github.com"]),
        );
        expect(parsed?.allowedSites).toEqual(["github.com"]);
        expect(Object.isFrozen(parsed)).toBe(true);
    });

    it("rejects a non-canonical hostname in either list", () => {
        expect(parseSiteScopePolicy(
            scope(SITE_SCOPE_MODE.ALL_EXCEPT_EXCLUDED, ["EXAMPLE.COM"]),
        )).toBeNull();
        expect(parseSiteScopePolicy(
            scope(SITE_SCOPE_MODE.SELECTED_ONLY, [], ["https://example.com"]),
        )).toBeNull();
    });
});

describe("site scope list bound", () => {
    const hosts = Array.from({ length: MAX_SITE_LIST_ENTRIES }, (_, index) =>
        `host-${String(index)}.test`);

    it("reports a full list only for a hostname that is not already in it", () => {
        const full = scope(SITE_SCOPE_MODE.ALL_EXCEPT_EXCLUDED, hosts);
        expect(isSiteListFull(full, "new.test")).toBe(true);
        expect(isSiteListFull(full, "host-0.test")).toBe(false);
        expect(isSiteListFull(scope(SITE_SCOPE_MODE.SELECTED_ONLY, hosts), "new.test"))
            .toBe(false);
    });

    it("rejects a list beyond the bound at the snapshot boundary", () => {
        expect(parseSiteScopePolicy(scope(SITE_SCOPE_MODE.ALL_EXCEPT_EXCLUDED, hosts)))
            .not.toBeNull();
        expect(parseSiteScopePolicy(
            scope(SITE_SCOPE_MODE.ALL_EXCEPT_EXCLUDED, [...hosts, "one-more.test"]),
        )).toBeNull();
    });
});

describe("hostname normalization", () => {
    it.each([
        ["  GitHub.COM. ", "github.com"],
        ["例え.テスト", "xn--r8jz45g.xn--zckzah"],
        ["example.com", "example.com"],
    ])("normalizes %s", (input, expected) => {
        const normalized = normalizeHostnameInput(input);
        expect(normalized).toBe(expected);
        expect(isCanonicalHostname(normalized)).toBe(true);
    });

    it.each([
        "https://example.com",
        "example.com/path",
        "example.com:8443",
        "exa mple.com",
    ])("leaves %s rejectable by canonical validation", (input) => {
        expect(isCanonicalHostname(normalizeHostnameInput(input))).toBe(false);
    });
});
