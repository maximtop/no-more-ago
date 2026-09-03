/**
 * @file Exercises content runtime hydration, policy refresh, and teardown.
 */

import { readFile } from "node:fs/promises";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
/* eslint-disable @typescript-eslint/require-await */
import {
    BLUESKY_LOOKUP_STATUS,
    type BlueskyAppView,
    type BlueskyLookupResult,
    type BlueskyProfileRecord,
} from "../../../src/content-script/adapters/bluesky-appview";
import { DOCUMENT_RUNTIME_SLOT, installContentRuntime } from "../../../src/content-script/runtime";
import {
    OWNED_OUTPUT_ATTRIBUTE,
    OWNED_SOURCE_ATTRIBUTE,
} from "../../../src/content-script/ownership-markers";
import { DocumentTransformationController } from
    "../../../src/content-script/transformation/document-transformation-controller";
import {
    DOCUMENT_PHASE,
    DOCUMENT_POLICY_RECONCILED_MESSAGE,
    DOCUMENT_STATUS_MESSAGE,
    PRESENTATION_UPDATED_MESSAGE,
    RECONCILE_DOCUMENT_POLICY_MESSAGE,
    RECONCILE_DOCUMENT_ROUTE_MESSAGE,
    UPDATE_PRESENTATION_MESSAGE,
} from "../../../src/shared/messaging/document-messages";
import { STATE_AVAILABILITY } from "../../../src/shared/messaging/view-state-values";
import type { TimeZoneSelection } from "../../../src/shared/settings/snapshot";
import { classifyYouTubeWatchRouteHandoff } from
    "../../../src/content-script/adapters/youtube-watch-route-handoff";
import {
    YOUTUBE_LIST_FIXTURE_ID,
    YOUTUBE_LIST_FIXTURES,
    youtubePlayerResponseAssignment,
    type YouTubeListFixtureId,
} from "./adapters/youtube-test-data";

const WATCH_A = "https://www.youtube.com/watch?v=testVID0001";
const WATCH_B = "https://www.youtube.com/watch?v=testVID0002";
const WATCH_C = "https://www.youtube.com/watch?v=testVID0003";

const YOUTUBE_LIST_CARD_SELECTORS = {
    [YOUTUBE_LIST_FIXTURE_ID.HOME]: "ytd-rich-item-renderer",
    [YOUTUBE_LIST_FIXTURE_ID.SEARCH]: "ytd-video-renderer",
    [YOUTUBE_LIST_FIXTURE_ID.CHANNEL_VIDEOS]: "yt-lockup-view-model",
} satisfies Readonly<Record<YouTubeListFixtureId, string>>;

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
            ? `<script>${youtubePlayerResponseAssignment(
                publication,
                videoId,
            )}</script>`
            : "");
    document.body.innerHTML = `
        <ytd-watch-metadata>
            <div id="info-strings"><yt-formatted-string>3 months ago</yt-formatted-string></div>
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
    script.textContent = youtubePlayerResponseAssignment(publication, videoId);
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
 * Creates one revisioned effective-policy command.
 *
 * @param revision - Settings revision carried by the command.
 * @param enabled - Effective document activation policy.
 * @returns - Complete document-policy command.
 */
function policy(revision: number | null, enabled: boolean) {
    return { type: RECONCILE_DOCUMENT_POLICY_MESSAGE, revision, enabled } as const;
}

/**
 * Creates the expected acknowledgement for one policy revision.
 *
 * @param revision - Retained policy revision.
 * @returns - Complete policy acknowledgement.
 */
function policyAcknowledgement(revision: number | null) {
    return { type: DOCUMENT_POLICY_RECONCILED_MESSAGE, revision } as const;
}

/**
 * Allows runtime hydration and presentation work to settle.
 *
 * @returns - Promise settled after queued runtime work.
 */
async function settleRuntime(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
}

/**
 * Installs a test document runtime.
 *
 * @param source - Controllable message source.
 * @param load - Document-state loader.
 * @param onActivityChanged - Optional controller activity observer.
 * @returns - Runtime handle.
 */
function install(
    source: ReturnType<typeof messages>,
    load: () => Promise<unknown> = async () => state(),
    onActivityChanged?: (active: boolean) => void,
) {
    return installContentRuntime({
        document,
        url: new URL("https://example.test/page"),
        locales: ["en-US"],
        loadDocumentState: load,
        ...(onActivityChanged === undefined ? {} : { onActivityChanged }),
        messages: source,
    });
}

/**
 * Adapter-specific setup and assertions for the shared document-policy lifecycle.
 */
interface PolicyLifecycleFixture {
    /**
     * Document URL selecting the adapter under test.
     */
    readonly url: URL;

    /**
     * Checks whether the adapter-owned presentation is currently active.
     */
    readonly isTransformed: () => boolean;

    /**
     * Checks whether the page-owned presentation is currently restored.
     */
    readonly isOriginal: () => boolean;

    /**
     * Verifies that the adapter preserved the original page element identity.
     */
    readonly assertIdentity: () => void;
}

/**
 * Exercises enable, suspend, re-enable, and global teardown for one adapter fixture.
 *
 * @param fixture - Adapter-specific URL and observable presentation assertions.
 */
async function exercisePolicyLifecycle(fixture: PolicyLifecycleFixture): Promise<void> {
    const source = messages();
    let enabled = true;
    let revision = 1;
    installContentRuntime({
        document,
        url: fixture.url,
        urlProvider: () => fixture.url,
        locales: ["en-US"],
        loadDocumentState: async () => state(enabled, revision),
        messages: source,
    });
    await settleRuntime();
    expect(fixture.isTransformed()).toBe(true);

    enabled = false;
    revision = 2;
    expect(source.dispatch(policy(revision, false)))
        .toEqual(policyAcknowledgement(revision));
    expect(fixture.isOriginal()).toBe(true);
    await settleRuntime();

    enabled = true;
    revision = 3;
    expect(source.dispatch(policy(revision, true)))
        .toEqual(policyAcknowledgement(revision));
    await settleRuntime();
    expect(fixture.isTransformed()).toBe(true);
    fixture.assertIdentity();

    expect(source.dispatch(policy(4, false))).toEqual(policyAcknowledgement(4));
    expect(fixture.isOriginal()).toBe(true);
    fixture.assertIdentity();
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
        document.head.innerHTML = "";
        document.body.innerHTML =
            '<time datetime="2026-08-23T10:15:00Z">2 hours ago</time>';
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

    it("reloads current policy when an active singleton is reinjected", async () => {
        const source = messages();
        const load = vi.fn(async () => state());
        const first = install(source, load);
        await Promise.resolve();
        await Promise.resolve();
        const second = install(source, load);

        expect(second).toBe(first);
        expect(load).toHaveBeenCalledTimes(2);
        expect(source.onMessage.addListener).toHaveBeenCalledTimes(1);
    });

    it("reports active and inactive transitions around policy disable", async () => {
        const source = messages();
        const activity = vi.fn<(active: boolean) => void>();
        install(source, async () => state(), activity);
        await settleRuntime();

        expect(activity.mock.calls.map(([active]) => active)).toEqual([true]);
        expect(source.dispatch(policy(2, false))).toEqual(policyAcknowledgement(2));
        expect(activity.mock.calls.map(([active]) => active)).toEqual([true, false]);
    });

    it("never activates the hook for a ready disabled state", async () => {
        const source = messages();
        const activity = vi.fn<(active: boolean) => void>();
        install(source, async () => state(false), activity);
        await settleRuntime();

        expect(activity).not.toHaveBeenCalled();
    });

    it("reports disable and re-enable without duplicate active transitions", async () => {
        const source = messages();
        const activity = vi.fn<(active: boolean) => void>();
        const load = vi.fn()
            .mockResolvedValueOnce(state(true, 1))
            .mockResolvedValueOnce(state(true, 3));
        install(source, load, activity);
        await settleRuntime();

        expect(source.dispatch(policy(2, false))).toEqual(policyAcknowledgement(2));
        expect(source.dispatch(policy(3, true))).toEqual(policyAcknowledgement(3));
        await settleRuntime();

        expect(activity.mock.calls.map(([active]) => active)).toEqual([
            true,
            false,
            true,
        ]);
    });

    it("reports inactive when an enabled refresh fails closed", async () => {
        const source = messages();
        const activity = vi.fn<(active: boolean) => void>();
        const load = vi.fn()
            .mockResolvedValueOnce(state(true, 1))
            .mockRejectedValueOnce(new Error("unavailable"));
        install(source, load, activity);
        await settleRuntime();

        expect(source.dispatch(policy(2, true))).toEqual(policyAcknowledgement(2));
        await settleRuntime();

        expect(activity.mock.calls.map(([active]) => active)).toEqual([true, false]);
    });

    it("synchronizes a replacement hook when an active singleton is reinjected", async () => {
        const source = messages();
        const firstActivity = vi.fn<(active: boolean) => void>();
        const secondActivity = vi.fn<(active: boolean) => void>();
        const load = vi.fn(async () => state());
        install(source, load, firstActivity);
        await settleRuntime();

        install(source, load, secondActivity);

        expect(firstActivity.mock.calls.map(([active]) => active)).toEqual([true]);
        expect(secondActivity.mock.calls.map(([active]) => active)).toEqual([true]);
    });

    it("reports inactive after a synchronous controller startup failure", () => {
        const source = messages();
        const activity = vi.fn<(active: boolean) => void>();
        vi.spyOn(DocumentTransformationController.prototype, "start")
            .mockImplementationOnce(() => {
                throw new Error("controller failed");
            });

        expect(() => installContentRuntime({
            document,
            url: new URL("https://example.test/page"),
            locales: ["en-US"],
            onActivityChanged: activity,
            messages: source,
        })).toThrow("controller failed");
        expect(activity.mock.calls.map(([active]) => active)).toEqual([true, false]);
    });

    it("contains an activity-listener failure without blocking document processing", async () => {
        const source = messages();
        const activity = vi.fn(() => {
            throw new Error("site integration failed");
        });
        install(source, async () => state(), activity);
        await settleRuntime();

        expect(activity).toHaveBeenCalledWith(true);
        expect(document.querySelector("[data-no-more-ago-output]")).not.toBeNull();
        expect(source.dispatch({ type: DOCUMENT_STATUS_MESSAGE })).toEqual({
            type: DOCUMENT_STATUS_MESSAGE,
            phase: DOCUMENT_PHASE.ACTIVE,
        });
    });

    it("keeps activity stable across an enabled policy refresh", async () => {
        const source = messages();
        const activity = vi.fn<(active: boolean) => void>();
        const load = vi.fn()
            .mockResolvedValueOnce(state(true, 1))
            .mockResolvedValueOnce(state(true, 2));
        install(source, load, activity);
        await settleRuntime();

        expect(source.dispatch(policy(2, true))).toEqual(policyAcknowledgement(2));
        await settleRuntime();

        expect(activity.mock.calls.map(([active]) => active)).toEqual([true]);
    });

    it("disables synchronously and ignores the prior hydration", async () => {
        let resolve: ((value: unknown) => void) | undefined;
        const source = messages();
        const load = vi.fn(() => new Promise<unknown>((complete) => {
            resolve = complete;
        }));
        install(source, load);
        const response = source.dispatch(policy(2, false));
        expect(response).toEqual(policyAcknowledgement(2));
        expect(source.dispatch({ type: DOCUMENT_STATUS_MESSAGE })).toEqual({
            type: DOCUMENT_STATUS_MESSAGE,
            phase: DOCUMENT_PHASE.STOPPED,
        });
        resolve?.(state(true, 1));
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
        const response = source.dispatch(policy(2, false));

        expect(response).toEqual(policyAcknowledgement(2));
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
        expect(source.dispatch(policy(2, true))).toEqual(policyAcknowledgement(2));
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

        source.dispatch(policy(2, true));
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
        expect(source.dispatch(policy(2, true))).toEqual(policyAcknowledgement(2));
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

    it("ignores late policy commands after a newer revision", async () => {
        const source = messages();
        let currentState = state(true, 1);
        install(source, async () => currentState);
        await settleRuntime();

        currentState = state(false, 4);
        expect(source.dispatch(policy(4, false))).toEqual(policyAcknowledgement(4));
        expect(document.querySelector("[data-no-more-ago-output]")).toBeNull();

        expect(source.dispatch(policy(3, true))).toEqual(policyAcknowledgement(4));
        await settleRuntime();
        expect(document.querySelector("[data-no-more-ago-output]")).toBeNull();

        currentState = state(true, 5);
        expect(source.dispatch(policy(5, true))).toEqual(policyAcknowledgement(5));
        await settleRuntime();
        expect(document.querySelector("[data-no-more-ago-output]")).not.toBeNull();

        expect(source.dispatch(policy(4, false))).toEqual(policyAcknowledgement(5));
        expect(document.querySelector("[data-no-more-ago-output]")).not.toBeNull();
    });

    it("converges a late unversioned fail-closed command on current state", async () => {
        const source = messages();
        const load = vi.fn(async () => state(true, 5));
        install(source, load);
        await settleRuntime();

        expect(source.dispatch(policy(null, false))).toEqual(policyAcknowledgement(null));
        await settleRuntime();

        expect(load).toHaveBeenCalledTimes(2);
        expect(document.querySelector("[data-no-more-ago-output]")).not.toBeNull();
        expect(source.dispatch({ type: DOCUMENT_STATUS_MESSAGE })).toEqual({
            type: DOCUMENT_STATUS_MESSAGE,
            phase: DOCUMENT_PHASE.ACTIVE,
        });
    });

    it("restores synchronously while an unversioned policy refresh remains pending", async () => {
        const source = messages();
        const load = vi.fn()
            .mockResolvedValueOnce(state(true, 5))
            .mockImplementationOnce(() => new Promise<never>(() => undefined));
        install(source, load);
        await settleRuntime();
        expect(document.querySelector("[data-no-more-ago-output]")).not.toBeNull();

        expect(source.dispatch(policy(null, false))).toEqual(policyAcknowledgement(null));

        expect(document.querySelector("[data-no-more-ago-output]")).toBeNull();
        expect(load).toHaveBeenCalledTimes(2);
    });

    it("lets reinjection hydration replace a stale same-revision document policy", async () => {
        let completeStaleHydration: ((value: unknown) => void) | undefined;
        const source = messages();

        /**
         * Returns a hydration that completes only when the test releases it.
         *
         * @returns - Pending document-state promise.
         */
        const staleLoader = () => new Promise<unknown>((resolve) => {
            completeStaleHydration = resolve;
        });
        const first = install(source, staleLoader);

        expect(source.dispatch(policy(5, false))).toEqual(policyAcknowledgement(5));
        expect(document.querySelector("[data-no-more-ago-output]")).toBeNull();

        const second = install(source, async () => state(true, 5));
        expect(second).toBe(first);
        await settleRuntime();
        expect(document.querySelector("[data-no-more-ago-output]")).not.toBeNull();

        completeStaleHydration?.(state(false, 5));
        await settleRuntime();
        expect(document.querySelector("[data-no-more-ago-output]")).not.toBeNull();
    });

    it("restores and reprocesses Hacker News across site policy refreshes", async () => {
        document.body.innerHTML = `<span class="age" title="2026-08-28T10:09:07.000000Z">`
            + `<a id="hn-policy-link" href="item?id=1">1 hour ago</a></span>`;
        const link = document.getElementById("hn-policy-link");
        if (!(link instanceof HTMLAnchorElement)) {
            throw new Error("Expected Hacker News link");
        }

        await exercisePolicyLifecycle({
            url: new URL("https://news.ycombinator.com/item?id=1"),
            isTransformed: () => link.textContent !== "1 hour ago",
            isOriginal: () => link.textContent === "1 hour ago",
            assertIdentity: () => {
                expect(document.getElementById("hn-policy-link")).toBe(link);
            },
        });
    });

    it("restores and reprocesses Telegram Web K across site policy refreshes", async () => {
        document.body.innerHTML = '<div class="bubble" data-timestamp="1778774880">'
            + '<span class="time-inner"><span id="telegram-policy-clock" '
            + 'class="i18n">2 hours ago</span></span></div>';
        const clock = document.getElementById("telegram-policy-clock");
        if (!clock) {
            throw new Error("Expected Telegram policy clock");
        }

        await exercisePolicyLifecycle({
            url: new URL("https://web.telegram.org/k/#@fictional"),
            isTransformed: () => clock.textContent !== "2 hours ago",
            isOriginal: () => clock.textContent === "2 hours ago",
            assertIdentity: () => {
                expect(document.getElementById("telegram-policy-clock")).toBe(clock);
            },
        });
    });

    it("restores and reprocesses a TikTok direct label across policy changes", async () => {
        const postId = "7639779880711749733";
        document.head.innerHTML = '<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" '
            + 'type="application/json">'
            + `{"itemInfo":{"itemStruct":{"id":"${postId}",`
            + '"createTime":"1778774880"}}}</script>';
        document.body.innerHTML = '<div data-e2e="browser-nickname">'
            + '<span>Fictional</span><span> · </span>'
            + '<span id="tiktok-policy-date">3d</span></div>';
        const date = document.getElementById("tiktok-policy-date");
        if (!date) {
            throw new Error("Expected TikTok policy date");
        }

        await exercisePolicyLifecycle({
            url: new URL(`https://www.tiktok.com/@fictional/video/${postId}`),
            isTransformed: () => date.textContent !== "3d",
            isOriginal: () => date.textContent === "3d",
            assertIdentity: () => {
                expect(document.getElementById("tiktok-policy-date")).toBe(date);
            },
        });
    });

    it("reuses resolved Bluesky time across presentation changes", async () => {
        document.head.innerHTML = '<base href="https://bsky.app/">';
        document.body.innerHTML = `<article><a id="bluesky-runtime-source"
            href="/profile/alice.example/post/3runtime"
            aria-label="localized" data-tooltip="localized">
            <span aria-hidden="true">· </span>2h</a></article>`;
        const source = messages();
        const label = document.getElementById("bluesky-runtime-source")?.lastChild;
        if (!(label instanceof Text)) {
            throw new Error("Expected Bluesky runtime label");
        }
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
        const initialTimeZone: TimeZoneSelection = { mode: "utc" };
        installContentRuntime({
            document,
            url: new URL("https://bsky.app/"),
            locales: ["en-US"],
            loadDocumentState: async () => ({
                ...state(true, 1),
                display: {
                    formatMode: "custom" as const,
                    pattern: "yyyy-MM-dd HH:mm",
                    timeZone: initialTimeZone,
                },
            }),
            messages: source,
            blueskyAppView: appView,
        });

        await vi.waitFor(() => {
            expect(label.data).toBe("2026-08-31 10:15");
        });
        expect(source.dispatch({
            type: UPDATE_PRESENTATION_MESSAGE,
            revision: 2,
            display: {
                formatMode: "custom",
                pattern: "dd/MM/yyyy HH:mm",
                timeZone: initialTimeZone,
            },
        })).toEqual({ type: PRESENTATION_UPDATED_MESSAGE, revision: 2 });
        expect(label.data).toBe("31/08/2026 10:15");

        expect(source.dispatch({
            type: UPDATE_PRESENTATION_MESSAGE,
            revision: 3,
            display: {
                formatMode: "custom",
                pattern: "dd/MM/yyyy HH:mm",
                timeZone: { mode: "iana", identifier: "America/New_York" },
            },
        })).toEqual({ type: PRESENTATION_UPDATED_MESSAGE, revision: 3 });
        expect(label.data).toBe("31/08/2026 06:15");
        expect(getProfiles).toHaveBeenCalledTimes(1);
        expect(getPosts).toHaveBeenCalledTimes(1);
    });

    it("makes a disabled Bluesky generation inert before fresh reactivation", async () => {
        document.head.innerHTML = '<base href="https://bsky.app/">';
        document.body.innerHTML = `<article><a id="bluesky-policy-source"
            href="/profile/alice.example/post/3policy"
            aria-label="localized" data-tooltip="localized">
            <span aria-hidden="true">· </span>2h</a></article>`;
        const source = messages();
        const label = document.getElementById("bluesky-policy-source")?.lastChild;
        if (!(label instanceof Text)) {
            throw new Error("Expected Bluesky policy label");
        }
        let enabled = true;
        let revision = 1;
        let resolveFirst: ((value: BlueskyLookupResult<BlueskyProfileRecord>) => void)
            | undefined;
        const firstProfiles = new Promise<BlueskyLookupResult<BlueskyProfileRecord>>(
            (resolve) => {
                resolveFirst = resolve;
            },
        );
        let profileInvocation = 0;
        const getProfiles = vi.fn<BlueskyAppView["getProfiles"]>(async (actors) => {
            profileInvocation += 1;
            if (profileInvocation === 1) {
                return firstProfiles;
            }
            return {
                status: BLUESKY_LOOKUP_STATUS.SUCCESS,
                records: actors.map((actor) => ({ actor, did: "did:plc:alice" })),
            };
        });
        const getPosts = vi.fn<BlueskyAppView["getPosts"]>(async (uris) => ({
            status: BLUESKY_LOOKUP_STATUS.SUCCESS,
            records: uris.map((uri) => ({
                uri,
                indexedAt: "2026-08-31T10:15:00.000Z",
            })),
        }));
        installContentRuntime({
            document,
            url: new URL("https://bsky.app/"),
            locales: ["en-US"],
            loadDocumentState: async () => state(enabled, revision),
            messages: source,
            blueskyAppView: { getProfiles, getPosts },
        });
        await vi.waitFor(() => {
            expect(getProfiles).toHaveBeenCalledTimes(1);
        });

        enabled = false;
        revision = 2;
        expect(source.dispatch(policy(revision, false)))
            .toEqual(policyAcknowledgement(revision));
        expect(label.data).toBe("2h");
        resolveFirst?.({
            status: BLUESKY_LOOKUP_STATUS.SUCCESS,
            records: [{ actor: "alice.example", did: "did:plc:alice" }],
        });
        await settleRuntime();
        expect(label.data).toBe("2h");
        expect(getPosts).not.toHaveBeenCalled();

        enabled = true;
        revision = 3;
        expect(source.dispatch(policy(revision, true)))
            .toEqual(policyAcknowledgement(revision));
        await vi.waitFor(() => {
            expect(label.data).not.toBe("2h");
        });
        expect(getProfiles).toHaveBeenCalledTimes(2);
        expect(getPosts).toHaveBeenCalledTimes(1);
    });
    it.each(["global", "per-host"] as const)(
        "restores synchronously and re-enables current Watch identity for %s policy",
        async (policyPath) => {
            setWatchMarkup("testVID0001", "2026-08-01");
            const watchA = requireWatchLabel();
            const watchAOriginal = watchA.outerHTML;
            let currentHref = WATCH_A;
            let currentState = state(true, 1);
            const load = vi.fn(async (): Promise<unknown> => currentState);
            const source = messages();
            const forbiddenFetch = vi.fn<typeof fetch>(() => {
                throw new Error("Network access is forbidden in Watch lifecycle tests");
            });
            vi.stubGlobal("fetch", forbiddenFetch);

            /**
             * Installs the Watch runtime for the current href.
             */
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

            currentState = state(false, 2);
            expect(source.dispatch(policy(2, false))).toEqual(policyAcknowledgement(2));
            expect(watchOutput()).toBeNull();
            expect(document.querySelector(`[${OWNED_SOURCE_ATTRIBUTE}]`)).toBeNull();
            expect(document.querySelector(`[${OWNED_OUTPUT_ATTRIBUTE}]`)).toBeNull();
            expect(watchA.outerHTML).toBe(watchAOriginal);
            expect(watchA.hasAttribute("hidden")).toBe(false);

            expect(source.dispatch({ type: DOCUMENT_STATUS_MESSAGE })).toEqual({
                type: DOCUMENT_STATUS_MESSAGE,
                phase: DOCUMENT_PHASE.STOPPED,
            });

            currentHref = WATCH_B;
            setWatchMarkup("testVID0002", "2026-08-02");
            document.head.querySelector("meta")?.setAttribute("content", "invalid-metadata");
            currentState = state(true, 3);
            if (policyPath === "global") {
                installWatchRuntime();
            } else {
                expect(source.dispatch(policy(3, true))).toEqual(policyAcknowledgement(3));
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
            const load = vi.fn(async () => state(true, 3))
                .mockResolvedValueOnce(state(true, 1));
            const classifier = vi.fn((input: Parameters<
                typeof classifyYouTubeWatchRouteHandoff
            >[0]) => {
                if (failClassifier) {
                    throw new Error("Route classification unavailable");
                }
                return classifyYouTubeWatchRouteHandoff(input);
            });

            /**
             * Installs the runtime with the controllable URL provider.
             */
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
            expect(source.dispatch(policy(2, false))).toEqual(policyAcknowledgement(2));
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
        async ({ id, fixturePath, url }) => {
            document.documentElement.innerHTML = await readFile(fixturePath, "utf8");
            const cardSelector = YOUTUBE_LIST_CARD_SELECTORS[id];
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
                    url: new URL(url),
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
                label.textContent = "2 months ago";
            }
            await flushMutations();
            expect(watchOutput()).toBeNull();
            expect(label?.hasAttribute("hidden")).toBe(false);
        },
    );

    it("samples the live Watch route before both DOM-driven processing paths", async () => {
        setWatchMarkup("testVID0001", "2026-08-01");
        let currentHref = WATCH_A;
        const source = messages();
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
        expect(watchOutput()?.dateTime).toBe("2026-08-01");

        currentHref = WATCH_B;
        setWatchPlayer("testVID0002", "2026-08-02");
        const label = requireWatchLabel();
        label.textContent = "2 months ago";
        await flushMutations();
        await flushMutations();

        expect(watchOutput()?.dateTime).toBe("2026-08-02");
        expect(document.head.querySelector("meta")?.getAttribute("content"))
            .toBe("2026-08-01");

        currentHref = WATCH_C;
        setWatchPlayer("testVID0002", "2026-08-03");
        await flushMutations();
        await flushMutations();

        expect(watchOutput()).toBeNull();
        expect(requireWatchLabel().hasAttribute("hidden")).toBe(false);

        setWatchPlayer("testVID0003", "2026-08-04");
        await flushMutations();
        await flushMutations();

        expect(watchOutput()?.dateTime).toBe("2026-08-04");
    });

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
            expect(source.dispatch({ type: RECONCILE_DOCUMENT_ROUTE_MESSAGE })).toBeUndefined();
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
            expect(source.dispatch(policy(2, true))).toEqual(policyAcknowledgement(2));
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
        expect(source.dispatch(policy(2, true))).toEqual(policyAcknowledgement(2));
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

            currentHref = url;
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
