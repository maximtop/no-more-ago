/**
 * @file Verifies the Sites entry count renders a correct plural form.
 */

import { describe, expect, it } from "vitest";
import { tPlural } from "../../../src/shared/i18n/translator";

describe("sites entry count", () => {
    it.each([
        [0, "0 sites"],
        [1, "1 site"],
        [2, "2 sites"],
        [7, "7 sites"],
        [1000, "1000 sites"],
    ])("renders %i as %s in English", (count, expected) => {
        expect(tPlural("sites_count", count)).toBe(expected);
    });
});
