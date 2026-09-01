/**
 * @file Verifies current URL snapshots passed to timestamp extraction.
 */

import { describe, expect, it } from "vitest";

import { genericTimeRule } from
    "../../../../src/content-script/adapters/generic-time";
import { AdapterRegistry } from
    "../../../../src/content-script/adapters/registry";
import {
    ADJACENT_TIME_PRESENTATION,
    TIMESTAMP_SOURCE_ATTRIBUTE,
    TIMESTAMP_SOURCE_KIND,
    TIMESTAMP_VALIDATION_RULE,
    TIMESTAMP_VISIBILITY_POLICY,
    type TimestampSourceRule,
} from "../../../../src/content-script/adapters/types";
import { DocumentTransformationController } from
    "../../../../src/content-script/transformation/document-transformation-controller";

/**
 * Allows mutation delivery and document reconciliation to finish.
 *
 * @returns - Promise settled after queued mutation work.
 */
async function flushMutations(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
}

describe("timestamp extraction URL context", () => {
    it("uses the latest provider value for a reconciled source", async () => {
        document.body.innerHTML = '<span id="source" title="first">2 hours ago</span>';
        const source = document.getElementById("source");
        if (!source) {
            throw new Error("Expected source");
        }
        const seenUrls: string[] = [];
        const rule: TimestampSourceRule = {
            id: "url-context-test",
            mutationAttributes: [TIMESTAMP_SOURCE_ATTRIBUTE.TITLE],
            matches: (url) => url.hostname === "www.tiktok.com",
            matchesElement: (element) => element === source,
            discover: () => [source],
            isRelativePresentation: () => true,
            extract: (element, context) => {
                seenUrls.push(context.url.href);
                return {
                    ruleId: "url-context-test",
                    source: element,
                    sourceKind: TIMESTAMP_SOURCE_KIND.STANDARD_TIME,
                    rawDatetime: "2026-05-14T16:08:00Z",
                    presentation: ADJACENT_TIME_PRESENTATION,
                    validationRule: TIMESTAMP_VALIDATION_RULE.EXPLICIT_ISO_ZONE,
                    visibilityPolicy:
                        TIMESTAMP_VISIBILITY_POLICY.IGNORE_PAGE_SUPPRESSION,
                };
            },
        };
        let currentUrl = new URL(
            "https://www.tiktok.com/@fictional/video/7639779880711749733",
        );
        const controller = new DocumentTransformationController({
            url: currentUrl,
            urlProvider: () => currentUrl,
            root: document,
            locales: ["en-US"],
            registry: new AdapterRegistry([rule], genericTimeRule),
        });

        try {
            controller.start();
            expect(seenUrls.at(-1)).toBe(currentUrl.href);

            currentUrl = new URL(
                "https://www.tiktok.com/@fictional/photo/7590176113704304842",
            );
            source.setAttribute("title", "second");
            await flushMutations();

            expect(seenUrls.at(-1)).toBe(currentUrl.href);
            expect(seenUrls).not.toContain("missing");
        } finally {
            controller.teardown();
        }
    });
});
