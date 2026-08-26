/**
 * @file Verifies custom date-format pattern validation boundaries.
 */

import { describe, expect, it } from "vitest";
import {
    DEFAULT_CUSTOM_FORMAT_PATTERN,
    validateCustomFormatPattern,
} from "../../src/settings/custom-format";

describe("custom format validation", () => {
    it("accepts Unicode date tokens and quoted literals", () => {
        expect(validateCustomFormatPattern(DEFAULT_CUSTOM_FORMAT_PATTERN)).toEqual({
            ok: true,
            pattern: DEFAULT_CUSTOM_FORMAT_PATTERN,
        });
        expect(validateCustomFormatPattern("EEEE, d MMMM yyyy 'at' HH:mm")).toEqual({
            ok: true,
            pattern: "EEEE, d MMMM yyyy 'at' HH:mm",
        });
        expect(validateCustomFormatPattern("do MMMM yyyy")).toEqual({
            ok: true,
            pattern: "do MMMM yyyy",
        });
        expect(validateCustomFormatPattern("t")).toEqual({ ok: true, pattern: "t" });
        expect(validateCustomFormatPattern("yyyy-MM-dd '' HH:mm").ok).toBe(true);
    });

    it.each([
        ["", "empty"],
        ["   ", "empty"],
        ["'literal'", "missing-date-token"],
        ["yyyy-MM-dd '", "unclosed-quote"],
        ["YYYY-MM-dd", "legacy-token"],
        ["YY", "legacy-token"],
        ["DD/MM", "legacy-token"],
        ["D", "legacy-token"],
        ["yyyy ff", "invalid-token"],
        ["yyyy\u0000-MM", "control-character"],
    ] as const)("rejects %s as %s", (pattern, error) => {
        expect(validateCustomFormatPattern(pattern)).toEqual({ ok: false, error });
    });

    it("bounds patterns by UTF-16 units", () => {
        const result = validateCustomFormatPattern(`${"😀".repeat(128)}yyyy`);
        expect(result.ok ? undefined : result.error).toBe("too-long");
    });
});
