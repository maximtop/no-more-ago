/**
 * @file Exercises content runtime hydration, policy refresh, and teardown.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
/* eslint-disable @typescript-eslint/require-await */
import {
    BLUESKY_LOOKUP_STATUS,
    type BlueskyAppView,
    type BlueskyLookupResult,
    type BlueskyProfileRecord,
} from "../../../src/content-script/adapters/bluesky-appview";
import { DOCUMENT_RUNTIME_SLOT, installContentRuntime } from "../../../src/content-script/runtime";
import {
    DOCUMENT_POLICY_REFRESHED_MESSAGE,
    DOCUMENT_PHASE,
    DOCUMENT_STATUS_MESSAGE,
    DOCUMENT_TORN_DOWN_MESSAGE,
    SUSPEND_AND_REFRESH_DOCUMENT_POLICY_MESSAGE,
    TEARDOWN_DOCUMENT_MESSAGE,
    REFRESH_DOCUMENT_POLICY_MESSAGE,
} from "../../../src/shared/messaging/document-messages";
import { STATE_AVAILABILITY } from "../../../src/shared/messaging/view-state-values";
import type { TimeZoneSelection } from "../../../src/shared/settings/snapshot";

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

    it("reuses resolved Bluesky time across format and time-zone changes", async () => {
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
        let revision = 1;
        let pattern = "yyyy-MM-dd HH:mm";
        let timeZone: TimeZoneSelection = { mode: "utc" };
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
        const appView: BlueskyAppView = {
            getProfiles,
            getPosts,
        };
        installContentRuntime({
            document,
            url: new URL("https://bsky.app/"),
            locales: ["en-US"],
            loadDocumentState: async () => ({
                ...state(true, revision),
                display: {
                    formatMode: "custom" as const,
                    pattern,
                    timeZone,
                },
            }),
            messages: source,
            blueskyAppView: appView,
        });

        await vi.waitFor(() => {
            expect(label.data).toBe("2026-08-31 10:15");
        });
        pattern = "dd/MM/yyyy HH:mm";
        revision = 2;
        expect(source.dispatch({ type: REFRESH_DOCUMENT_POLICY_MESSAGE })).toEqual({
            type: DOCUMENT_POLICY_REFRESHED_MESSAGE,
        });
        await vi.waitFor(() => {
            expect(label.data).toBe("31/08/2026 10:15");
        });

        timeZone = { mode: "iana", identifier: "America/New_York" };
        revision = 3;
        expect(source.dispatch({ type: REFRESH_DOCUMENT_POLICY_MESSAGE })).toEqual({
            type: DOCUMENT_POLICY_REFRESHED_MESSAGE,
        });
        await vi.waitFor(() => {
            expect(label.data).toBe("31/08/2026 06:15");
        });
        expect(getProfiles).toHaveBeenCalledTimes(1);
        expect(getPosts).toHaveBeenCalledTimes(1);
    });

    it("makes a disabled generation inert and resolves through a fresh reactivation", async () => {
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
        const appView: BlueskyAppView = {
            getProfiles,
            getPosts,
        };
        installContentRuntime({
            document,
            url: new URL("https://bsky.app/"),
            locales: ["en-US"],
            loadDocumentState: async () => state(enabled, revision),
            messages: source,
            blueskyAppView: appView,
        });
        await vi.waitFor(() => {
            expect(getProfiles).toHaveBeenCalledTimes(1);
        });

        enabled = false;
        revision = 2;
        expect(source.dispatch({ type: SUSPEND_AND_REFRESH_DOCUMENT_POLICY_MESSAGE }))
            .toEqual({ type: DOCUMENT_POLICY_REFRESHED_MESSAGE });
        expect(label.data).toBe("2h");
        await Promise.resolve();
        await Promise.resolve();
        resolveFirst?.({
            status: BLUESKY_LOOKUP_STATUS.SUCCESS,
            records: [{ actor: "alice.example", did: "did:plc:alice" }],
        });
        await Promise.resolve();
        await Promise.resolve();
        expect(label.data).toBe("2h");
        expect(getPosts).not.toHaveBeenCalled();

        enabled = true;
        revision = 3;
        expect(source.dispatch({ type: REFRESH_DOCUMENT_POLICY_MESSAGE })).toEqual({
            type: DOCUMENT_POLICY_REFRESHED_MESSAGE,
        });
        await vi.waitFor(() => {
            expect(label.data).not.toBe("2h");
        });
        expect(getProfiles).toHaveBeenCalledTimes(2);
        expect(getPosts).toHaveBeenCalledTimes(1);
    });
});
