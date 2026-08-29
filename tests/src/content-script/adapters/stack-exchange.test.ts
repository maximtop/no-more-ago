/**
 * @file Verifies Stack Exchange URL scope and trusted title-source extraction.
 */

import { describe, expect, it } from "vitest";

import { GENERIC_TIME_RULE_ID } from "../../../../src/content-script/adapters/generic-time";
import { defaultRegistry } from "../../../../src/content-script/adapters/registry";
import {
    STACK_EXCHANGE_ADAPTER_ID,
    matchesStackExchangeUrl,
    stackExchangeAdapter,
} from "../../../../src/content-script/adapters/stack-exchange";
import {
    TIMESTAMP_PRESENTATION_KIND,
    TIMESTAMP_SOURCE_KIND,
    TIMESTAMP_VALIDATION_RULE,
    TIMESTAMP_VISIBILITY_POLICY,
} from "../../../../src/content-script/adapters/types";

describe("Stack Exchange source contract", () => {
    it.each([
        ["https://stackoverflow.com/questions", true],
        ["https://meta.stackoverflow.com/questions", true],
        ["https://ru.stackoverflow.com/questions", true],
        ["https://ru.meta.stackoverflow.com/questions", true],
        ["https://dba.stackexchange.com/questions", true],
        ["https://dba.meta.stackexchange.com/questions", true],
        ["https://meta.stackexchange.com/questions", true],
        ["http://serverfault.com/questions", true],
        ["https://meta.superuser.com/questions", true],
        ["https://askubuntu.com/questions", true],
        ["https://mathoverflow.net/questions", true],
        ["https://stackapps.com/questions", true],
        ["https://stackexchange.com/", false],
        ["https://api.stackexchange.com/", false],
        ["https://area51.stackexchange.com/", false],
        ["https://blog.stackexchange.com/", false],
        ["https://chat.stackexchange.com/", false],
        ["https://contests.stackexchange.com/", false],
        ["https://data.stackexchange.com/", false],
        ["https://openid.stackexchange.com/", false],
        ["https://status.stackexchange.com/", false],
        ["https://chat.stackoverflow.com/", false],
        ["https://docs.serverfault.com/", false],
        ["https://blog.serverfault.com/", false],
        ["https://blog.stackoverflow.com/", false],
        ["https://stackoverflow.blog/", false],
        ["https://stackoverflow.co/", false],
        ["https://stackoverflow.com.evil.test/questions", false],
        ["https://evilstackoverflow.com/questions", false],
        ["ftp://stackoverflow.com/questions", false],
    ])("matches %s as %s", (value, expected) => {
        expect(matchesStackExchangeUrl(new URL(value))).toBe(expected);
    });

    it("exports a stable source identifier", () => {
        expect(STACK_EXCHANGE_ADAPTER_ID).toBe("stack-exchange");
    });

    it("discovers only approved title-bearing source shapes", () => {
        document.body.innerHTML = `
            <span id="relative" class="relativetime" title="2026-08-29 13:39:19Z">
                1 min ago
            </span>
            <span id="comment" class="relativetime-clean"
                  title="2021-03-31 09:07:05Z, License: CC BY-SA 4.0">
                Mar 31, 2021 at 9:07
            </span>
            <time id="card" class="s-user-card--time" title="2020-07-12T23:52:48.26Z">
                Over a year ago
            </time>
            <a id="activity" href="?lastactivity" title="2026-04-08 05:35:32Z">
                4 months ago
            </a>
            <time class="s-user-card--time" title="2026-08-29T10:00:00Z"
                  datetime="2026-08-29T10:00:00Z">generic</time>
            <span class="other" title="2026-08-29T10:00:00Z">other</span>
            <a href="?lastactivity=1" title="2026-08-29T10:00:00Z">other link</a>`;
        const approvedIds = ["relative", "comment", "card", "activity"];
        const approved = approvedIds.map((id) => document.getElementById(id));

        expect(stackExchangeAdapter.discover(document)).toEqual(approved);
        const relative = document.getElementById("relative");
        if (!relative) {
            throw new Error("Expected relative timestamp source");
        }
        expect(stackExchangeAdapter.discover(relative)).toEqual([relative]);
    });

    it.each([
        {
            id: "relative",
            markup: '<span id="relative" class="relativetime" '
                + 'title="2026-08-29 13:39:19Z">1 min ago</span>',
            rawDatetime: "2026-08-29 13:39:19Z",
        },
        {
            id: "comment",
            markup: '<span id="comment" class="relativetime-clean" '
                + 'title="2021-03-31 09:07:05Z, License: CC BY-SA 4.0">commented</span>',
            rawDatetime: "2021-03-31 09:07:05Z",
        },
        {
            id: "card",
            markup: '<time id="card" class="s-user-card--time" '
                + 'title="2020-07-12T23:52:48.26Z">Over a year ago</time>',
            rawDatetime: "2020-07-12T23:52:48.26Z",
        },
        {
            id: "activity",
            markup: '<a id="activity" href="?lastactivity" '
                + 'title="2026-04-08 05:35:32Z">4 months ago</a>',
            rawDatetime: "2026-04-08 05:35:32Z",
        },
    ])("extracts the simple text target from $id", ({ id, markup, rawDatetime }) => {
        document.body.innerHTML = markup;
        const source = document.getElementById(id);
        const target = source?.firstChild;
        if (!source || !(target instanceof Text)) {
            throw new Error("Expected a simple Stack Exchange timestamp label");
        }

        expect(stackExchangeAdapter.extract(source)).toEqual({
            ruleId: STACK_EXCHANGE_ADAPTER_ID,
            source,
            sourceKind: TIMESTAMP_SOURCE_KIND.STACK_EXCHANGE_TIMESTAMP,
            rawDatetime,
            presentation: {
                kind: TIMESTAMP_PRESENTATION_KIND.IN_PLACE_TEXT,
                target,
            },
            validationRule: TIMESTAMP_VALIDATION_RULE.EXPLICIT_ISO_ZONE,
            visibilityPolicy: TIMESTAMP_VISIBILITY_POLICY.IGNORE_PAGE_SUPPRESSION,
        });
    });

    it("rejects unsupported licenses, ambiguous labels, and generic time sources", () => {
        document.body.innerHTML = `
            <span id="license" class="relativetime-clean"
                  title="2021-03-31 09:07:05Z, License: CC BY-SA 5.0">commented</span>
            <span id="complex" class="relativetime" title="2026-08-29 13:39:19Z">
                <strong>relative</strong>
            </span>
            <time id="generic" class="s-user-card--time"
                  title="2026-08-29T10:00:00Z"
                  datetime="2026-08-29T10:00:00Z">generic</time>`;

        for (const id of ["license", "complex", "generic"]) {
            const source = document.getElementById(id);
            expect(source ? stackExchangeAdapter.extract(source) : null).toBeNull();
        }
    });

    it("registers Stack Exchange before the generic fallback", () => {
        expect(
            defaultRegistry.matching(new URL("https://stackoverflow.com/questions"))
                .map((rule) => rule.id),
        ).toEqual([STACK_EXCHANGE_ADAPTER_ID, GENERIC_TIME_RULE_ID]);
    });
});
