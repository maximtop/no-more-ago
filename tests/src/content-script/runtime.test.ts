/**
 * @file Exercises content runtime hydration, policy refresh, and teardown.
 */

import { readFile } from "node:fs/promises";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
/* eslint-disable @typescript-eslint/require-await */
import { DOCUMENT_RUNTIME_SLOT, installContentRuntime } from "../../../src/content-script/runtime";
import {
    OWNED_OUTPUT_ATTRIBUTE,
    OWNED_SOURCE_ATTRIBUTE,
} from "../../../src/content-script/ownership-markers";
import {
    DOCUMENT_POLICY_REFRESHED_MESSAGE,
    DOCUMENT_PHASE,
    DOCUMENT_STATUS_MESSAGE,
    DOCUMENT_TORN_DOWN_MESSAGE,
    DOCUMENT_ROUTE_RECONCILED_MESSAGE,
    RECONCILE_DOCUMENT_ROUTE_MESSAGE,
    SUSPEND_AND_REFRESH_DOCUMENT_POLICY_MESSAGE,
    TEARDOWN_DOCUMENT_MESSAGE,
    REFRESH_DOCUMENT_POLICY_MESSAGE,
} from "../../../src/shared/messaging/document-messages";
import { STATE_AVAILABILITY } from "../../../src/shared/messaging/view-state-values";
import { classifyYouTubeWatchRouteHandoff } from
    "../../../src/content-script/adapters/youtube-watch-route-handoff";
import { AdapterRegistry } from "../../../src/content-script/adapters/registry";
import type {
    TimestampCandidate,
    TimestampSourceRule,
} from "../../../src/content-script/adapters/types";
import type { DeferredTimestampResolver } from
    "../../../src/content-script/transformation/deferred-timestamp-resolution";

const WATCH_A = "https://www.youtube.com/watch?v=testVID0001";
const WATCH_B = "https://www.youtube.com/watch?v=testVID0002";

const YOUTUBE_LIST_FIXTURES = [
    {
        name: "Home",
        fixturePath:
            "tests/src/content-script/fixtures/youtube/home-modern-relative-only.html",
        url: new URL("https://www.youtube.com/"),
        cardSelector: "ytd-rich-item-renderer",
    },
    {
        name: "Search",
        fixturePath:
            "tests/src/content-script/fixtures/youtube/search-legacy-relative-only.html",
        url: new URL("https://www.youtube.com/results?search_query=fixture"),
        cardSelector: "ytd-video-renderer",
    },
    {
        name: "Channel Videos",
        fixturePath:
            "tests/src/content-script/fixtures/youtube/" +
            "channel-videos-modern-relative-only.html",
        url: new URL("https://www.youtube.com/@fixture-channel/videos"),
        cardSelector: "yt-lockup-view-model",
    },
] as const;

/**
 * Flushes one MutationObserver delivery and its scheduled reconciliation.
 */
async function flushMutations(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
}

/**
 * Creates a controllable extension message source.
 *
 * @returns - Message source and synchronous dispatch helper.
 */
function messages() {
    let listener: (
        (message: unknown, sender?: unknown, response?: (value: unknown) => void) => unknown
    ) | undefined;
    return {
        onMessage: {
            addListener: vi.fn((next: typeof listener) => {
                listener = next;
            }),
        },
        dispatch(message: unknown): unknown {
            let result: unknown;
            listener?.(message, undefined, (value) => {
                result = value;
            });
            return result;
        },
    };
}

/**
 * Creates a controllable same-document route event source.
 *
 * @returns - Route source and synchronous dispatch helper.
 */
function routeEvents() {
    let listener: (() => void) | undefined;
    return {
        addListener: vi.fn((next: () => void) => {
            listener = next;
        }),
        dispatch(): void {
            listener?.();
        },
    };
}

/**
 * Installs one canonical Watch label with optional identity-bound player data.
 *
 * @param videoId - Invented canonical Watch identity.
 * @param publication - Explicit publication value.
 * @param includePlayer - Whether to include loaded dual-ID player data.
 */
function setWatchMarkup(videoId: string, publication: string, includePlayer = true): void {
    document.head.innerHTML = `<meta itemprop="datePublished" content="${publication}">`
        + (includePlayer
            ? `<script>var ytInitialPlayerResponse = ${JSON.stringify({
                videoDetails: { videoId },
                microformat: {
                    playerMicroformatRenderer: {
                        externalVideoId: videoId,
                        publishDate: publication,
                    },
                },
            })};</script>`
            : "");
    document.body.innerHTML = `
        <ytd-watch-metadata>
            <div id="info-strings"><yt-formatted-string>relative</yt-formatted-string></div>
        </ytd-watch-metadata>`;
}

/**
 * Replaces or creates the exact loaded player assignment for one invented identity.
 *
 * @param videoId - Invented canonical Watch identity.
 * @param publication - Explicit publication value.
 */
function setWatchPlayer(videoId: string, publication: string): void {
    const script = document.head.querySelector("script") ?? document.createElement("script");
    script.textContent = `var ytInitialPlayerResponse = ${JSON.stringify({
        videoDetails: { videoId },
        microformat: {
            playerMicroformatRenderer: {
                externalVideoId: videoId,
                publishDate: publication,
            },
        },
    })};`;
    if (!script.isConnected) {
        document.head.append(script);
    }
}

/**
 * Returns the current generated exact publication output.
 *
 * @returns - Current generated output, or null.
 */
function watchOutput(): HTMLTimeElement | null {
    return document.querySelector("time[data-no-more-ago-output]");
}

/**
 * Requires the current approved Watch publication label.
 *
 * @returns - Current page-owned Watch label.
 */
function requireWatchLabel(): Element {
    const label = document.querySelector("ytd-watch-metadata yt-formatted-string");
    if (!label) {
        throw new Error("Expected Watch publication label");
    }
    return label;
}

/**
 * Creates a ready document-state response.
 *
 * @param enabled - Effective top-level policy.
 * @param revision - Settings revision.
 * @returns - Ready document state.
 */
function state(enabled = true, revision = 1) {
    return {
        availability: STATE_AVAILABILITY.READY,
        revision,
        enabled,
        display: { formatMode: "system" as const, timeZone: { mode: "utc" as const } },
        debugEnabled: false,
    };
}

/**
 * Installs a test document runtime.
 *
 * @param source - Controllable message source.
 * @param load - Document-state loader.
 * @returns - Runtime handle.
 */
function install(
    source: ReturnType<typeof messages>,
    load: () => Promise<unknown> = async () => state(),
) {
    return installContentRuntime({
        document,
        url: new URL("https://example.test/page"),
        locales: ["en-US"],
        loadDocumentState: load,
        messages: source,
    });
}

describe("installContentRuntime", () => {
    beforeEach(() => {
        const current = (document as unknown as Record<symbol, {
            handle?: { teardown(): void };
        } | undefined>)[
            DOCUMENT_RUNTIME_SLOT
        ];
        current?.handle?.teardown();
        Reflect.deleteProperty(document, DOCUMENT_RUNTIME_SLOT);
        document.body.innerHTML =
            '<time datetime="2026-08-23T10:15:00Z">relative</time>';
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("starts while the document is still loading", async () => {
        const source = messages();
        install(source);
        await Promise.resolve();
        await Promise.resolve();

        expect(document.querySelector("[data-no-more-ago-output]")).not.toBeNull();
        expect(source.dispatch({ type: DOCUMENT_STATUS_MESSAGE })).toEqual({
            type: DOCUMENT_STATUS_MESSAGE,
            phase: DOCUMENT_PHASE.ACTIVE,
        });
    });

    it("does not create output for a ready disabled state", async () => {
        const source = messages();
        install(source, async () => state(false));
        await Promise.resolve();
        await Promise.resolve();

        expect(document.querySelector("[data-no-more-ago-output]")).toBeNull();
        expect(source.dispatch({ type: DOCUMENT_STATUS_MESSAGE })).toEqual({
            type: DOCUMENT_STATUS_MESSAGE,
            phase: DOCUMENT_PHASE.STOPPED,
        });
    });

    it("does not hydrate again when an active singleton is reinjected", async () => {
        const source = messages();
        const load = vi.fn(async () => state());
        const first = install(source, load);
        await Promise.resolve();
        await Promise.resolve();
        const second = install(source, load);

        expect(second).toBe(first);
        expect(load).toHaveBeenCalledTimes(1);
        expect(source.onMessage.addListener).toHaveBeenCalledTimes(1);
    });

    it("suspends synchronously and remains stopped after rejected hydration", async () => {
        let reject: ((error: Error) => void) | undefined;
        const source = messages();
        const load = vi.fn(() => new Promise<unknown>((_, fail) => {
            reject = fail;
        }));
        install(source, load);
        const response = source.dispatch({
            type: SUSPEND_AND_REFRESH_DOCUMENT_POLICY_MESSAGE,
        });
        expect(response).toEqual({ type: DOCUMENT_POLICY_REFRESHED_MESSAGE });
        expect(source.dispatch({ type: DOCUMENT_STATUS_MESSAGE })).toEqual({
            type: DOCUMENT_STATUS_MESSAGE,
            phase: DOCUMENT_PHASE.WAITING,
        });
        reject?.(new Error("unavailable"));
        await Promise.resolve();
        await Promise.resolve();
        expect(source.dispatch({ type: DOCUMENT_STATUS_MESSAGE })).toEqual({
            type: DOCUMENT_STATUS_MESSAGE,
            phase: DOCUMENT_PHASE.STOPPED,
        });
    });

    it("tears down synchronously and ignores a stale hydration response", async () => {
        let resolve: ((value: unknown) => void) | undefined;
        const source = messages();
        install(source, () => new Promise((complete) => {
            resolve = complete;
        }));
        const response = source.dispatch({ type: TEARDOWN_DOCUMENT_MESSAGE });

        expect(response).toEqual({ type: DOCUMENT_TORN_DOWN_MESSAGE });
        resolve?.(state());
        await Promise.resolve();
        await Promise.resolve();
        expect(document.querySelector("[data-no-more-ago-output]")).toBeNull();
        expect(source.dispatch({ type: DOCUMENT_STATUS_MESSAGE })).toEqual({
            type: DOCUMENT_STATUS_MESSAGE,
            phase: DOCUMENT_PHASE.STOPPED,
        });
    });

    it("refreshes an active runtime in a new generation without teardown", async () => {
        const source = messages();
        const load = vi.fn()
            .mockResolvedValueOnce(state(true, 1))
            .mockResolvedValueOnce({
                ...state(true, 2),
                display: {
                    formatMode: "custom" as const,
                    pattern: "yyyy" as const,
                    timeZone: { mode: "utc" as const },
                },
            });
        install(source, load);
        await Promise.resolve();
        await Promise.resolve();
        expect(source.dispatch({ type: REFRESH_DOCUMENT_POLICY_MESSAGE })).toEqual({
            type: DOCUMENT_POLICY_REFRESHED_MESSAGE,
        });
        expect(load).toHaveBeenCalledTimes(2);
        await Promise.resolve();
        expect(source.dispatch({ type: DOCUMENT_STATUS_MESSAGE })).toEqual({
            type: DOCUMENT_STATUS_MESSAGE,
            phase: DOCUMENT_PHASE.ACTIVE,
        });
    });

    it("fails closed when an active policy refresh is rejected", async () => {
        const source = messages();
        const load = vi.fn()
            .mockResolvedValueOnce(state(true, 1))
            .mockRejectedValueOnce(new Error("unavailable"));
        install(source, load);
        await Promise.resolve();
        await Promise.resolve();
        expect(document.querySelector("[data-no-more-ago-output]")).not.toBeNull();

        source.dispatch({ type: REFRESH_DOCUMENT_POLICY_MESSAGE });
        await Promise.resolve();
        await Promise.resolve();

        expect(document.querySelector("[data-no-more-ago-output]")).toBeNull();
        expect(source.dispatch({ type: DOCUMENT_STATUS_MESSAGE })).toEqual({
            type: DOCUMENT_STATUS_MESSAGE,
            phase: DOCUMENT_PHASE.FAILED,
        });
    });

    it("invalidates a waiting hydration when policy refresh arrives", async () => {
        const source = messages();
        const resolvers: Array<(value: unknown) => void> = [];
        const load = vi.fn(() => new Promise<unknown>((resolve) => {
            resolvers.push(resolve);
        }));
        install(source, load);
        expect(load).toHaveBeenCalledTimes(1);
        expect(source.dispatch({ type: REFRESH_DOCUMENT_POLICY_MESSAGE })).toEqual({
            type: DOCUMENT_POLICY_REFRESHED_MESSAGE,
        });
        expect(load).toHaveBeenCalledTimes(2);

        resolvers[0]?.(state(false, 1));
        await Promise.resolve();
        resolvers[1]?.(state(true, 2));
        await Promise.resolve();
        await Promise.resolve();
        expect(source.dispatch({ type: DOCUMENT_STATUS_MESSAGE })).toEqual({
            type: DOCUMENT_STATUS_MESSAGE,
            phase: DOCUMENT_PHASE.ACTIVE,
        });
    });

    it("restores and reprocesses Hacker News across site policy refreshes", async () => {
        document.body.innerHTML = `<span class="age" title="2026-08-28T10:09:07.000000Z">`
            + `<a id="hn-policy-link" href="item?id=1">1 hour ago</a></span>`;
        const source = messages();
        const link = document.getElementById("hn-policy-link");
        if (!(link instanceof HTMLAnchorElement)) {
            throw new Error("Expected Hacker News link");
        }
        let enabled = true;
        let revision = 1;
        installContentRuntime({
            document,
            url: new URL("https://news.ycombinator.com/item?id=1"),
            locales: ["en-US"],
            loadDocumentState: async () => state(enabled, revision),
            messages: source,
        });
        await Promise.resolve();
        await Promise.resolve();
        expect(link.textContent).not.toBe("1 hour ago");
        enabled = false;
        revision = 2;
        expect(source.dispatch({ type: SUSPEND_AND_REFRESH_DOCUMENT_POLICY_MESSAGE }))
            .toEqual({ type: DOCUMENT_POLICY_REFRESHED_MESSAGE });
        expect(link.textContent).toBe("1 hour ago");
        await Promise.resolve();
        await Promise.resolve();
        enabled = true;
        revision = 3;
        expect(source.dispatch({ type: REFRESH_DOCUMENT_POLICY_MESSAGE }))
            .toEqual({ type: DOCUMENT_POLICY_REFRESHED_MESSAGE });
        await Promise.resolve();
        await Promise.resolve();
        expect(link.textContent).not.toBe("1 hour ago");
        expect(document.getElementById("hn-policy-link")).toBe(link);
        expect(source.dispatch({ type: TEARDOWN_DOCUMENT_MESSAGE }))
            .toEqual({ type: DOCUMENT_TORN_DOWN_MESSAGE });
        expect(link.textContent).toBe("1 hour ago");
    });

    it("restores and reprocesses Telegram Web K across site policy refreshes", async () => {
        document.body.innerHTML = '<div class="bubble" data-timestamp="1778774880">'
            + '<span class="time-inner"><span id="telegram-policy-clock" '
            + 'class="i18n">16:08</span></span></div>';
        const source = messages();
        const clock = document.getElementById("telegram-policy-clock");
        if (!clock) {
            throw new Error("Expected Telegram policy clock");
        }
        let enabled = true;
        let revision = 1;
        installContentRuntime({
            document,
            url: new URL("https://web.telegram.org/k/#@fictional"),
            locales: ["en-US"],
            loadDocumentState: async () => state(enabled, revision),
            messages: source,
        });
        await Promise.resolve();
        await Promise.resolve();
        expect(clock.textContent).not.toBe("16:08");
        enabled = false;
        revision = 2;
        expect(source.dispatch({ type: SUSPEND_AND_REFRESH_DOCUMENT_POLICY_MESSAGE }))
            .toEqual({ type: DOCUMENT_POLICY_REFRESHED_MESSAGE });
        expect(clock.textContent).toBe("16:08");
        await Promise.resolve();
        await Promise.resolve();
        enabled = true;
        revision = 3;
        expect(source.dispatch({ type: REFRESH_DOCUMENT_POLICY_MESSAGE }))
            .toEqual({ type: DOCUMENT_POLICY_REFRESHED_MESSAGE });
        await Promise.resolve();
        await Promise.resolve();
        expect(clock.textContent).not.toBe("16:08");
        expect(source.dispatch({ type: TEARDOWN_DOCUMENT_MESSAGE }))
            .toEqual({ type: DOCUMENT_TORN_DOWN_MESSAGE });
        expect(clock.textContent).toBe("16:08");
    });
    it.each(["global", "per-host"] as const)(
        "restores synchronously and re-enables current Watch identity for %s policy",
        async (policyPath) => {
            setWatchMarkup("testVID0001", "2026-08-01");
            const watchA = requireWatchLabel();
            const watchAOriginal = watchA.outerHTML;
            let currentHref = WATCH_A;
            let finishSuspendedHydration: ((value: unknown) => void) | undefined;
            const load = vi.fn(async (): Promise<unknown> => state(true, 3))
                .mockResolvedValueOnce(state(true, 1));
            if (policyPath === "per-host") {
                load.mockImplementationOnce(() => new Promise((resolve) => {
                    finishSuspendedHydration = resolve;
                }));
            }
            const source = messages();
            const forbiddenFetch = vi.fn<typeof fetch>(() => {
                throw new Error("Network access is forbidden in Watch lifecycle tests");
            });
            vi.stubGlobal("fetch", forbiddenFetch);
            const installWatchRuntime = (): void => {
                installContentRuntime({
                    document,
                    url: new URL(currentHref),
                    urlProvider: () => new URL(currentHref),
                    routeHandoffClassifier: classifyYouTubeWatchRouteHandoff,
                    locales: ["en-US"],
                    loadDocumentState: load,
                    messages: source,
                });
            };
            installWatchRuntime();
            await flushMutations();

            expect(watchOutput()?.dateTime).toBe("2026-08-01");
            expect(watchA.hasAttribute("hidden")).toBe(true);
            expect(watchA.hasAttribute(OWNED_SOURCE_ATTRIBUTE)).toBe(true);

            const response = source.dispatch({
                type: policyPath === "global"
                    ? TEARDOWN_DOCUMENT_MESSAGE
                    : SUSPEND_AND_REFRESH_DOCUMENT_POLICY_MESSAGE,
            });
            expect(response).toEqual({
                type: policyPath === "global"
                    ? DOCUMENT_TORN_DOWN_MESSAGE
                    : DOCUMENT_POLICY_REFRESHED_MESSAGE,
            });
            expect(watchOutput()).toBeNull();
            expect(document.querySelector(`[${OWNED_SOURCE_ATTRIBUTE}]`)).toBeNull();
            expect(document.querySelector(`[${OWNED_OUTPUT_ATTRIBUTE}]`)).toBeNull();
            expect(watchA.outerHTML).toBe(watchAOriginal);
            expect(watchA.hasAttribute("hidden")).toBe(false);

            if (policyPath === "per-host") {
                expect(source.dispatch({ type: DOCUMENT_STATUS_MESSAGE })).toEqual({
                    type: DOCUMENT_STATUS_MESSAGE,
                    phase: DOCUMENT_PHASE.WAITING,
                });
                finishSuspendedHydration?.(state(false, 2));
                await flushMutations();
            }
            expect(source.dispatch({ type: DOCUMENT_STATUS_MESSAGE })).toEqual({
                type: DOCUMENT_STATUS_MESSAGE,
                phase: DOCUMENT_PHASE.STOPPED,
            });

            currentHref = WATCH_B;
            setWatchMarkup("testVID0002", "2026-08-02");
            document.head.querySelector("meta")?.setAttribute("content", "invalid-metadata");
            if (policyPath === "global") {
                installWatchRuntime();
            } else {
                expect(source.dispatch({ type: REFRESH_DOCUMENT_POLICY_MESSAGE })).toEqual({
                    type: DOCUMENT_POLICY_REFRESHED_MESSAGE,
                });
            }
            await flushMutations();

            const watchB = requireWatchLabel();
            expect(watchOutput()?.dateTime).toBe("2026-08-02");
            expect(document.querySelector('time[datetime="2026-08-01"]')).toBeNull();
            expect(watchB.hasAttribute("hidden")).toBe(true);
            expect(watchB.hasAttribute(OWNED_SOURCE_ATTRIBUTE)).toBe(true);
            expect(source.dispatch({ type: DOCUMENT_STATUS_MESSAGE })).toEqual({
                type: DOCUMENT_STATUS_MESSAGE,
                phase: DOCUMENT_PHASE.ACTIVE,
            });
            expect(forbiddenFetch).not.toHaveBeenCalled();
        },
    );

    it.each(["url-provider", "route-classifier"] as const)(
        "fails closed before activation hydration when the %s fails",
        async (failure) => {
            setWatchMarkup("testVID0001", "2026-08-01");
            let currentHref = WATCH_A;
            let failProvider = false;
            let failClassifier = false;
            const source = messages();
            const load = vi.fn(async () => state());
            const classifier = vi.fn((input: Parameters<
                typeof classifyYouTubeWatchRouteHandoff
            >[0]) => {
                if (failClassifier) {
                    throw new Error("Route classification unavailable");
                }
                return classifyYouTubeWatchRouteHandoff(input);
            });
            const installRuntime = (): void => {
                installContentRuntime({
                    document,
                    url: new URL(currentHref),
                    urlProvider: () => {
                        if (failProvider) {
                            throw new Error("Current URL unavailable");
                        }
                        return new URL(currentHref);
                    },
                    routeHandoffClassifier: classifier,
                    locales: ["en-US"],
                    loadDocumentState: load,
                    messages: source,
                });
            };
            installRuntime();
            await flushMutations();
            expect(watchOutput()).not.toBeNull();
            source.dispatch({ type: TEARDOWN_DOCUMENT_MESSAGE });
            currentHref = WATCH_B;
            failProvider = failure === "url-provider";
            failClassifier = failure === "route-classifier";

            installRuntime();

            expect(load).toHaveBeenCalledOnce();
            expect(watchOutput()).toBeNull();
            expect(source.dispatch({ type: DOCUMENT_STATUS_MESSAGE })).toEqual({
                type: DOCUMENT_STATUS_MESSAGE,
                phase: DOCUMENT_PHASE.FAILED,
            });
        },
    );

    it.each(YOUTUBE_LIST_FIXTURES)(
        "keeps ordinary no-source $name mutations inert through detach and reattach",
        async ({ fixturePath, url, cardSelector }) => {
            document.documentElement.innerHTML = await readFile(fixturePath, "utf8");
            const forbiddenFetch = vi.fn<typeof fetch>(() => {
                throw new Error("Network access is forbidden in runtime fixtures");
            });
            vi.stubGlobal("fetch", forbiddenFetch);
            const reportDiagnostic = vi.fn(async () => undefined);
            const source = messages();
            let runtime: ReturnType<typeof installContentRuntime> | undefined;

            try {
                runtime = installContentRuntime({
                    document,
                    url,
                    locales: ["en-US"],
                    loadDocumentState: async () => ({
                        ...state(),
                        debugEnabled: true,
                    }),
                    reportDiagnostic,
                    messages: source,
                });
                await flushMutations();

                expect(source.dispatch({ type: DOCUMENT_STATUS_MESSAGE })).toEqual({
                    type: DOCUMENT_STATUS_MESSAGE,
                    phase: DOCUMENT_PHASE.ACTIVE,
                });
                const cards = Array.from(document.querySelectorAll(cardSelector));
                const target = cards[0];
                const sentinel = cards[1];
                if (!target || !sentinel) {
                    throw new Error(`Expected at least two cards for ${cardSelector}`);
                }
                const originalParent = target.parentNode;
                if (!originalParent) {
                    throw new Error(`Expected a card parent for ${cardSelector}`);
                }
                const originalNextSibling = target.nextSibling;
                const sentinelMarkup = sentinel.outerHTML;
                const expectOrdinaryNoSourceState = (): void => {
                    expect(source.dispatch({ type: DOCUMENT_STATUS_MESSAGE })).toEqual({
                        type: DOCUMENT_STATUS_MESSAGE,
                        phase: DOCUMENT_PHASE.ACTIVE,
                    });
                    expect(document.querySelector(`[${OWNED_SOURCE_ATTRIBUTE}]`)).toBeNull();
                    expect(document.querySelector(`[${OWNED_OUTPUT_ATTRIBUTE}]`)).toBeNull();
                    expect(document.querySelector("time")).toBeNull();
                    expect(sentinel.outerHTML).toBe(sentinelMarkup);
                    expect(reportDiagnostic).not.toHaveBeenCalled();
                    expect(forbiddenFetch).not.toHaveBeenCalled();
                };
                expectOrdinaryNoSourceState();
                reportDiagnostic.mockClear();

                const ordinaryChild = document.createElement("div");
                ordinaryChild.textContent = "page-authored fixture child";
                target.append(ordinaryChild);
                await flushMutations();
                expectOrdinaryNoSourceState();

                target.classList.add("fixture-layout-change");
                await flushMutations();
                expectOrdinaryNoSourceState();

                target.classList.remove("fixture-layout-change");
                await flushMutations();
                expectOrdinaryNoSourceState();

                target.setAttribute("hidden", "");
                await flushMutations();
                expectOrdinaryNoSourceState();

                target.removeAttribute("hidden");
                await flushMutations();
                expectOrdinaryNoSourceState();

                target.remove();
                await flushMutations();
                expectOrdinaryNoSourceState();

                originalParent.insertBefore(target, originalNextSibling);
                await flushMutations();
                expectOrdinaryNoSourceState();
                expect(target.parentNode).toBe(originalParent);
                expect(target.nextSibling).toBe(originalNextSibling);
                expect(target.contains(ordinaryChild)).toBe(true);
            } finally {
                runtime?.teardown();
            }
        },
    );

    it("keeps stale deferred route completion offline and out of diagnostics", async () => {
        document.body.innerHTML = '<span data-identity="private-video-id">private page text</span>';
        const timestampSource = document.querySelector("span");
        if (!timestampSource) {
            throw new Error("Expected deferred runtime source");
        }
        const noMatch: TimestampSourceRule = {
            id: "no-match",
            mutationAttributes: [],
            matches: () => false,
            matchesElement: () => false,
            discover: () => [],
            extract: () => null,
        };
        const unresolved: TimestampSourceRule = {
            id: "runtime-unresolved",
            mutationAttributes: [],
            matches: () => true,
            matchesElement: (element) => element === timestampSource,
            discover: () => [timestampSource],
            extract: () => null,
        };
        const rejections: Array<(error: Error) => void> = [];
        const resolveDeferred = vi.fn(() =>
            new Promise<TimestampCandidate | null>((_resolve, reject) => {
                rejections.push(reject);
            }));
        const resolver: DeferredTimestampResolver = {
            identify: (element, url) => {
                const identity = element.getAttribute("data-identity");
                return identity === null ? null : `${identity}:${url.pathname}`;
            },
            resolve: resolveDeferred,
        };
        const forbiddenFetch = vi.fn<typeof fetch>(() => {
            throw new Error("Network access is forbidden");
        });
        vi.stubGlobal("fetch", forbiddenFetch);
        const reportDiagnostic = vi.fn(async () => undefined);
        let currentHref = "https://example.test/private-a";
        const source = messages();
        installContentRuntime({
            document,
            url: new URL(currentHref),
            urlProvider: () => new URL(currentHref),
            locales: ["en-US"],
            registry: new AdapterRegistry([unresolved], noMatch),
            deferredResolver: resolver,
            loadDocumentState: async () => ({ ...state(), debugEnabled: true }),
            reportDiagnostic,
            messages: source,
        });
        await flushMutations();
        expect(resolveDeferred).toHaveBeenCalledOnce();

        currentHref = "https://example.test/private-b";
        source.dispatch({ type: RECONCILE_DOCUMENT_ROUTE_MESSAGE });
        expect(resolveDeferred).toHaveBeenCalledTimes(2);
        rejections[0]?.(new Error("private rejection text"));
        await flushMutations();

        expect(document.querySelector(`[${OWNED_OUTPUT_ATTRIBUTE}]`)).toBeNull();
        expect(forbiddenFetch).not.toHaveBeenCalled();
        const payload = JSON.stringify(reportDiagnostic.mock.calls);
        for (const forbidden of [
            "private-video-id",
            "private page text",
            "private-a",
            "private-b",
            "private rejection text",
        ]) {
            expect(payload).not.toContain(forbidden);
        }
    });

    it(
        "handles active signal-first, DOM-first, duplicate, and metadata-only Watch handoffs",
        async () => {
            setWatchMarkup("testVID0001", "2026-08-01");
            let currentHref = WATCH_A;
            const source = messages();
            const events = routeEvents();
            const classifier = vi.fn(classifyYouTubeWatchRouteHandoff);
            installContentRuntime({
                document,
                url: new URL(currentHref),
                urlProvider: () => new URL(currentHref),
                routeEvents: events,
                routeHandoffClassifier: classifier,
                locales: ["en-US"],
                loadDocumentState: async () => state(),
                messages: source,
            });
            await flushMutations();
            expect(watchOutput()?.dateTime).toBe("2026-08-01");

            currentHref = WATCH_B;
            events.dispatch();
            expect(watchOutput()).toBeNull();
            expect(document.querySelector("yt-formatted-string")?.hasAttribute("hidden"))
                .toBe(false);
            document.head.querySelector("meta")?.setAttribute("content", "2026-08-02");
            setWatchPlayer("testVID0002", "2026-08-02");
            await flushMutations();
            await flushMutations();
            expect(watchOutput()?.dateTime).toBe("2026-08-02");

            setWatchPlayer("testVID0001", "2026-08-03");
            document.head.querySelector("meta")?.setAttribute("content", "2026-08-03");
            await flushMutations();
            currentHref = WATCH_A;
            events.dispatch();
            expect(watchOutput()?.dateTime).toBe("2026-08-03");

            const duplicateOutput = watchOutput();
            const classifierCalls = classifier.mock.calls.length;
            events.dispatch();
            expect(classifier).toHaveBeenCalledTimes(classifierCalls);
            expect(watchOutput()).toBe(duplicateOutput);

            document.head.querySelector("script")?.remove();
            await flushMutations();
            document.head.querySelector("meta")?.setAttribute("content", "2026-08-04");
            const label = document.querySelector("yt-formatted-string");
            if (label) {
                label.textContent = "new relative label";
            }
            await flushMutations();
            expect(watchOutput()).toBeNull();
            expect(label?.hasAttribute("hidden")).toBe(false);
        },
    );

    it.each(["before", "after"] as const)(
        "retains a Watch handoff while waiting and resolves loaded data %s activation",
        async (order) => {
            setWatchMarkup("testVID0001", "2026-08-01");
            let currentHref = WATCH_A;
            let complete: ((value: unknown) => void) | undefined;
            const source = messages();
            installContentRuntime({
                document,
                url: new URL(currentHref),
                urlProvider: () => new URL(currentHref),
                routeHandoffClassifier: classifyYouTubeWatchRouteHandoff,
                locales: ["en-US"],
                loadDocumentState: () => new Promise((resolve) => {
                    complete = resolve;
                }),
                messages: source,
            });
            currentHref = WATCH_B;
            expect(source.dispatch({ type: RECONCILE_DOCUMENT_ROUTE_MESSAGE })).toEqual({
                type: DOCUMENT_ROUTE_RECONCILED_MESSAGE,
            });
            if (order === "after") {
                setWatchPlayer("testVID0002", "2026-08-02");
            }
            expect(watchOutput()).toBeNull();
            complete?.(state());
            await flushMutations();

            if (order === "before") {
                expect(watchOutput()).toBeNull();
                setWatchPlayer("testVID0002", "2026-08-02");
                await flushMutations();
                await flushMutations();
            }
            expect(watchOutput()?.dateTime).toBe("2026-08-02");
        },
    );

    it.each([
        {
            name: "initial same-video query",
            routes: [`${WATCH_A}&list=fixture`],
            expectedPublication: "2026-08-01",
        },
        {
            name: "handoff then same-video query",
            routes: [WATCH_B, WATCH_B, `${WATCH_B}&list=fixture`],
            expectedPublication: null,
        },
        {
            name: "handoff, unsupported clear, and Watch return",
            routes: [WATCH_B, "https://www.youtube.com/", WATCH_A],
            expectedPublication: null,
        },
        {
            name: "direct handoff and return",
            routes: [WATCH_B, WATCH_A, WATCH_A],
            expectedPublication: null,
        },
    ])("applies retained waiting policy for $name", async ({ routes, expectedPublication }) => {
        setWatchMarkup("testVID0001", "2026-08-01", false);
        let currentHref = WATCH_A;
        let complete: ((value: unknown) => void) | undefined;
        const source = messages();
        installContentRuntime({
            document,
            url: new URL(currentHref),
            urlProvider: () => new URL(currentHref),
            routeHandoffClassifier: classifyYouTubeWatchRouteHandoff,
            locales: ["en-US"],
            loadDocumentState: () => new Promise((resolve) => {
                complete = resolve;
            }),
            messages: source,
        });
        for (const route of routes) {
            currentHref = route;
            source.dispatch({ type: RECONCILE_DOCUMENT_ROUTE_MESSAGE });
        }
        complete?.(state());
        await flushMutations();

        expect(watchOutput()?.dateTime ?? null).toBe(expectedPublication);
    });

    it.each(["before", "after"] as const)(
        "retains a Watch handoff while stopped and resolves loaded data %s reactivation",
        async (order) => {
            setWatchMarkup("testVID0001", "2026-08-01");
            let currentHref = WATCH_A;
            const source = messages();
            const load = vi.fn()
                .mockResolvedValueOnce(state(false, 1))
                .mockResolvedValueOnce(state(true, 2));
            installContentRuntime({
                document,
                url: new URL(currentHref),
                urlProvider: () => new URL(currentHref),
                routeHandoffClassifier: classifyYouTubeWatchRouteHandoff,
                locales: ["en-US"],
                loadDocumentState: load,
                messages: source,
            });
            await flushMutations();
            expect(source.dispatch({ type: DOCUMENT_STATUS_MESSAGE })).toEqual({
                type: DOCUMENT_STATUS_MESSAGE,
                phase: DOCUMENT_PHASE.STOPPED,
            });
            currentHref = WATCH_B;
            source.dispatch({ type: RECONCILE_DOCUMENT_ROUTE_MESSAGE });
            if (order === "after") {
                setWatchPlayer("testVID0002", "2026-08-02");
            }
            expect(watchOutput()).toBeNull();
            source.dispatch({ type: REFRESH_DOCUMENT_POLICY_MESSAGE });
            await flushMutations();

            if (order === "before") {
                expect(watchOutput()).toBeNull();
                setWatchPlayer("testVID0002", "2026-08-02");
                await flushMutations();
                await flushMutations();
            }
            expect(watchOutput()?.dateTime).toBe("2026-08-02");
        },
    );

    it.each([
        {
            name: "initial same-video query",
            routes: [`${WATCH_A}&list=fixture`, `${WATCH_A}&list=fixture`],
            expectedPublication: "2026-08-01",
        },
        {
            name: "handoff then same-video query",
            routes: [WATCH_B, WATCH_B, `${WATCH_B}&list=fixture`],
            expectedPublication: null,
        },
        {
            name: "handoff, unsupported clear, and Watch return",
            routes: [WATCH_B, "https://www.youtube.com/", WATCH_A],
            expectedPublication: null,
        },
        {
            name: "direct handoff and return",
            routes: [WATCH_B, WATCH_A, WATCH_A],
            expectedPublication: null,
        },
    ])("applies retained stopped policy for $name", async ({ routes, expectedPublication }) => {
        setWatchMarkup("testVID0001", "2026-08-01", false);
        let currentHref = WATCH_A;
        const source = messages();
        const classifier = vi.fn(classifyYouTubeWatchRouteHandoff);
        const load = vi.fn()
            .mockResolvedValueOnce(state(false, 1))
            .mockResolvedValueOnce(state(true, 2));
        installContentRuntime({
            document,
            url: new URL(currentHref),
            urlProvider: () => new URL(currentHref),
            routeHandoffClassifier: classifier,
            locales: ["en-US"],
            loadDocumentState: load,
            messages: source,
        });
        await flushMutations();
        for (const route of routes) {
            currentHref = route;
            source.dispatch({ type: RECONCILE_DOCUMENT_ROUTE_MESSAGE });
        }
        expect(watchOutput()).toBeNull();
        source.dispatch({ type: REFRESH_DOCUMENT_POLICY_MESSAGE });
        await flushMutations();

        expect(watchOutput()?.dateTime ?? null).toBe(expectedPublication);
        const duplicateCount = routes.filter((route, index) => route === routes[index - 1]).length;
        if (duplicateCount > 0) {
            expect(classifier).toHaveBeenCalledTimes(routes.length - duplicateCount);
        }
    });

    it.each(YOUTUBE_LIST_FIXTURES)(
        "restores Watch output before routed $name no-op and quarantines a Watch return",
        async ({ fixturePath, url }) => {
            setWatchMarkup("testVID0001", "2026-08-01");
            let currentHref = WATCH_A;
            const source = messages();
            const forbiddenFetch = vi.fn<typeof fetch>(() => {
                throw new Error("Network access is forbidden in runtime fixtures");
            });
            vi.stubGlobal("fetch", forbiddenFetch);
            installContentRuntime({
                document,
                url: new URL(currentHref),
                urlProvider: () => new URL(currentHref),
                routeHandoffClassifier: classifyYouTubeWatchRouteHandoff,
                locales: ["en-US"],
                loadDocumentState: async () => state(),
                messages: source,
            });
            await flushMutations();
            expect(watchOutput()).not.toBeNull();

            currentHref = url.href;
            source.dispatch({ type: RECONCILE_DOCUMENT_ROUTE_MESSAGE });
            document.documentElement.innerHTML = await readFile(fixturePath, "utf8");
            await flushMutations();
            expect(document.querySelector(`[${OWNED_OUTPUT_ATTRIBUTE}]`)).toBeNull();

            setWatchMarkup("testVID0001", "2026-08-03", false);
            currentHref = WATCH_A;
            source.dispatch({ type: RECONCILE_DOCUMENT_ROUTE_MESSAGE });
            await flushMutations();
            expect(watchOutput()).toBeNull();
            expect(forbiddenFetch).not.toHaveBeenCalled();
        },
    );
});
