/**
 * @file Verifies document transformation controller activation and reconciliation.
 */

import { describe, expect, it, vi } from "vitest";
/* eslint-disable @typescript-eslint/require-await */

import {
    BLUESKY_LOOKUP_STATUS,
    type BlueskyAppView,
} from "../../../../src/content-script/adapters/bluesky-appview";
import {
    createBlueskyCoordinator,
} from "../../../../src/content-script/adapters/bluesky-coordinator";
import { genericTimeRule } from "../../../../src/content-script/adapters/generic-time";
import { hackerNewsAdapter } from "../../../../src/content-script/adapters/hacker-news";
import { linkedinAdapter } from "../../../../src/content-script/adapters/linkedin";
import { AdapterRegistry } from "../../../../src/content-script/adapters/registry";
import {
    ADJACENT_TIME_PRESENTATION,
    TIMESTAMP_SOURCE_ATTRIBUTE,
    TIMESTAMP_SOURCE_KIND,
    TIMESTAMP_VALIDATION_RULE,
    TIMESTAMP_VISIBILITY_POLICY,
    type TimestampSourceRule,
} from "../../../../src/content-script/adapters/types";
import {
    DocumentTransformationController,
} from "../../../../src/content-script/transformation/document-transformation-controller";
import type {
    DocumentTransformationParticipantFactory,
} from "../../../../src/content-script/transformation/document-transformation-participant";
import { formatDefaultDate } from "../../../../src/shared/date/format-default-date";
import type { DisplaySettings } from "../../../../src/shared/settings/snapshot";
import {
    DOCUMENT_ROUTE_HANDOFF_TRANSITION,
    type DocumentRouteHandoffPolicy,
    type DocumentRouteHandoffSession,
} from "../../../../src/content-script/transformation/route-handoff";

const noMatchRule: TimestampSourceRule = {
    id: "no-match",
    mutationAttributes: [],
    matches: () => false,
    matchesElement: () => false,
    discover: () => [],
    isRelativePresentation: () => true,
    extract: () => null,
};

/**
 * Composes one Bluesky participant for a controller test URL.
 *
 * @param appView - Deterministic AppView capability.
 * @param url - Document URL owned by the participant.
 * @returns - Generic document-participant factory.
 */
function blueskyParticipantFactory(
    appView: BlueskyAppView,
    url: URL,
): DocumentTransformationParticipantFactory {
    return (host) => createBlueskyCoordinator({
        document,
        url,
        appView,
        getDiagnosticSink: host.getDiagnosticSink,
        onSourcesChanged: host.onSourcesChanged,
    });
}

/**
 * Generic timestamp fixture shared by visibility lifecycle tests.
 */
interface GenericControllerFixture {
    /**
     * Generic source in the fixture document.
     */
    readonly source: HTMLTimeElement;

    /**
     * Controller attached to the fixture document.
     */
    readonly controller: DocumentTransformationController;
}

/**
 * Creates a generic source and controller for a visibility behavior test.
 *
 * @param markup - Body markup containing one generic HTML time source.
 * @returns - Source and controller sharing the fixture document.
 */
function createGenericControllerFixture(
    markup = '<time datetime="2026-08-23T10:15Z">2 hours ago</time>',
): GenericControllerFixture {
    document.body.innerHTML = markup;
    const source = document.querySelector("time");
    if (!(source instanceof HTMLTimeElement)) {
        throw new Error("Expected generic source");
    }
    return {
        source,
        controller: new DocumentTransformationController({
            url: new URL("https://example.test/"),
            root: document,
            locales: ["en-US"],
        }),
    };
}

describe("DocumentTransformationController", () => {
    const flushMutations = async (): Promise<void> => {
        await Promise.resolve();
        await Promise.resolve();
    };

    it("restores and reclaims a source as its page label changes mode", async () => {
        document.documentElement.lang = "en";
        document.body.innerHTML =
            '<time datetime="2026-08-23T10:15:00Z">2 hours ago</time>';
        const source = document.querySelector("time");
        if (!source) {
            throw new Error("Expected source");
        }
        const label = source.firstChild;
        if (!(label instanceof Text)) {
            throw new Error("Expected source label");
        }
        const controller = new DocumentTransformationController({
            root: document,
            url: new URL("https://example.test/"),
            locales: ["en-US"],
        });
        try {
            controller.start();
            expect(source.nextElementSibling).toBeInstanceOf(HTMLTimeElement);

            label.data = "Aug 23, 2026";
            await flushMutations();
            expect(source.textContent).toBe("Aug 23, 2026");
            expect(source.nextElementSibling).toBeNull();

            label.data = "2 hours ago";
            await flushMutations();
            expect(source.nextElementSibling).toBeInstanceOf(HTMLTimeElement);
            expect(document.querySelectorAll("[data-no-more-ago-output]"))
                .toHaveLength(1);
        } finally {
            controller.teardown();
            document.documentElement.removeAttribute("lang");
        }
    });

    it("bounds inherited-language changes to their subtree", async () => {
        document.documentElement.lang = "en";
        document.body.innerHTML = `
            <section id="changed">
                <time datetime="2026-08-23T10:15:00Z">2 hours ago</time>
            </section>
            <section id="unchanged">
                <time datetime="2026-08-22T10:15:00Z">3 hours ago</time>
            </section>
        `;
        const changedRoot = document.getElementById("changed");
        const sources = document.querySelectorAll("time");
        const changedSource = sources[0];
        const unchangedSource = sources[1];
        const changedLabel = changedSource?.firstChild;
        if (
            !changedRoot
            || !(changedSource instanceof HTMLTimeElement)
            || !(unchangedSource instanceof HTMLTimeElement)
            || !(changedLabel instanceof Text)
        ) {
            throw new Error("Expected language-change fixture");
        }
        const controller = new DocumentTransformationController({
            root: document,
            url: new URL("https://example.test/"),
            locales: ["en-US"],
        });
        const discover = vi.spyOn(genericTimeRule, "discover");
        try {
            controller.start();
            const unchangedOutput = unchangedSource.nextElementSibling;
            expect(unchangedOutput).toBeInstanceOf(HTMLTimeElement);
            discover.mockClear();

            changedRoot.lang = "zz";
            await flushMutations();
            expect(changedSource.nextElementSibling).toBeNull();
            expect(unchangedSource.nextElementSibling).toBe(unchangedOutput);
            expect(discover).toHaveBeenCalledWith(changedRoot, expect.any(Object));
            expect(discover.mock.calls.every(([root]) => root === changedRoot))
                .toBe(true);
            discover.mockClear();

            changedLabel.data = "2 godziny temu";
            changedRoot.lang = "pl";
            await flushMutations();
            expect(changedSource.nextElementSibling).toBeInstanceOf(HTMLTimeElement);
            expect(unchangedSource.nextElementSibling).toBe(unchangedOutput);
            expect(document.querySelectorAll("[data-no-more-ago-output]"))
                .toHaveLength(2);
        } finally {
            controller.teardown();
            discover.mockRestore();
            document.documentElement.removeAttribute("lang");
        }
    });

    it("resolves Bluesky in place after startup and restores exact page content", async () => {
        document.head.innerHTML = '<base href="https://bsky.app/">';
        document.body.innerHTML = `<article><a id="bluesky-controller-source"
            href="/profile/alice.example/post/3controller"
            aria-label="localized date" data-tooltip="localized date">
            <span aria-hidden="true">· </span>2h</a></article>`;
        const source = document.getElementById("bluesky-controller-source");
        const target = source?.lastChild;
        if (!source || !(target instanceof Text)) {
            throw new Error("Expected Bluesky controller source");
        }
        const attributes = [...source.attributes].map(({ name, value }) => [name, value]);
        const getProfiles = vi.fn<BlueskyAppView["getProfiles"]>(async (actors) => ({
            status: BLUESKY_LOOKUP_STATUS.SUCCESS,
            records: actors.map((actor) => ({ actor, did: "did:plc:alice" })),
        }));
        const getPosts = vi.fn<BlueskyAppView["getPosts"]>(async (uris) => ({
            status: BLUESKY_LOOKUP_STATUS.SUCCESS,
            records: uris.map((uri) => ({
                uri,
                indexedAt: "2026-08-31T10:15:00.000Z",
            })),
        }));
        const appView: BlueskyAppView = { getProfiles, getPosts };
        const url = new URL("https://bsky.app/");
        const controller = new DocumentTransformationController({
            url,
            root: document,
            locales: ["en-US"],
            display: {
                formatMode: "custom",
                pattern: "yyyy-MM-dd HH:mm",
                timeZone: { mode: "utc" },
            },
            participantFactory: blueskyParticipantFactory(appView, url),
        });

        expect(controller.start()).toEqual([]);
        expect(target.data).toBe("2h");
        await vi.waitFor(() => {
            expect(target.data).toBe("2026-08-31 10:15");
        });
        expect([...source.attributes].map(({ name, value }) => [name, value]))
            .toEqual(attributes);
        expect(document.querySelector("time[data-no-more-ago-output]")).toBeNull();

        controller.teardown();
        expect(target.data).toBe("2h");
        expect(document.getElementById("bluesky-controller-source")).toBe(source);
    });

    it("never calls Bluesky enrichment on another host", async () => {
        document.body.innerHTML = '<time datetime="2026-08-31T10:15:00Z">relative</time>';
        const getProfiles = vi.fn<BlueskyAppView["getProfiles"]>();
        const getPosts = vi.fn<BlueskyAppView["getPosts"]>();
        const url = new URL("https://example.test/");
        const controller = new DocumentTransformationController({
            url,
            root: document,
            locales: ["en-US"],
            participantFactory: blueskyParticipantFactory(
                { getProfiles, getPosts },
                url,
            ),
        });

        controller.start();
        await flushMutations();
        expect(getProfiles).not.toHaveBeenCalled();
        expect(getPosts).not.toHaveBeenCalled();
        controller.teardown();
    });

    it("keeps a frozen participant input reusable", () => {
        const participant = {
            rule: noMatchRule,
            start: vi.fn(),
            inspect: vi.fn(),
            inspectSources: vi.fn(),
            release: vi.fn(),
            stop: vi.fn(),
        };
        const participantFactory = vi.fn(() => participant);
        const input = Object.freeze({
            url: new URL("https://example.test/"),
            root: document,
            locales: ["en-US"],
            participantFactory,
        });

        expect(() => {
            new DocumentTransformationController(input);
            new DocumentTransformationController(input);
        }).not.toThrow();
        expect(participantFactory).toHaveBeenCalledTimes(2);
        expect(Object.keys(input)).not.toContain("registry");
    });

    it("reconciles a LinkedIn source when descendant ID evidence changes", async () => {
        document.body.innerHTML = `
            <main id="feed">
                <article id="post">
                    <p componentkey="timestamp"><span>1w •</span></p>
                    <a id="evidence"
                        href="/feed/update/urn:li:activity:7147784590025818113/">
                        Post
                    </a>
                </article>
                <section id="unrelated">
                    <a id="unrelated-link" href="/profile">unchanged</a>
                </section>
            </main>
        `;
        const unrelated = document.getElementById("unrelated");
        const unrelatedChild = unrelated?.firstElementChild;
        const unrelatedLink = document.getElementById("unrelated-link");
        const evidence = document.getElementById("evidence");
        const target = document.querySelector("p > span")?.firstChild;
        if (
            !(evidence instanceof HTMLAnchorElement)
            || !(unrelatedLink instanceof HTMLAnchorElement)
            || !(target instanceof Text)
        ) {
            throw new Error("Expected LinkedIn fixture");
        }
        const visits: Element[] = [];
        const matchVisits: Element[] = [];
        const instrumented: TimestampSourceRule = {
            ...linkedinAdapter,
            matchesElement: (element, context) => {
                matchVisits.push(element);
                return linkedinAdapter.matchesElement(element, context);
            },
            extract: (element, context) => {
                visits.push(element);
                return linkedinAdapter.extract(element, context);
            },
        };
        const controller = new DocumentTransformationController({
            url: new URL("https://www.linkedin.com/feed/"),
            root: document,
            locales: ["en-GB"],
            display: {
                formatMode: "custom",
                pattern: "yyyy-MM-dd",
                timeZone: { mode: "utc" },
            },
            registry: new AdapterRegistry([instrumented], genericTimeRule),
        });

        controller.start();
        expect(target.data).toBe("2024-01-02 •");
        visits.length = 0;
        matchVisits.length = 0;

        unrelatedLink.href = "/profile/changed";
        await flushMutations();

        expect(matchVisits).toEqual([]);
        expect(target.data).toBe("2024-01-02 •");

        evidence.href = "/feed/update/urn:li:share:7170283349280292867/";
        await flushMutations();

        expect(target.data).toBe("2024-03-04 •");
        expect(visits).toEqual([document.getElementById("post")]);
        expect(matchVisits).toEqual([]);
        expect(document.getElementById("unrelated")).toBe(unrelated);
        expect(unrelated?.firstElementChild).toBe(unrelatedChild);

        evidence.href = "/feed/update/urn:li:activity:malformed/";
        await flushMutations();
        expect(target.data).toBe("1w •");

        evidence.href = "/feed/update/urn:li:activity:7147784590025818113/";
        await flushMutations();
        expect(target.data).toBe("2024-01-02 •");

        controller.teardown();
        expect(target.data).toBe("1w •");
    });

    it("uses ancestor matching when an optional custom mapper delegates", async () => {
        document.body.innerHTML = '<div id="source"><span id="evidence">pending</span></div>';
        const source = document.getElementById("source");
        const evidence = document.getElementById("evidence");
        if (!source || !evidence) {
            throw new Error("Expected delegated mapper fixture");
        }
        const rule: TimestampSourceRule = {
            id: "delegating-mapper",
            mutationAttributes: [TIMESTAMP_SOURCE_ATTRIBUTE.TITLE],
            matches: () => true,
            matchesElement: (element) => element === source,
            getMutationSources: () => [],
            discover: () => [source],
            isRelativePresentation: () => true,
            extract: (element) => evidence.title === "ready"
                ? {
                    ruleId: "delegating-mapper",
                    source: element,
                    sourceKind: TIMESTAMP_SOURCE_KIND.STANDARD_TIME,
                    rawDatetime: "2026-08-23T10:15:00Z",
                    presentation: ADJACENT_TIME_PRESENTATION,
                    validationRule: TIMESTAMP_VALIDATION_RULE.EXPLICIT_ISO_ZONE,
                    visibilityPolicy:
                        TIMESTAMP_VISIBILITY_POLICY.IGNORE_PAGE_SUPPRESSION,
                }
                : null,
        };
        const controller = new DocumentTransformationController({
            url: new URL("https://example.test/"),
            root: document,
            locales: ["en-US"],
            registry: new AdapterRegistry([rule], noMatchRule),
        });

        controller.start();
        expect(source.nextElementSibling).toBeNull();

        evidence.title = "ready";
        await flushMutations();

        expect(source.nextElementSibling).toBeInstanceOf(HTMLTimeElement);
        controller.teardown();
    });

    it("keeps character-data observation off the document-wide observer", () => {
        document.body.innerHTML = "<main></main>";
        const observe = vi.spyOn(MutationObserver.prototype, "observe");
        const controller = new DocumentTransformationController({
            url: new URL("https://example.test/"),
            root: document,
            locales: ["en-US"],
        });

        try {
            controller.start();
            const documentOptions = (): MutationObserverInit | undefined =>
                observe.mock.calls.filter(([target]) => target === document).at(-1)?.[1];
            expect(documentOptions()?.characterData).toBeUndefined();
            expect(documentOptions()?.characterDataOldValue).toBeUndefined();

            controller.reconcileRoute(new URL("https://www.linkedin.com/feed/"));
            expect(documentOptions()?.characterData).toBeUndefined();
            expect(documentOptions()?.characterDataOldValue).toBeUndefined();

            controller.reconcileRoute(new URL("https://example.test/next"));
            expect(documentOptions()?.characterData).toBeUndefined();
            expect(documentOptions()?.characterDataOldValue).toBeUndefined();
        } finally {
            controller.teardown();
            observe.mockRestore();
        }
    });

    it("activates an unowned LinkedIn source when ambiguity is removed", async () => {
        document.body.innerHTML = `
            <article id="post">
                <p componentkey="timestamp"><span>1w</span></p>
                <div data-urn="urn:li:activity:7147784590025818113"></div>
                <div id="competitor" data-urn="urn:li:share:7170283349280292867"></div>
            </article>
        `;
        const target = document.querySelector("p > span")?.firstChild;
        const competitor = document.getElementById("competitor");
        if (!(target instanceof Text) || !competitor) {
            throw new Error("Expected ambiguous LinkedIn fixture");
        }
        const controller = new DocumentTransformationController({
            url: new URL("https://www.linkedin.com/feed/"),
            root: document,
            locales: ["en-GB"],
            display: {
                formatMode: "custom",
                pattern: "yyyy-MM-dd",
                timeZone: { mode: "utc" },
            },
        });

        controller.start();
        expect(target.data).toBe("1w");

        competitor.removeAttribute("data-urn");
        await flushMutations();

        expect(target.data).toBe("2024-01-02");
        controller.teardown();
    });

    it("keeps an owned outer LinkedIn post valid when a nested reply is inserted", async () => {
        document.body.innerHTML = `
            <article id="post" data-urn="urn:li:activity:7147784590025818113">
                <header>
                    <p componentkey="post-time"><span id="post-label">1w</span></p>
                </header>
            </article>
        `;
        const post = document.getElementById("post");
        const postTarget = document.getElementById("post-label")?.firstChild;
        if (!post || !(postTarget instanceof Text)) {
            throw new Error("Expected outer LinkedIn post fixture");
        }
        const controller = new DocumentTransformationController({
            url: new URL("https://www.linkedin.com/feed/"),
            root: document,
            locales: ["en-GB"],
            display: {
                formatMode: "custom",
                pattern: "yyyy-MM-dd",
                timeZone: { mode: "utc" },
            },
        });

        controller.start();
        expect(postTarget.data).toBe("2024-01-02");

        const reply = document.createElement("article");
        reply.innerHTML = `
            <p componentkey="reply-time"><span id="reply-label">3d</span></p>
            <div data-sdui-anchor-id=
                "comment-urn:li:comment:(ugcPost:1,7181895116414517252)::0">
            </div>
        `;
        post.append(reply);
        await flushMutations();

        expect(postTarget.data).toBe("2024-01-02");
        expect(document.getElementById("reply-label")?.textContent).toBe("2024-04-05");
        controller.teardown();
    });

    it("keeps an outer post independent when a nested reply becomes ambiguous", async () => {
        document.body.innerHTML = `
            <article id="post" data-urn="urn:li:activity:7147784590025818113">
                <p componentkey="post-time"><span id="post-label">1w</span></p>
                <article id="reply">
                    <p componentkey="reply-time"><span id="reply-label">3d</span></p>
                    <div data-sdui-anchor-id=
                        "comment-urn:li:comment:(ugcPost:1,7181895116414517252)::0">
                    </div>
                </article>
            </article>
        `;
        const postTarget = document.getElementById("post-label")?.firstChild;
        const replyTarget = document.getElementById("reply-label")?.firstChild;
        const reply = document.getElementById("reply");
        if (!(postTarget instanceof Text) || !(replyTarget instanceof Text) || !reply) {
            throw new Error("Expected nested LinkedIn ambiguity fixture");
        }
        const controller = new DocumentTransformationController({
            url: new URL("https://www.linkedin.com/feed/"),
            root: document,
            locales: ["en-GB"],
            display: {
                formatMode: "custom",
                pattern: "yyyy-MM-dd",
                timeZone: { mode: "utc" },
            },
        });

        controller.start();
        expect(postTarget.data).toBe("2024-01-02");
        expect(replyTarget.data).toBe("2024-04-05");

        reply.setAttribute("data-urn", "urn:li:share:7170283349280292867");
        await flushMutations();
        expect(replyTarget.data).toBe("3d");
        expect(postTarget.data).toBe("2024-01-02");

        controller.reformatOwned();
        expect(postTarget.data).toBe("2024-01-02");
        controller.teardown();
    });

    it("discovers a LinkedIn source after only its label text becomes eligible", async () => {
        document.body.innerHTML = `
            <article>
                <p componentkey="post-time"><span id="label">Loading</span></p>
                <div data-urn="urn:li:activity:7147784590025818113"></div>
            </article>
        `;
        const target = document.getElementById("label")?.firstChild;
        if (!(target instanceof Text)) {
            throw new Error("Expected loading LinkedIn label");
        }
        const controller = new DocumentTransformationController({
            url: new URL("https://www.linkedin.com/feed/"),
            root: document,
            locales: ["en-GB"],
            display: {
                formatMode: "custom",
                pattern: "yyyy-MM-dd",
                timeZone: { mode: "utc" },
            },
        });

        controller.start();
        target.data = "1w";
        await flushMutations();

        expect(target.data).toBe("2024-01-02");
        controller.teardown();
    });

    it("coalesces LinkedIn page text and evidence changes into one reconciliation", async () => {
        document.body.innerHTML = `
            <article>
                <p componentkey="post-time"><span id="label">1w •</span></p>
                <a id="evidence"
                    href="/feed/update/urn:li:activity:7147784590025818113/">Post</a>
            </article>
        `;
        const target = document.getElementById("label")?.firstChild;
        const evidence = document.getElementById("evidence");
        if (!(target instanceof Text) || !(evidence instanceof HTMLAnchorElement)) {
            throw new Error("Expected co-delivered LinkedIn mutation fixture");
        }
        const controller = new DocumentTransformationController({
            url: new URL("https://www.linkedin.com/feed/"),
            root: document,
            locales: ["en-GB"],
            display: {
                formatMode: "custom",
                pattern: "yyyy-MM-dd",
                timeZone: { mode: "utc" },
            },
        });

        controller.start();
        target.data = "2w • Edited";
        evidence.href = "/feed/update/urn:li:share:7170283349280292867/";
        await flushMutations();

        expect(target.data).toBe("2024-03-04 • Edited");
        controller.teardown();
    });

    it("reconciles LinkedIn label-shaping attribute transitions", async () => {
        document.body.innerHTML = `
            <article>
                <div id="label-parent">
                    <span id="label" aria-hidden="true">1w</span>
                </div>
                <a href="/feed/update/urn:li:activity:7147784590025818113/">Post</a>
            </article>
        `;
        const parent = document.getElementById("label-parent");
        const label = document.getElementById("label");
        const target = label?.firstChild;
        if (!parent || !label || !(target instanceof Text)) {
            throw new Error("Expected LinkedIn label fixture");
        }
        const controller = new DocumentTransformationController({
            url: new URL("https://www.linkedin.com/feed/"),
            root: document,
            locales: ["en-GB"],
            display: {
                formatMode: "custom",
                pattern: "yyyy-MM-dd",
                timeZone: { mode: "utc" },
            },
        });

        controller.start();
        parent.classList.add("update-components-actor__sub-description");
        await flushMutations();
        expect(target.data).toBe("2024-01-02");

        label.removeAttribute("aria-hidden");
        await flushMutations();
        expect(target.data).toBe("1w");

        label.setAttribute("aria-hidden", "true");
        await flushMutations();
        expect(target.data).toBe("2024-01-02");
        controller.teardown();
    });

    it("reconciles LinkedIn comment time eligibility when datetime changes", async () => {
        document.body.innerHTML = `
            <article>
                <time id="label" class="comments-comment-meta__data"
                    datetime="not-a-date">3d</time>
                <div data-sdui-anchor-id=
                    "comment-urn:li:comment:(ugcPost:1,7181895116414517252)::0">
                </div>
            </article>
        `;
        const label = document.getElementById("label");
        const target = label?.firstChild;
        if (!label || !(target instanceof Text)) {
            throw new Error("Expected LinkedIn comment time fixture");
        }
        const controller = new DocumentTransformationController({
            url: new URL("https://www.linkedin.com/feed/"),
            root: document,
            locales: ["en-GB"],
            display: {
                formatMode: "custom",
                pattern: "yyyy-MM-dd",
                timeZone: { mode: "utc" },
            },
        });

        controller.start();
        expect(target.data).toBe("3d");

        label.removeAttribute("datetime");
        await flushMutations();
        expect(target.data).toBe("2024-04-05");

        label.setAttribute("datetime", "not-a-date");
        await flushMutations();
        expect(target.data).toBe("3d");
        controller.teardown();
    });

    it("handles LinkedIn insertion, page text, reformat, removal, and re-enable", async () => {
        document.body.innerHTML = "<main id='feed'></main>";
        let display: DisplaySettings = {
            formatMode: "custom",
            pattern: "yyyy-MM-dd",
            timeZone: { mode: "utc" },
        };
        const controller = new DocumentTransformationController({
            url: new URL("https://www.linkedin.com/feed/"),
            root: document,
            locales: ["en-GB"],
            displayProvider: () => display,
        });
        controller.start();

        const post = document.createElement("article");
        post.innerHTML = `
            <p componentkey="timestamp"><span>1w •</span></p>
            <div componentkey="ShareUrn(shareId=7170283349280292867)"></div>
        `;
        document.getElementById("feed")?.append(post);
        await flushMutations();
        const target = post.querySelector("p > span")?.firstChild;
        if (!(target instanceof Text)) {
            throw new Error("Expected LinkedIn text target");
        }
        expect(target.data).toBe("2024-03-04 •");
        expect(post.querySelectorAll("time")).toHaveLength(0);

        target.data = "2w • Edited";
        await flushMutations();
        expect(target.data).toBe("2024-03-04 • Edited");

        display = {
            formatMode: "custom",
            pattern: "dd/MM/yyyy HH:mm:ss.SSS",
            timeZone: { mode: "utc" },
        };
        controller.reformatOwned();
        expect(target.data).toBe("04/03/2024 05:06:07.891 • Edited");

        post.remove();
        await flushMutations();
        expect(target.data).toBe("2w • Edited");

        document.getElementById("feed")?.append(post);
        await flushMutations();
        expect(target.data).toBe("04/03/2024 05:06:07.891 • Edited");

        const evidence = post.querySelector("[componentkey*='ShareUrn']");
        if (!evidence) {
            throw new Error("Expected share evidence");
        }
        evidence.setAttribute(
            "componentkey",
            "ShareUrn(shareId=7170283349280292867)",
        );
        post.setAttribute("data-urn", "urn:li:share:7170283349280292867");
        await flushMutations();

        expect(post.querySelector("p > span")?.firstChild).toBe(target);
        expect(post.querySelectorAll("time")).toHaveLength(0);
        expect(target.data).toBe("04/03/2024 05:06:07.891 • Edited");

        controller.teardown();
        expect(target.data).toBe("2w • Edited");

        controller.start();
        expect(target.data).toBe("04/03/2024 05:06:07.891 • Edited");
        expect(post.querySelectorAll("time")).toHaveLength(0);
        controller.teardown();
    });

    it("starts idempotently, tears down precisely, and can reactivate", () => {
        document.body.innerHTML = '<relative-time datetime="2026-08-23T10:15:00Z">'
            + '2 hours ago</relative-time><span id="foreign">foreign</span>';
        const source = document.querySelector("relative-time");
        const foreign = document.getElementById("foreign");
        if (!source || !foreign) {
            throw new Error("Expected fixture");
        }
        const controller = new DocumentTransformationController({
            url: new URL("https://github.com/example/repo"),
            root: document,
            locales: ["en-US"],
        });

        const first = controller.start();
        expect(first).toHaveLength(1);
        expect(first[0]?.isConnected).toBe(true);
        expect(controller.start()).toEqual(first);
        expect(document.querySelectorAll("time")).toHaveLength(1);
        controller.teardown();
        controller.teardown();
        expect(source.hasAttribute("hidden")).toBe(false);
        expect(source.textContent).toBe("2 hours ago");
        expect(foreign.textContent).toBe("foreign");
        expect(document.querySelector("time")).toBeNull();

        const second = controller.start();
        expect(second).toHaveLength(1);
        expect(second[0]).not.toBe(first[0]);
        expect(document.querySelectorAll("time")).toHaveLength(1);
        controller.teardown();
    });

    it("reformats only its existing owned sources when presentation changes", () => {
        document.body.innerHTML = '<relative-time datetime="2026-08-23T10:15:00Z">'
            + '2 hours ago</relative-time><span id="foreign">foreign</span>';
        let display: DisplaySettings = {
            formatMode: "system",
            timeZone: { mode: "iana", identifier: "America/New_York" },
        };
        const source = document.querySelector("relative-time");
        const foreign = document.getElementById("foreign");
        if (!source || !foreign) {
            throw new Error("Expected fixture");
        }
        const controller = new DocumentTransformationController({
            url: new URL("https://github.com/example/repo"),
            root: document,
            locales: ["en-GB"],
            displayProvider: () => display,
        });
        controller.start();
        const output = source.nextElementSibling;
        if (!(output instanceof HTMLTimeElement)) {
            throw new Error("Expected output");
        }
        const before = output.textContent;
        display = { formatMode: "system", timeZone: { mode: "utc" } };
        controller.reformatOwned();
        expect(output.textContent).not.toBe(before);
        expect(output.textContent).toBe(
            new Intl.DateTimeFormat(["en-GB"], {
                dateStyle: "medium",
                timeStyle: "short",
                timeZone: "UTC",
            }).format(new Date("2026-08-23T10:15:00Z")),
        );
        expect(foreign.textContent).toBe("foreign");
        controller.teardown();
    });

    it("processes additions and restores removed subtrees", async () => {
        document.body.innerHTML =
            '<relative-time datetime="2026-08-23T10:15:00Z">2 hours ago</relative-time>';
        const initial = document.querySelector("relative-time");
        if (!initial) {
            throw new Error("Expected initial source");
        }
        const controller = new DocumentTransformationController({
            url: new URL("https://github.com/example/repo"),
            root: document,
            locales: ["en-US"],
        });
        controller.start();
        const initialOutput = initial.nextElementSibling;
        if (!(initialOutput instanceof HTMLTimeElement)) {
            throw new Error("Expected initial output");
        }

        const wrapper = document.createElement("section");
        wrapper.innerHTML =
            '<relative-time datetime="2026-08-24T10:15:00Z">3 hours ago</relative-time>'
            + '<relative-time datetime="2026-08-25T10:15:00Z">'
            + "4 hours ago</relative-time>";
        document.body.append(wrapper);
        await flushMutations();
        expect(wrapper.querySelectorAll("time[data-no-more-ago-output]")).toHaveLength(2);

        initial.setAttribute("datetime", "2026-08-26T10:15:00Z");
        await flushMutations();
        expect(initial.nextElementSibling).toBe(initialOutput);
        expect(initialOutput.dateTime).toBe("2026-08-26T10:15:00Z");

        const initialHidden = initial.hasAttribute("hidden");
        document.body.removeChild(wrapper);
        await flushMutations();
        expect(
            wrapper.querySelectorAll("[data-no-more-ago-source], [data-no-more-ago-output]"),
        ).toHaveLength(0);
        expect(initial.hasAttribute("hidden")).toBe(initialHidden);
        expect(document.querySelectorAll("time[data-no-more-ago-output]")).toHaveLength(1);

        initialOutput.remove();
        await flushMutations();
        expect(initial.nextElementSibling).toBe(initialOutput);
        expect(document.querySelectorAll("time[data-no-more-ago-output]")).toHaveLength(1);
        controller.teardown();
    });

    it("does not diagnose ordinary non-time additions and removals", async () => {
        document.body.innerHTML = "<main></main>";
        const diagnosticSink = vi.fn();
        const controller = new DocumentTransformationController({
            url: new URL("https://example.test/"),
            root: document,
            locales: ["en-US"],
            diagnosticSink,
        });
        controller.start();
        diagnosticSink.mockClear();

        const ordinary = document.createElement("section");
        ordinary.textContent = "page content";
        document.body.append(ordinary);
        await flushMutations();
        ordinary.remove();
        await flushMutations();

        expect(diagnosticSink).not.toHaveBeenCalled();
        controller.teardown();
    });

    it.each([false, true])(
        "repairs moved outputs and preserves original hidden state (%s)",
        async (initiallyHidden) => {
            document.body.innerHTML = `<relative-time${initiallyHidden ? " hidden" : ""} `
                + 'datetime="2026-08-23T10:15:00Z">2 hours ago</relative-time>';
            const source = document.querySelector("relative-time");
            if (!source) {
                throw new Error("Expected source");
            }
            const controller = new DocumentTransformationController({
                url: new URL("https://github.com/example/repo"),
                root: document,
                locales: ["en-US"],
            });
            controller.start();
            const output = source.nextElementSibling;
            if (!(output instanceof HTMLTimeElement)) {
                throw new Error("Expected output");
            }
            const token = output.getAttribute("data-no-more-ago-output");
            const foreign = document.createElement("aside");
            document.body.append(foreign);
            foreign.append(output);
            await flushMutations();

            expect(source.nextElementSibling).toBe(output);
            expect(output.getAttribute("data-no-more-ago-output")).toBe(token);
            expect(source.hasAttribute("hidden")).toBe(true);
            expect(document.querySelectorAll("time[data-no-more-ago-output]")).toHaveLength(1);
            controller.teardown();
            expect(source.hasAttribute("hidden")).toBe(initiallyHidden);
            expect(output.isConnected).toBe(false);
        },
    );

    it("does not restore a page-removed hidden state for an initially hidden source", async () => {
        document.body.innerHTML = '<relative-time hidden datetime="2026-08-23T10:15:00Z">'
            + "2 hours ago</relative-time>";
        const source = document.querySelector("relative-time");
        if (!source) {
            throw new Error("Expected source");
        }
        const controller = new DocumentTransformationController({
            url: new URL("https://github.com/example/repo"),
            root: document,
            locales: ["en-US"],
        });
        controller.start();
        expect(source.nextElementSibling).toBeInstanceOf(HTMLTimeElement);
        source.removeAttribute("hidden");
        await flushMutations();
        source.removeAttribute("datetime");
        await flushMutations();
        expect(source.hasAttribute("hidden")).toBe(false);
        expect(document.querySelector("time[data-no-more-ago-output]")).toBeNull();
        controller.teardown();
    });

    it("moves owned subtrees and creates fresh pairs after reinsertion", async () => {
        document.body.innerHTML = '<main id="one">'
            + '<relative-time datetime="2026-08-23T10:15:00Z">2 hours ago</relative-time>'
            + '</main><main id="two"></main>';
        const wrapper = document.getElementById("one");
        const destination = document.getElementById("two");
        const source = wrapper?.querySelector("relative-time");
        if (!wrapper || !destination || !source) {
            throw new Error("Expected fixture");
        }
        const controller = new DocumentTransformationController({
            url: new URL("https://github.com/example/repo"),
            root: document,
            locales: ["en-US"],
        });
        controller.start();
        const output = source.nextElementSibling;
        if (!(output instanceof HTMLTimeElement)) {
            throw new Error("Expected output");
        }
        const token = output.getAttribute("data-no-more-ago-output");
        destination.append(wrapper);
        await flushMutations();
        expect(source.nextElementSibling).toBe(output);
        expect(output.getAttribute("data-no-more-ago-output")).toBe(token);

        wrapper.remove();
        await flushMutations();
        expect(
            wrapper.querySelector("[data-no-more-ago-source], [data-no-more-ago-output]"),
        ).toBeNull();
        expect(source.hasAttribute("hidden")).toBe(false);
        document.body.append(wrapper);
        await flushMutations();
        const freshOutput = source.nextElementSibling;
        expect(freshOutput).toBeInstanceOf(HTMLTimeElement);
        expect(freshOutput).not.toBe(output);
        controller.teardown();
    });

    it("does not recurse when invalidation removes an owned output", async () => {
        document.body.innerHTML =
            '<relative-time datetime="2026-08-23T10:15:00Z">2 hours ago</relative-time>';
        const source = document.querySelector("relative-time");
        if (!source) {
            throw new Error("Expected source");
        }
        const controller = new DocumentTransformationController({
            url: new URL("https://github.com/example/repo"),
            root: document,
            locales: ["en-US"],
        });
        controller.start();
        const output = source.nextElementSibling;
        if (!(output instanceof HTMLTimeElement)) {
            throw new Error("Expected output");
        }
        source.removeAttribute("datetime");
        await flushMutations();
        expect(output.isConnected).toBe(false);
        expect(source.hasAttribute("hidden")).toBe(false);
        expect(document.querySelectorAll("time[data-no-more-ago-output]")).toHaveLength(0);
        controller.teardown();
    });

    it("reconciles combined ownership mutations once", async () => {
        document.body.innerHTML = `
      <relative-time id="moved" datetime="2026-08-23T10:15:00Z">2 hours ago</relative-time>
      <relative-time id="removed" datetime="2026-08-23T11:15:00Z">3 hours ago</relative-time>
      <relative-time id="outside" datetime="2026-08-23T12:15:00Z">4 hours ago</relative-time>`;
        const moved = document.getElementById("moved");
        const removed = document.getElementById("removed");
        if (!moved || !removed) {
            throw new Error("Expected sources");
        }
        const roots: ParentNode[] = [];
        const visits: Element[] = [];
        const adapter: TimestampSourceRule = {
            id: "combined-instrumented",
            mutationAttributes: [TIMESTAMP_SOURCE_ATTRIBUTE.DATETIME],
            matches: () => true,
            matchesElement: (element) => element.matches("relative-time"),
            discover: (root) => {
                roots.push(root);
                const own = root instanceof Element && root.matches("relative-time") ? [root] : [];
                return [...own, ...Array.from(root.querySelectorAll("relative-time"))];
            },
            isRelativePresentation: () => true,
            extract: (element) => {
                visits.push(element);
                const datetime = element.getAttribute("datetime");
                if (!datetime) {
                    return null;
                }
                return {
                    ruleId: "combined-instrumented",
                    source: element,
                    sourceKind: "relative-time",
                    rawDatetime: datetime,
                    presentation: ADJACENT_TIME_PRESENTATION,
                    validationRule: TIMESTAMP_VALIDATION_RULE.EXPLICIT_ISO_ZONE,
                    visibilityPolicy: TIMESTAMP_VISIBILITY_POLICY.IGNORE_PAGE_SUPPRESSION,
                };
            },
        };
        const controller = new DocumentTransformationController({
            url: new URL("https://github.com/example/repo"),
            root: document,
            locales: ["en-US"],
            registry: new AdapterRegistry([adapter], noMatchRule),
        });
        controller.start();
        const movedOutput = moved.nextElementSibling;
        const removedOutput = removed.nextElementSibling;
        if (
            !(movedOutput instanceof HTMLTimeElement) ||
            !(removedOutput instanceof HTMLTimeElement)
        ) {
            throw new Error("Expected initial outputs");
        }
        const token = movedOutput.getAttribute("data-no-more-ago-output");
        roots.length = 0;
        visits.length = 0;
        const region = document.createElement("section");
        document.body.append(region);
        region.append(moved, movedOutput);
        moved.setAttribute("datetime", "2026-08-24T10:15:00Z");
        movedOutput.remove();
        region.append(movedOutput);
        removed.remove();
        removedOutput.remove();
        const added = document.createElement("section");
        added.innerHTML = '<relative-time datetime="2026-08-25T10:15:00Z">'
            + "5 hours ago</relative-time>";
        document.body.append(added);
        document.body.append(document.createTextNode("unrelated"));
        await flushMutations();

        expect(moved.nextElementSibling).toBe(movedOutput);
        expect(movedOutput.getAttribute("data-no-more-ago-output")).toBe(token);
        expect(movedOutput.dateTime).toBe("2026-08-24T10:15:00Z");
        expect(removed.hasAttribute("hidden")).toBe(false);
        expect(removedOutput.isConnected).toBe(false);
        expect(added.querySelectorAll("time[data-no-more-ago-output]")).toHaveLength(1);
        expect(roots).toEqual([region, added]);
        expect(visits).toEqual([moved, added.querySelector("relative-time")]);
        expect(visits).not.toContain(document.getElementById("outside"));
        controller.teardown();
    });

    it("rolls back observer setup and succeeds on a later start", () => {
        document.body.innerHTML =
            '<relative-time datetime="2026-08-23T10:15:00Z">2 hours ago</relative-time>';
        const source = document.querySelector("relative-time");
        if (!source) {
            throw new Error("Expected source");
        }
        const controller = new DocumentTransformationController({
            url: new URL("https://github.com/example/repo"),
            root: document,
            locales: ["en-US"],
        });
        const error = new Error("observer setup failed");
        const observe = vi
            .spyOn(MutationObserver.prototype, "observe")
            .mockImplementationOnce(() => {
                throw error;
            });

        expect(() => controller.start()).toThrow(error);
        expect(document.querySelector("time[data-no-more-ago-output]")).toBeNull();
        expect(source.hasAttribute("hidden")).toBe(false);
        observe.mockRestore();

        const outputs = controller.start();
        expect(outputs).toHaveLength(1);
        expect(document.querySelectorAll("time[data-no-more-ago-output]")).toHaveLength(1);
        controller.teardown();
    });

    it("restores a partial initial pass before retrying with the same adapter", () => {
        document.body.innerHTML = `
      <relative-time id="first" datetime="2026-08-23T10:15:00Z">2 hours ago</relative-time>
      <relative-time id="second" datetime="2026-08-24T10:15:00Z">3 hours ago</relative-time>`;
        const first = document.getElementById("first");
        const second = document.getElementById("second");
        if (!first || !second) {
            throw new Error("Expected sources");
        }
        let shouldThrow = true;
        const adapter: TimestampSourceRule = {
            id: "test",
            mutationAttributes: [TIMESTAMP_SOURCE_ATTRIBUTE.DATETIME],
            matches: () => true,
            matchesElement: (element) => element.matches("relative-time"),
            discover: (root) => [
                ...(root instanceof Element && root.matches("relative-time") ? [root] : []),
                ...Array.from(root.querySelectorAll("relative-time")),
            ],
            isRelativePresentation: () => true,
            extract: (element) => {
                if (shouldThrow && element === second) {
                    throw new Error("candidate extraction failed");
                }
                return {
                    ruleId: "test",
                    source: element,
                    sourceKind: "relative-time",
                    rawDatetime: element.getAttribute("datetime") ?? "",
                    presentation: ADJACENT_TIME_PRESENTATION,
                    validationRule: TIMESTAMP_VALIDATION_RULE.EXPLICIT_ISO_ZONE,
                    visibilityPolicy: TIMESTAMP_VISIBILITY_POLICY.IGNORE_PAGE_SUPPRESSION,
                };
            },
        };
        const controller = new DocumentTransformationController({
            url: new URL("https://example.test/"),
            root: document,
            locales: ["en-US"],
            registry: new AdapterRegistry([adapter], noMatchRule),
        });

        expect(() => controller.start()).toThrow("candidate extraction failed");
        expect(first.hasAttribute("hidden")).toBe(false);
        expect(second.hasAttribute("hidden")).toBe(false);
        expect(document.querySelectorAll("time[data-no-more-ago-output]")).toHaveLength(0);

        shouldThrow = false;
        expect(controller.start()).toHaveLength(2);
        expect(document.querySelectorAll("time[data-no-more-ago-output]")).toHaveLength(2);
        controller.teardown();
    });

    it("bounds dynamic discovery and batches exact-source datetime changes", async () => {
        document.body.innerHTML =
            '<relative-time id="outside" datetime="2026-08-23T10:15:00Z">'
            + "2 hours ago</relative-time>";
        const roots: ParentNode[] = [];
        const visits: Element[] = [];
        const adapter: TimestampSourceRule = {
            id: "instrumented",
            mutationAttributes: [TIMESTAMP_SOURCE_ATTRIBUTE.DATETIME],
            matches: () => true,
            matchesElement: (element) => element.matches("relative-time"),
            discover: (root) => {
                roots.push(root);
                const own = root instanceof Element && root.matches("relative-time") ? [root] : [];
                return [...own, ...Array.from(root.querySelectorAll("relative-time"))];
            },
            isRelativePresentation: () => true,
            extract: (element) => {
                visits.push(element);
                return {
                    ruleId: "instrumented",
                    source: element,
                    sourceKind: "relative-time",
                    rawDatetime: element.getAttribute("datetime") ?? "",
                    presentation: ADJACENT_TIME_PRESENTATION,
                    validationRule: TIMESTAMP_VALIDATION_RULE.EXPLICIT_ISO_ZONE,
                    visibilityPolicy: TIMESTAMP_VISIBILITY_POLICY.IGNORE_PAGE_SUPPRESSION,
                };
            },
        };
        const controller = new DocumentTransformationController({
            url: new URL("https://example.test/"),
            root: document,
            locales: ["en-US"],
            registry: new AdapterRegistry([adapter], noMatchRule),
        });
        controller.start();
        roots.length = 0;
        visits.length = 0;
        const wrapper = document.createElement("section");
        wrapper.innerHTML = '<relative-time id="inside-one" '
            + 'datetime="2026-08-24T10:15:00Z">one</relative-time>'
            + '<relative-time id="inside-two" '
            + 'datetime="2026-08-25T10:15:00Z">two</relative-time>';
        document.body.append(wrapper);
        const insideOne = wrapper.querySelector("#inside-one");
        if (!insideOne) {
            throw new Error("Expected dynamic source");
        }
        await flushMutations();

        expect(roots).toEqual([wrapper]);
        expect(visits).toEqual(
            expect.arrayContaining([...wrapper.querySelectorAll("relative-time")]),
        );
        expect(visits).toHaveLength(2);
        expect(document.getElementById("outside")?.nextElementSibling).toBeInstanceOf(
            HTMLTimeElement,
        );
        const output = insideOne.nextElementSibling;
        if (!(output instanceof HTMLTimeElement)) {
            throw new Error("Expected owned output");
        }
        const token = output.getAttribute("data-no-more-ago-output");
        roots.length = 0;
        visits.length = 0;
        insideOne.setAttribute("datetime", "2026-08-26T10:15:00Z");
        insideOne.setAttribute("datetime", "2026-08-27T10:15:00Z");
        insideOne.setAttribute("datetime", "2026-08-28T10:15:00Z");
        await flushMutations();

        expect(roots).toEqual([]);
        expect(visits).toEqual([insideOne]);
        expect(insideOne.nextElementSibling).toBe(output);
        expect(output.getAttribute("data-no-more-ago-output")).toBe(token);
        expect(output.dateTime).toBe("2026-08-28T10:15:00Z");
        expect(output.textContent).toBe(
            formatDefaultDate(new Date("2026-08-28T10:15:00Z"), ["en-US"]),
        );
        expect(document.getElementById("outside")?.nextElementSibling).not.toBeNull();
        controller.teardown();
    });

    it("leaves forged output detach and reparent operations untouched", async () => {
        document.body.innerHTML =
            '<relative-time datetime="2026-08-23T10:15:00Z">2 hours ago</relative-time>';
        const source = document.querySelector("relative-time");
        if (!source) {
            throw new Error("Expected source");
        }
        const controller = new DocumentTransformationController({
            url: new URL("https://github.com/example/repo"),
            root: document,
            locales: ["en-US"],
        });
        controller.start();
        const forged = document.createElement("time");
        forged.setAttribute("data-no-more-ago-output", "forged");
        forged.textContent = "page exact";
        const parent = document.createElement("aside");
        document.body.append(parent);
        parent.append(forged);
        forged.remove();
        await flushMutations();
        const other = document.createElement("section");
        document.body.append(other);
        other.append(forged);
        await flushMutations();
        expect(forged.parentNode).toBe(other);
        expect(forged.getAttribute("data-no-more-ago-output")).toBe("forged");
        expect(forged.textContent).toBe("page exact");
        expect(document.querySelectorAll("time[data-no-more-ago-output]")).toHaveLength(2);
        controller.teardown();
    });

    it("performs one invalidation reconciliation after observer drains", async () => {
        document.body.innerHTML =
            '<relative-time datetime="2026-08-23T10:15:00Z">2 hours ago</relative-time>';
        const source = document.querySelector("relative-time");
        if (!source) {
            throw new Error("Expected source");
        }
        let visits = 0;
        const adapter: TimestampSourceRule = {
            id: "counting",
            mutationAttributes: [TIMESTAMP_SOURCE_ATTRIBUTE.DATETIME],
            matches: () => true,
            matchesElement: (element) => element.matches("relative-time"),
            discover: (root) => [
                ...(root instanceof Element && root.matches("relative-time") ? [root] : []),
                ...Array.from(root.querySelectorAll("relative-time")),
            ],
            isRelativePresentation: () => true,
            extract: (element) => {
                visits += 1;
                const datetime = element.getAttribute("datetime");
                if (!datetime) {
                    return null;
                }
                return {
                    ruleId: "counting",
                    source: element,
                    sourceKind: "relative-time",
                    rawDatetime: datetime,
                    presentation: ADJACENT_TIME_PRESENTATION,
                    validationRule: TIMESTAMP_VALIDATION_RULE.EXPLICIT_ISO_ZONE,
                    visibilityPolicy: TIMESTAMP_VISIBILITY_POLICY.IGNORE_PAGE_SUPPRESSION,
                };
            },
        };
        const controller = new DocumentTransformationController({
            url: new URL("https://example.test/"),
            root: document,
            locales: ["en-US"],
            registry: new AdapterRegistry([adapter], noMatchRule),
        });
        controller.start();
        visits = 0;
        source.removeAttribute("datetime");
        await flushMutations();
        await flushMutations();
        expect(visits).toBe(1);
        expect(document.querySelector("time[data-no-more-ago-output]")).toBeNull();
        controller.teardown();
    });

    it("reacquires extension-owned hidden state when a page removes it", async () => {
        document.body.innerHTML = '<time datetime="2026-08-23T10:15Z">2 hours ago</time>';
        const source = document.querySelector("time");
        if (!source) {
            throw new Error("Expected generic source");
        }
        const controller = new DocumentTransformationController({
            url: new URL("https://example.test/"),
            root: document,
            locales: ["en-US"],
        });
        controller.start();
        const output = source.nextElementSibling;
        if (!(output instanceof HTMLTimeElement)) {
            throw new Error("Expected output");
        }
        const token = output.getAttribute("data-no-more-ago-output");
        source.removeAttribute("hidden");
        await flushMutations();
        expect(source.hasAttribute("hidden")).toBe(true);
        expect(source.nextElementSibling).toBe(output);
        expect(output.getAttribute("data-no-more-ago-output")).toBe(token);
        controller.teardown();
    });

    it.each([
        ["the trusted title is removed", "remove-title"],
        ["the trusted title becomes blank", "blank-title"],
        ["the trusted title becomes unzoned", "unzone-title"],
        ["the age class is removed", "remove-class"],
    ] as const)("restores an owned in-place source when %s", async (_name, mutation) => {
        document.body.innerHTML = `<span class="age"
            title="2026-08-28T10:09:07.000000Z"><a id="age-link"
            href="item?id=1">1 hour ago</a></span>`;
        const source = document.querySelector("span.age");
        const link = document.getElementById("age-link");
        if (!source || !link) {
            throw new Error("Expected Hacker News age source");
        }
        const controller = new DocumentTransformationController({
            url: new URL("https://news.ycombinator.com/item?id=1"),
            root: document,
            locales: ["en-US"],
            display: {
                formatMode: "custom",
                pattern: "yyyy",
                timeZone: { mode: "utc" },
            },
        });
        controller.start();
        expect(link.textContent).toBe("2026");

        if (mutation === "remove-title") {
            source.removeAttribute("title");
        } else if (mutation === "blank-title") {
            source.setAttribute("title", "   ");
        } else if (mutation === "unzone-title") {
            source.setAttribute("title", "2026-08-28T10:09:07");
        } else {
            source.classList.remove("age");
        }
        await flushMutations();
        expect(link.textContent).toBe("1 hour ago");
        expect(document.getElementById("age-link")).toBe(link);
        controller.teardown();
    });

    it.each([
        ["class is added after title", "class"],
        ["title is added after class", "title"],
    ] as const)("processes a staged Hacker News source when %s", async (_name, finalAttribute) => {
        const source = document.createElement("span");
        const link = document.createElement("a");
        link.textContent = "1 hour ago";
        source.append(link);
        if (finalAttribute === "class") {
            source.title = "2026-08-28T10:09:07Z";
        } else {
            source.className = "age";
        }
        const controller = new DocumentTransformationController({
            url: new URL("https://news.ycombinator.com/item?id=1"),
            root: document,
            locales: ["en-US"],
            display: { formatMode: "custom", pattern: "yyyy", timeZone: { mode: "utc" } },
        });
        controller.start();
        document.body.append(source);
        await flushMutations();
        expect(link.textContent).toBe("1 hour ago");

        if (finalAttribute === "class") {
            source.className = "age";
        } else {
            source.title = "2026-08-28T10:09:07Z";
        }
        await flushMutations();
        expect(link.textContent).toBe("2026");
        controller.teardown();
    });

    it("processes a Hacker News widget when complex content becomes a simple label", async () => {
        document.body.innerHTML = `<span class="age" title="2026-08-28T10:09:07Z">
            <a id="age-link"><strong>1 hour ago</strong></a></span>`;
        const link = document.getElementById("age-link");
        if (!link) {
            throw new Error("Expected Hacker News label");
        }
        const controller = new DocumentTransformationController({
            url: new URL("https://news.ycombinator.com/item?id=1"),
            root: document,
            locales: ["en-US"],
            display: { formatMode: "custom", pattern: "yyyy", timeZone: { mode: "utc" } },
        });
        controller.start();
        expect(link.textContent).toBe("1 hour ago");

        link.replaceChildren(document.createTextNode("2 hours ago"));
        await flushMutations();
        expect(link.textContent).toBe("2026");
        controller.teardown();
    });

    it("restores an owned source covered by a broader added root", async () => {
        document.body.innerHTML = `<span class="age" title="2026-08-28T10:09:07Z">
            <a id="age-link">1 hour ago</a></span>`;
        const source = document.querySelector("span.age");
        const link = document.getElementById("age-link");
        if (!source || !link) {
            throw new Error("Expected Hacker News source");
        }
        const controller = new DocumentTransformationController({
            url: new URL("https://news.ycombinator.com/item?id=1"),
            root: document,
            locales: ["en-US"],
            display: { formatMode: "custom", pattern: "yyyy", timeZone: { mode: "utc" } },
        });
        controller.start();
        expect(link.textContent).toBe("2026");

        const region = document.createElement("section");
        document.body.append(region);
        source.classList.remove("age");
        region.append(source);
        await flushMutations();
        expect(link.textContent).toBe("1 hour ago");
        controller.teardown();
    });

    it("ignores unrelated title changes when no active rule uses title", async () => {
        const unrelated = document.createElement("div");
        document.body.append(unrelated);
        const diagnosticSink = vi.fn();
        const controller = new DocumentTransformationController({
            url: new URL("https://example.test/"),
            root: document,
            locales: ["en-US"],
            diagnosticSink,
        });
        controller.start();
        diagnosticSink.mockClear();

        unrelated.title = "page tooltip";
        await flushMutations();
        expect(diagnosticSink).not.toHaveBeenCalled();
        controller.teardown();
    });

    it(
        "handles dynamic Hacker News insertion, updates, replacement, movement, and idle",
        async () => {
            document.body.innerHTML = "<main><section id='one'></section>"
            + "<section id='two'></section></main>";
            const visits: Element[] = [];
            const instrumented: TimestampSourceRule = {
                ...hackerNewsAdapter,
                extract: (element) => {
                    visits.push(element);
                    return hackerNewsAdapter.extract(element);
                },
            };
            const controller = new DocumentTransformationController({
                url: new URL("https://news.ycombinator.com/item?id=1"),
                root: document,
                locales: ["en-US"],
                display: { formatMode: "custom", pattern: "yyyy", timeZone: { mode: "utc" } },
                registry: new AdapterRegistry([instrumented], genericTimeRule),
            });
            controller.start();
            const wrapper = document.createElement("span");
            wrapper.className = "age";
            wrapper.title = "2026-08-28T10:09:07Z";
            const link = document.createElement("a");
            link.href = "item?id=1";
            link.textContent = "2 hours ago";
            wrapper.append(link);
            document.querySelector("#one")?.append(wrapper);
            await flushMutations();
            expect(link.textContent).toBe("2026");
            const originalLink = link;
            wrapper.title = "2027-08-28T10:09:07Z";
            await flushMutations();
            expect(link.textContent).toBe("2027");
            const target = link.firstChild;
            if (!(target instanceof Text)) {
                throw new Error("Expected dynamic text target");
            }
            target.data = "3 hours ago";
            await flushMutations();
            expect(link.textContent).toBe("2027");
            document.querySelector("#two")?.append(wrapper);
            await flushMutations();
            expect(document.querySelector("#two .age")).toBe(wrapper);
            expect(wrapper.querySelector("a")).toBe(originalLink);
            const replacement = document.createElement("a");
            replacement.id = "replacement-link";
            replacement.href = "item?id=2";
            replacement.textContent = "4 hours ago";
            wrapper.replaceChildren(replacement);
            await flushMutations();
            expect(replacement.textContent).toBe("2027");
            expect(originalLink.textContent).toBe("3 hours ago");
            const replacementTarget = replacement.firstChild;
            if (!(replacementTarget instanceof Text)) {
                throw new Error("Expected replacement text target");
            }
            document.querySelector("#two")?.replaceChildren();
            await flushMutations();
            expect(replacement.textContent).toBe("4 hours ago");
            wrapper.title = "2027-08-28T10:09:07";
            document.querySelector("#one")?.append(wrapper);
            await flushMutations();
            expect(replacement.textContent).toBe("4 hours ago");
            wrapper.title = "2027-08-28T10:09:07Z";
            await flushMutations();
            for (const invalidTitle of ["   ", "not a timestamp"]) {
                wrapper.title = invalidTitle;
                await flushMutations();
                expect(replacement.textContent).toBe("4 hours ago");
            }
            wrapper.removeAttribute("title");
            await flushMutations();
            expect(replacement.textContent).toBe("4 hours ago");
            visits.length = 0;
            await flushMutations();
            await flushMutations();
            expect(visits).toEqual([]);
            controller.teardown();
        },
    );

    it("does not mistake extension-owned hidden styling for page suppression", async () => {
        const computedStyle = vi.spyOn(window, "getComputedStyle").mockImplementation(
            (element) => ({
                display: element.hasAttribute("hidden") ? "none" : "inline",
                visibility: "visible",
            }) as CSSStyleDeclaration,
        );
        const { source, controller } = createGenericControllerFixture();
        try {
            controller.start();
            const output = source.nextElementSibling;
            if (!(output instanceof HTMLTimeElement)) {
                throw new Error("Expected output");
            }
            source.setAttribute("datetime", "2026-08-24T10:15Z");
            await flushMutations();
            expect(source.nextElementSibling).toBe(output);
            expect(output.dateTime).toBe("2026-08-24T10:15Z");
        } finally {
            controller.teardown();
            computedStyle.mockRestore();
        }
    });

    it("restores an owned source hidden by page CSS after its datetime changes", async () => {
        const { source, controller } = createGenericControllerFixture();
        const inspected: Element[] = [];
        const computedStyle = vi.spyOn(window, "getComputedStyle").mockImplementation((element) => {
            inspected.push(element);
            return {
                display: element.hasAttribute("hidden") || element.classList.contains("page-hidden")
                    ? "none"
                    : "inline",
                visibility: "visible",
            } as CSSStyleDeclaration;
        });
        try {
            controller.start();
            inspected.length = 0;
            source.classList.add("page-hidden");
            source.setAttribute("datetime", "2026-08-24T10:15Z");
            await flushMutations();
            expect(inspected).toContain(source);
            expect(inspected.some((element) =>
                element === source && element.isConnected && !element.hasAttribute("hidden")
            )).toBe(true);
            expect(inspected.every((element) => element === source)).toBe(true);
            expect(source.hasAttribute("hidden")).toBe(false);
            expect(source.textContent).toBe("2 hours ago");
            expect(document.querySelector("time[data-no-more-ago-output]")).toBeNull();
        } finally {
            controller.teardown();
            computedStyle.mockRestore();
        }
    });

    it("preserves a page-owned hidden state added to an owned source", async () => {
        const { source, controller } = createGenericControllerFixture();
        controller.start();
        source.removeAttribute("hidden");
        source.setAttribute("hidden", "");
        await flushMutations();
        expect(source.hasAttribute("hidden")).toBe(true);
        expect(document.querySelector("time[data-no-more-ago-output]")).toBeNull();
        controller.teardown();
    });

    it.each([
        ["aria-hidden", "true"],
        ["inert", ""],
        ["style", "display: none"],
    ])("removes output while page suppresses generic source via %s", async (attribute, value) => {
        const { source, controller } = createGenericControllerFixture();
        controller.start();
        source.setAttribute(attribute, value);
        await flushMutations();
        expect(document.querySelector("time[data-no-more-ago-output]")).toBeNull();
        expect(source.getAttribute(attribute)).toBe(value);
        controller.teardown();
    });

    it(
        "reconciles generic sources when ancestor accessibility suppression changes",
        async () => {
            const { controller } = createGenericControllerFixture(
                '<section><time datetime="2026-08-23T10:15Z">2 hours ago</time></section>',
            );
            const section = document.querySelector("section");
            if (!section) {
                throw new Error("Expected generic source and ancestor");
            }
            controller.start();
            section.setAttribute("aria-hidden", "true");
            await flushMutations();
            expect(document.querySelector("time[data-no-more-ago-output]")).toBeNull();
            section.removeAttribute("aria-hidden");
            await flushMutations();
            expect(document.querySelector("time[data-no-more-ago-output]")).not.toBeNull();
            controller.teardown();
        },
    );

    it("reconciles generic sources when a visibility class is added or removed", async () => {
        const computedStyle = vi.spyOn(window, "getComputedStyle").mockImplementation(
            (element) => ({
                display: element.classList.contains("page-hidden") ? "none" : "inline",
                visibility: "visible",
            }) as CSSStyleDeclaration,
        );
        const { source, controller } = createGenericControllerFixture(
            '<time class="page-hidden" datetime="2026-08-23T10:15Z">2 hours ago</time>',
        );
        try {
            controller.start();
            expect(source.nextElementSibling).toBeNull();
            source.classList.remove("page-hidden");
            await flushMutations();
            expect(source.nextElementSibling).toBeInstanceOf(HTMLTimeElement);
            source.classList.add("page-hidden");
            await flushMutations();
            expect(source.nextElementSibling).toBeNull();
        } finally {
            controller.teardown();
            computedStyle.mockRestore();
        }
    });

    it("reconciles generic sources when an ancestor visibility class changes", async () => {
        const computedStyle = vi.spyOn(window, "getComputedStyle").mockImplementation(
            (element) => ({
                display: element.classList.contains("page-hidden") ? "none" : "block",
                visibility: "visible",
            }) as CSSStyleDeclaration,
        );
        const { source, controller } = createGenericControllerFixture(
            '<section class="page-hidden"><time datetime="2026-08-23T10:15Z">'
            + "2 hours ago</time></section>",
        );
        const section = source.parentElement;
        if (!section) {
            throw new Error("Expected source ancestor");
        }
        try {
            controller.start();
            expect(source.nextElementSibling).toBeNull();
            section.classList.remove("page-hidden");
            await flushMutations();
            expect(source.nextElementSibling).toBeInstanceOf(HTMLTimeElement);
            section.classList.add("page-hidden");
            await flushMutations();
            expect(source.nextElementSibling).toBeNull();
        } finally {
            controller.teardown();
            computedStyle.mockRestore();
        }
    });

    it("applies no-op, clear, and replace as total route transitions", () => {
        document.body.innerHTML = '<time datetime="2026-08-23T10:15Z">2 hours ago</time>';
        const source = document.querySelector("time");
        if (!source) {
            throw new Error("Expected route source");
        }
        const sessions: Array<{
            readonly session: DocumentRouteHandoffSession;
            readonly dispose: ReturnType<typeof vi.fn>;
        }> = [];
        const activate = vi.fn(() => {
            const dispose = vi.fn();
            const session = { noteStructure: vi.fn(), dispose };
            sessions.push({ session, dispose });
            return session;
        });
        const quarantine: DocumentRouteHandoffPolicy = {
            allowsRule: () => false,
            activate,
        };
        const classifier = vi.fn(({ currentUrl }: { readonly currentUrl: URL }) => {
            if (currentUrl.pathname === "/noop") {
                return { kind: DOCUMENT_ROUTE_HANDOFF_TRANSITION.NOOP } as const;
            }
            if (currentUrl.pathname === "/replace") {
                return {
                    kind: DOCUMENT_ROUTE_HANDOFF_TRANSITION.REPLACE,
                    policy: quarantine,
                } as const;
            }
            return { kind: DOCUMENT_ROUTE_HANDOFF_TRANSITION.CLEAR } as const;
        });
        const controller = new DocumentTransformationController({
            url: new URL("https://example.test/initial"),
            root: document,
            locales: ["en-US"],
            routeHandoffClassifier: classifier,
        });

        const initial = controller.start();
        expect(initial).toHaveLength(1);
        const initialOutput = initial[0];
        controller.reconcileRoute(new URL("https://example.test/noop"));
        expect(document.querySelector("[data-no-more-ago-output]")).toBe(initialOutput);
        expect(activate).not.toHaveBeenCalled();

        controller.reconcileRoute(new URL("https://example.test/replace"));
        expect(document.querySelector("[data-no-more-ago-output]")).toBeNull();
        expect(source.hasAttribute("hidden")).toBe(false);
        expect(activate).toHaveBeenCalledOnce();

        controller.reconcileRoute(new URL("https://example.test/clear"));
        const clearedOutput = document.querySelector("[data-no-more-ago-output]");
        expect(clearedOutput).toBeInstanceOf(HTMLTimeElement);
        expect(sessions[0]?.dispose).toHaveBeenCalledOnce();
        expect(activate).toHaveBeenCalledOnce();

        const classifierCalls = classifier.mock.calls.length;
        controller.reconcileRoute(new URL("https://example.test/clear"));
        expect(classifier).toHaveBeenCalledTimes(classifierCalls);
        expect(document.querySelector("[data-no-more-ago-output]")).toBe(clearedOutput);

        controller.reconcileRoute(new URL("https://example.test/replace"));
        controller.teardown();
        const activationsBeforeRestart = activate.mock.calls.length;
        controller.start();
        expect(activate).toHaveBeenCalledTimes(activationsBeforeRestart + 1);
        expect(document.querySelector("[data-no-more-ago-output]")).toBeNull();
        controller.teardown();
    });

    it("restores before activating and passing a replacement route", () => {
        document.body.innerHTML = '<time datetime="2026-08-23T10:15Z">2 hours ago</time>';
        const source = document.querySelector("time");
        if (!source) {
            throw new Error("Expected route source");
        }
        const events: string[] = [];
        const firstPolicy: DocumentRouteHandoffPolicy = {
            allowsRule: () => true,
            activate: () => ({
                noteStructure: () => undefined,
                dispose: () => events.push("dispose"),
            }),
        };
        const secondPolicy: DocumentRouteHandoffPolicy = {
            allowsRule: () => true,
            activate: () => {
                events.push("activate");
                expect(source.hasAttribute("hidden")).toBe(false);
                expect(document.querySelector("[data-no-more-ago-output]")).toBeNull();
                return { noteStructure: () => undefined, dispose: () => undefined };
            },
        };
        const adapter: TimestampSourceRule = {
            id: "route-order",
            mutationAttributes: [],
            matches: () => true,
            matchesElement: (element) => element === source,
            discover: () => [source],
            isRelativePresentation: () => true,
            extract: (element) => {
                events.push("pass");
                return {
                    ruleId: "route-order",
                    source: element,
                    sourceKind: TIMESTAMP_SOURCE_KIND.STANDARD_TIME,
                    rawDatetime: "2026-08-23T10:15Z",
                    presentation: ADJACENT_TIME_PRESENTATION,
                    validationRule: TIMESTAMP_VALIDATION_RULE.HTML_GLOBAL,
                    visibilityPolicy: TIMESTAMP_VISIBILITY_POLICY.PRESERVE_PAGE_SUPPRESSION,
                };
            },
        };
        let transitionCount = 0;
        const controller = new DocumentTransformationController({
            url: new URL("https://example.test/initial"),
            root: document,
            registry: new AdapterRegistry([adapter], noMatchRule),
            routeHandoffClassifier: () => {
                events.push("classify");
                transitionCount += 1;
                return {
                    kind: DOCUMENT_ROUTE_HANDOFF_TRANSITION.REPLACE,
                    policy: transitionCount === 1 ? firstPolicy : secondPolicy,
                };
            },
        });
        controller.start();
        controller.reconcileRoute(new URL("https://example.test/one"));
        events.length = 0;

        controller.reconcileRoute(new URL("https://example.test/two"));

        expect(events).toEqual(["classify", "dispose", "activate", "pass"]);
        controller.teardown();
    });

    it("fails closed and restores ownership when changed-route classification throws", () => {
        document.body.innerHTML = '<time datetime="2026-08-23T10:15Z">2 hours ago</time>';
        const source = document.querySelector("time");
        if (!source) {
            throw new Error("Expected route source");
        }
        const failure = new Error("route classification failed");
        const controller = new DocumentTransformationController({
            url: new URL("https://example.test/initial"),
            root: document,
            locales: ["en-US"],
            routeHandoffClassifier: () => {
                throw failure;
            },
        });
        controller.start();

        expect(() => controller.reconcileRoute(new URL("https://example.test/next")))
            .toThrow(failure);
        expect(source.hasAttribute("hidden")).toBe(false);
        expect(document.querySelector("[data-no-more-ago-output]")).toBeNull();
        controller.teardown();
    });

});
