/**
 * @file Verifies the trusted site-adapter contract and architecture boundaries.
 */

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { githubAdapter } from "../../src/content-script/adapters/github";
import { defaultRegistry } from "../../src/content-script/adapters/registry";
import {
    resolveTrustedTimestamp,
} from "../../src/content-script/transformation/resolve-trusted-timestamp";
import { EXPLICIT_ZONED_DATETIME_RULE } from "../../src/content-script/adapters/types";
import {
    SYNTHETIC_HOSTNAME,
    SYNTHETIC_SELECTOR,
    createSyntheticRegistry,
    syntheticAdapter,
} from "../fixtures/synthetic/adapter";

const fixture = readFileSync("tests/fixtures/synthetic/site.html", "utf8");

const adapters = [
    { name: "github", adapter: githubAdapter, hostname: "github.com" },
    { name: "synthetic", adapter: syntheticAdapter, hostname: SYNTHETIC_HOSTNAME },
] as const;

describe.each(adapters)("shared adapter contract: $name", ({ adapter, hostname }) => {
    const sourceMarkup = (content: string, datetime?: string): string => {
        if (adapter === syntheticAdapter) {
            const attribute = datetime === undefined ? "" : ` datetime="${datetime}"`;
            return `<time-ago class="synthetic-event"${attribute}>${content}</time-ago>`;
        }
        const attribute = datetime === undefined ? "" : ` datetime="${datetime}"`;
        return `<relative-time${attribute}>${content}</relative-time>`;
    };

    it("matches only its exact HTTP(S) hostname", () => {
        expect(adapter.matches(new URL(`https://${hostname}/path`))).toBe(true);
        expect(adapter.matches(new URL(`http://${hostname}/path`))).toBe(true);
        expect(adapter.matches(new URL(`https://www.${hostname}/path`))).toBe(false);
        expect(adapter.matches(new URL(`https://sub.${hostname}/path`))).toBe(false);
        expect(adapter.matches(new URL(`ftp://${hostname}/path`))).toBe(false);
    });

    it("discovers an eligible root and descendants without duplicate discovery", () => {
        document.body.innerHTML = sourceMarkup("root");
        const root = document.body.firstElementChild;
        if (!root) {
            throw new Error("Expected fixture root");
        }
        expect(adapter.discover(root)).toEqual([root]);

        document.body.innerHTML = `<section>${sourceMarkup("one")}${sourceMarkup("two")}</section>`;
        const section = document.body.firstElementChild;
        if (!section) {
            throw new Error("Expected fixture section");
        }
        const discovered = adapter.discover(section);
        expect(discovered).toHaveLength(2);
        expect(new Set(discovered).size).toBe(2);
    });

    it("returns the approved source identity and explicit datetime rule", () => {
        document.body.innerHTML = sourceMarkup("visible relative text", "2026-08-25T10:15:00Z");
        const element = document.body.firstElementChild;
        if (!element) {
            throw new Error("Expected source element");
        }
        const candidate = adapter.extract(element);
        expect(candidate).toMatchObject({
            adapterId: adapter.id,
            sourceKind: adapter === syntheticAdapter ? "time-ago" : "relative-time",
            rawDatetime: "2026-08-25T10:15:00Z",
            timestampRule: EXPLICIT_ZONED_DATETIME_RULE,
        });
        expect(candidate && resolveTrustedTimestamp(candidate)?.instant.toISOString()).toBe(
            "2026-08-25T10:15:00.000Z",
        );
    });
});

describe("synthetic adapter extraction boundary", () => {
    it("uses only its explicit selector and datetime attribute", () => {
        document.body.innerHTML = fixture;
        const discovered = syntheticAdapter.discover(document);
        expect(discovered).toHaveLength(5);
        expect(discovered.every((element) => element.matches(SYNTHETIC_SELECTOR))).toBe(true);
        const generic = document.querySelector("span[data-datetime]");
        const unmarked = document.querySelector("time-ago:not([class])");
        expect(generic ? syntheticAdapter.extract(generic) : null).toBeNull();
        expect(unmarked ? syntheticAdapter.extract(unmarked) : null).toBeNull();
    });

    it.each([
        ["missing", '<time-ago class="synthetic-event">relative</time-ago>', false],
        [
            "relative",
            '<time-ago class="synthetic-event" datetime="yesterday">relative</time-ago>',
            false,
        ],
        [
            "zone-less",
            '<time-ago class="synthetic-event" datetime="2026-08-25T10:15:00">today</time-ago>',
            false,
        ],
        [
            "ambiguous",
            '<time-ago class="synthetic-event" datetime="2026-13-99T99:99:99Z">invalid</time-ago>',
            false,
        ],
        [
            "valid",
            '<time-ago class="synthetic-event" datetime="2026-08-25T10:15:00+02:00">'
                + "valid</time-ago>",
            true,
        ],
    ] as const)(
        "safely handles %s datetime through the shared resolver",
        (_name, markup, valid) => {
            document.body.innerHTML = markup;
            const element = document.body.firstElementChild;
            if (!element) {
                throw new Error("Expected source element");
            }
            const candidate = syntheticAdapter.extract(element);
            const resolved = candidate ? resolveTrustedTimestamp(candidate) : null;
            expect(resolved !== null).toBe(valid);
        },
    );

    it("ignores title, aria-label, data attributes, visible text, and non-candidates", () => {
        document.body.innerHTML = `
      <time-ago title="2026-08-25T10:15:00Z" aria-label="2026-08-25T10:15:00Z"
        data-datetime="2026-08-25T10:15:00Z">relative</time-ago>
      <time-ago class="synthetic-event" title="2026-08-25T10:15:00Z"
        aria-label="2026-08-25T10:15:00Z"
        data-datetime="2026-08-25T10:15:00Z">relative</time-ago>
      <div data-datetime="2026-08-25T10:15:00Z">relative</div>`;
        const [generic, explicit, div] = [...document.body.children];
        expect(generic && syntheticAdapter.extract(generic)).toBeNull();
        expect(explicit && syntheticAdapter.extract(explicit)).toBeNull();
        expect(div && syntheticAdapter.extract(div)).toBeNull();
    });
});

describe("test-only synthetic registry boundary", () => {
    it(
        "keeps production discovery GitHub-only while an injected registry selects synthetic.test",
        () => {
            expect(defaultRegistry.select(new URL("https://synthetic.test/example"))).toBeNull();
            expect(
                createSyntheticRegistry().select(new URL("https://synthetic.test/example"))?.id,
            ).toBe("synthetic");
            expect(
                createSyntheticRegistry().select(new URL("https://github.com/example"))?.id,
            ).toBe("github");
        },
    );
});
