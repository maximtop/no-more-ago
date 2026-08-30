/**
 * @file Exercises content runtime hydration, policy refresh, and teardown.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
/* eslint-disable @typescript-eslint/require-await */
import { DOCUMENT_RUNTIME_SLOT, installContentRuntime } from "../../../src/content-script/runtime";
import {
    DOCUMENT_PHASE,
    DOCUMENT_POLICY_RECONCILED_MESSAGE,
    DOCUMENT_STATUS_MESSAGE,
    RECONCILE_DOCUMENT_POLICY_MESSAGE,
} from "../../../src/shared/messaging/document-messages";
import { STATE_AVAILABILITY } from "../../../src/shared/messaging/view-state-values";

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
            + 'class="i18n">16:08</span></span></div>';
        const clock = document.getElementById("telegram-policy-clock");
        if (!clock) {
            throw new Error("Expected Telegram policy clock");
        }

        await exercisePolicyLifecycle({
            url: new URL("https://web.telegram.org/k/#@fictional"),
            isTransformed: () => clock.textContent !== "16:08",
            isOriginal: () => clock.textContent === "16:08",
            assertIdentity: () => {
                expect(document.getElementById("telegram-policy-clock")).toBe(clock);
            },
        });
    });

    it("removes and recreates TikTok profile output across policy changes", async () => {
        const postId = "7639779880711749733";
        document.body.innerHTML = '<div data-e2e="user-post-item">'
            + `<a id="tiktok-policy-card" href="/@fictional/video/${postId}">card</a>`
            + "</div>";
        const link = document.getElementById("tiktok-policy-card");
        if (!(link instanceof HTMLAnchorElement)) {
            throw new Error("Expected TikTok policy card");
        }

        await exercisePolicyLifecycle({
            url: new URL("https://www.tiktok.com/@fictional"),
            isTransformed: () => link.nextElementSibling instanceof HTMLTimeElement
                && !link.hasAttribute("hidden"),
            isOriginal: () => link.nextElementSibling === null && link.textContent === "card",
            assertIdentity: () => {
                expect(document.getElementById("tiktok-policy-card")).toBe(link);
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
            + '<span id="tiktok-policy-date">5-14</span></div>';
        const date = document.getElementById("tiktok-policy-date");
        if (!date) {
            throw new Error("Expected TikTok policy date");
        }

        await exercisePolicyLifecycle({
            url: new URL(`https://www.tiktok.com/@fictional/video/${postId}`),
            isTransformed: () => date.textContent !== "5-14",
            isOriginal: () => date.textContent === "5-14",
            assertIdentity: () => {
                expect(document.getElementById("tiktok-policy-date")).toBe(date);
            },
        });
    });
});
