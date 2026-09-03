/**
 * @file Verifies canonical hostname recognition against the snapshot boundary.
 */

import { describe, expect, it } from "vitest";
import { isCanonicalHostname } from "../../../../src/shared/settings/hostname";
import { createSettingsSnapshot } from "../../../../src/shared/settings/snapshot";
import { SITE_SCOPE_MODE, type SiteScopePolicy } from "../../../../src/shared/settings/site-scope";

const excluding = (hostname: string): SiteScopePolicy => ({
    mode: SITE_SCOPE_MODE.ALL_EXCEPT_EXCLUDED,
    excludedSites: [hostname],
    allowedSites: [],
});

describe("canonical hostnames", () => {
    it("recognizes lowercase exact hostnames only", () => {
        expect(isCanonicalHostname("github.com")).toBe(true);
        expect(isCanonicalHostname("EXAMPLE.COM")).toBe(false);
    });

    it.each([
        "example.test",
        "sub.example.test",
        "127.0.0.1",
        "localhost",
        "[::1]",
        "xn--bcher-kva.example",
        "example.test.",
        "__proto__",
        "constructor",
        "tostring",
    ])("accepts canonical exact hostname %s", (hostname) => {
        expect(isCanonicalHostname(hostname)).toBe(true);
        expect(createSettingsSnapshot({
            revision: 0,
            globalEnabled: true,
            siteScope: excluding(hostname),
        })).toMatchObject({ siteScope: { excludedSites: [hostname] } });
    });

    it.each([
        "EXAMPLE.TEST",
        "BÜCHER.example",
        "bücher.example",
        "example.test..",
        "example.test:443",
        "::1",
        "https://example.test",
        "example.test/path",
        "example.test?query",
        "example.test#hash",
        "user:pass@example.test",
        "*.example.test",
        " example.test",
        "example.test ",
    ])("rejects noncanonical intent hostname %s", (hostname) => {
        expect(isCanonicalHostname(hostname)).toBe(false);
        expect(() => createSettingsSnapshot({
            revision: 0,
            globalEnabled: true,
            siteScope: excluding(hostname),
        })).toThrow(TypeError);
    });
});
