/**
 * @file Verifies the shared theme and its appearance mapping.
 */

import { describe, expect, it } from "vitest";
import { APPEARANCE } from "../../../../src/shared/settings/snapshot";
import {
    NO_MORE_AGO_THEME,
    forcedColorScheme,
} from "../../../../src/shared/ui/theme";

describe("shared theme", () => {
    it("maps each appearance choice to a color-scheme decision", () => {
        expect(forcedColorScheme(APPEARANCE.SYSTEM)).toEqual({});
        expect(forcedColorScheme(APPEARANCE.LIGHT)).toEqual({ forceColorScheme: "light" });
        expect(forcedColorScheme(APPEARANCE.DARK)).toEqual({ forceColorScheme: "dark" });
    });

    it("uses the signal accent as the primary color with a full shade scale", () => {
        expect(NO_MORE_AGO_THEME.primaryColor).toBe("signal");
        expect(NO_MORE_AGO_THEME.colors?.signal).toHaveLength(10);
        expect(NO_MORE_AGO_THEME.fontFamilyMonospace).toContain("JetBrains Mono");
        expect(NO_MORE_AGO_THEME.cursorType).toBe("pointer");
    });
});
