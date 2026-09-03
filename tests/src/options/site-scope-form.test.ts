/**
 * @file Verifies hostname form validation and per-mode Sites copy.
 */

import { describe, expect, it } from "vitest";
import { SITE_SCOPE_MODE } from "../../../src/shared/settings/site-scope";
import {
    activeListCopy,
    validateHostnameEntry,
} from "../../../src/options/site-scope-form";

describe("hostname entry validation", () => {
    it("accepts and normalizes a hostname that is not already listed", () => {
        expect(validateHostnameEntry("  GitHub.COM. ", ["example.test"]))
            .toEqual({ ok: true, hostname: "github.com" });
        expect(validateHostnameEntry("例え.テスト", []))
            .toEqual({ ok: true, hostname: "xn--r8jz45g.xn--zckzah" });
    });

    it.each([
        ["", "Enter a hostname."],
        ["https://example.com", "Use an exact hostname without a scheme, port, or path."],
        ["example.com/path", "Use an exact hostname without a scheme, port, or path."],
        ["*.example.com", "Use an exact hostname without a scheme, port, or path."],
    ])("rejects %s", (input, message) => {
        expect(validateHostnameEntry(input, [])).toEqual({ ok: false, error: message });
    });

    it("rejects a hostname already present in the active list", () => {
        expect(validateHostnameEntry("github.com", ["github.com"]))
            .toEqual({ ok: false, error: "This hostname is already in the list." });
    });
});

describe("active list copy", () => {
    it("names the excluded list and its actions", () => {
        expect(activeListCopy(SITE_SCOPE_MODE.ALL_EXCEPT_EXCLUDED)).toEqual({
            title: "Excluded sites",
            description: "The extension stays off on these exact hostnames.",
            fieldLabel: "Exclude hostname",
            submitLabel: "Exclude site",
            removalEffect: "Removing a hostname lets the extension run on it again.",
            emptyState: "No sites are excluded.",
            addEnables: false,
        });
    });

    it("names the allowed list and its actions", () => {
        expect(activeListCopy(SITE_SCOPE_MODE.SELECTED_ONLY)).toEqual({
            title: "Allowed sites",
            description: "The extension runs only on these exact hostnames.",
            fieldLabel: "Allow hostname",
            submitLabel: "Allow site",
            removalEffect: "Removing a hostname turns the extension off on it again.",
            emptyState: "No sites are allowed yet. The extension will stay off on every site "
                + "until one is added.",
            addEnables: true,
        });
    });
});
