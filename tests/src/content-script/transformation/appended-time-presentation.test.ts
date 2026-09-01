/**
 * @file Verifies generated exact time that preserves its page-owned source.
 */

import { describe, expect, it, vi } from "vitest";

import { genericTimeRule } from
    "../../../../src/content-script/adapters/generic-time";
import { AdapterRegistry } from
    "../../../../src/content-script/adapters/registry";
import {
    APPENDED_TIME_PRESENTATION,
    TIMESTAMP_SOURCE_KIND,
    TIMESTAMP_VALIDATION_RULE,
    TIMESTAMP_VISIBILITY_POLICY,
    type TimestampSourceRule,
} from "../../../../src/content-script/adapters/types";
import { processDocument } from
    "../../../../src/content-script/transformation/process-document";
import { restoreTimestampPresentations } from
    "../../../../src/content-script/transformation/render-timestamp-presentation";

describe("appended time presentation", () => {
    it("keeps the source interactive and owns one block sibling", () => {
        document.body.innerHTML = '<section><a id="card" href="/post">'
            + '<img alt="fixture"></a></section>';
        const source = document.getElementById("card");
        if (!(source instanceof HTMLAnchorElement)) {
            throw new Error("Expected card link");
        }
        const listener = vi.fn((event: Event) => {
            event.preventDefault();
        });
        source.addEventListener("click", listener);
        const rule: TimestampSourceRule = {
            id: "appended-test",
            mutationAttributes: [],
            matches: () => true,
            matchesElement: (element) => element === source,
            discover: () => [source],
            isRelativePresentation: () => true,
            extract: () => ({
                ruleId: "appended-test",
                source,
                sourceKind: TIMESTAMP_SOURCE_KIND.STANDARD_TIME,
                rawDatetime: "2026-05-14T16:08:00Z",
                presentation: APPENDED_TIME_PRESENTATION,
                validationRule: TIMESTAMP_VALIDATION_RULE.EXPLICIT_ISO_ZONE,
                visibilityPolicy: TIMESTAMP_VISIBILITY_POLICY.PRESERVE_PAGE_SUPPRESSION,
            }),
        };

        const outputs = processDocument({
            url: new URL("https://example.test/"),
            root: document,
            locales: ["en-US"],
            display: {
                formatMode: "custom",
                pattern: "yyyy-MM-dd HH:mm",
                timeZone: { mode: "utc" },
            },
            registry: new AdapterRegistry([rule], genericTimeRule),
        });

        expect(outputs).toHaveLength(1);
        const output = outputs[0];
        expect(output?.textContent).toBe("2026-05-14 16:08");
        expect(output?.dateTime).toBe("2026-05-14T16:08:00Z");
        expect(output?.style.display).toBe("block");
        expect(source.nextElementSibling).toBe(output);
        expect(source.hasAttribute("hidden")).toBe(false);
        source.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
        expect(listener).toHaveBeenCalledOnce();

        restoreTimestampPresentations(document);
        expect(source.hasAttribute("hidden")).toBe(false);
        expect(source.nextElementSibling).toBeNull();
        expect(document.getElementById("card")).toBe(source);
    });
});
