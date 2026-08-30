/**
 * @file Verifies Instagram in-place standard-time extraction behavior.
 */

import { describe, expect, it } from "vitest";

import { genericTimeRule, GENERIC_TIME_RULE_ID } from
    "../../../../src/content-script/adapters/generic-time";
import {
    INSTAGRAM_ADAPTER_ID,
    instagramAdapter,
    matchesInstagramUrl,
} from "../../../../src/content-script/adapters/instagram";
import { defaultRegistry } from "../../../../src/content-script/adapters/registry";
import {
    TIMESTAMP_PRESENTATION_KIND,
    TIMESTAMP_SOURCE_KIND,
    TIMESTAMP_VALIDATION_RULE,
    TIMESTAMP_VISIBILITY_POLICY,
} from "../../../../src/content-script/adapters/types";

import { OWNED_OUTPUT_ATTRIBUTE } from
    "../../../../src/content-script/ownership-markers";

describe("instagramAdapter", () => {
    it.each([
        ["https://www.instagram.com/p/example/", true],
        ["http://www.instagram.com/p/example/", true],
        ["https://instagram.com/p/example/", false],
        ["https://help.instagram.com/", false],
        ["file:///www.instagram.com/p/example/", false],
    ])("matches Instagram URL %s as %s", (value, expected) => {
        expect(matchesInstagramUrl(new URL(value))).toBe(expected);
    });

    it("selects the existing simple text node for in-place presentation", () => {
        document.body.innerHTML = '<time class="timestamp" style="white-space: nowrap" '
            + 'datetime="2026-01-08T18:45:30.000Z">33w</time>';
        const source = document.querySelector("time");
        const target = source?.firstChild;
        if (!source || !(target instanceof Text)) {
            throw new Error("Expected Instagram time label");
        }

        expect(instagramAdapter.extract(source)).toEqual({
            ruleId: INSTAGRAM_ADAPTER_ID,
            source,
            sourceKind: TIMESTAMP_SOURCE_KIND.STANDARD_TIME,
            rawDatetime: "2026-01-08T18:45:30.000Z",
            presentation: {
                kind: TIMESTAMP_PRESENTATION_KIND.IN_PLACE_TEXT,
                target,
            },
            validationRule: TIMESTAMP_VALIDATION_RULE.HTML_GLOBAL,
            visibilityPolicy: TIMESTAMP_VISIBILITY_POLICY.PRESERVE_PAGE_SUPPRESSION,
        });
    });

    it("leaves complex or extension-owned time elements to safe fallback behavior", () => {
        document.body.innerHTML = `
            <time id="complex" datetime="2026-01-08T18:45:30.000Z">
                <span>33w</span>
            </time>
            <time id="owned" datetime="2026-01-08T18:45:30.000Z"
                ${OWNED_OUTPUT_ATTRIBUTE}="token">exact</time>`;
        const complex = document.getElementById("complex");
        const owned = document.getElementById("owned");

        if (!complex || !owned) {
            throw new Error("Expected complex and owned time sources");
        }
        expect(instagramAdapter.extract(complex)).toBeNull();
        expect(instagramAdapter.extract(owned)).toBeNull();
        expect(genericTimeRule.extract(complex)?.presentation.kind).toBe(
            TIMESTAMP_PRESENTATION_KIND.ADJACENT_TIME,
        );
        expect(instagramAdapter.discover(document)).toEqual([complex]);
    });

    it("registers Instagram before the generic fallback", () => {
        expect(
            defaultRegistry.matching(new URL("https://www.instagram.com/p/example/"))
                .map((rule) => rule.id),
        ).toEqual([INSTAGRAM_ADAPTER_ID, GENERIC_TIME_RULE_ID]);
    });
});
