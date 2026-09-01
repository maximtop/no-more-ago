/**
 * @file Verifies identity-bound YouTube Watch route handoff provenance and liveness.
 */

import { describe, expect, it, vi } from "vitest";

import {
    classifyYouTubeWatchRouteHandoff,
} from "../../../../src/content-script/adapters/youtube-watch-route-handoff";
import {
    DOCUMENT_ROUTE_HANDOFF_TRANSITION,
} from "../../../../src/content-script/transformation/route-handoff";
import {
    YOUTUBE_ADAPTER_ID,
    YOUTUBE_PLAYER_RESPONSE_RULE_ID,
} from "../../../../src/shared/adapters/youtube-contract";

const WATCH_A = "https://www.youtube.com/watch?v=testVID0001";
const WATCH_B = "https://www.youtube.com/watch?v=testVID0002";

/**
 * Flushes observer delivery and the session's coalescing microtask.
 *
 * @returns - Promise settled after queued microtasks.
 */
async function flushMutations(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
}

describe("classifyYouTubeWatchRouteHandoff", () => {
    it("returns a total no-op, clear, or replace transition", () => {
        expect(classifyYouTubeWatchRouteHandoff({
            previousUrl: new URL(WATCH_A),
            currentUrl: new URL(`${WATCH_A}&list=fixture`),
        })).toEqual({ kind: DOCUMENT_ROUTE_HANDOFF_TRANSITION.NOOP });

        expect(classifyYouTubeWatchRouteHandoff({
            previousUrl: new URL("https://www.youtube.com/"),
            currentUrl: new URL("https://www.youtube.com/results?search_query=fixture"),
        })).toEqual({ kind: DOCUMENT_ROUTE_HANDOFF_TRANSITION.NOOP });

        for (const target of [
            "https://www.youtube.com/",
            "https://www.youtube.com/results?search_query=fixture",
            "https://www.youtube.com/@fixture/videos",
            "https://www.youtube.com/shorts/testVID0002",
            "https://example.test/watch?v=testVID0002",
        ]) {
            expect(classifyYouTubeWatchRouteHandoff({
                previousUrl: new URL(WATCH_A),
                currentUrl: new URL(target),
            })).toEqual({ kind: DOCUMENT_ROUTE_HANDOFF_TRANSITION.CLEAR });
        }

        for (const [previous, current] of [
            [WATCH_A, WATCH_B],
            ["https://www.youtube.com/", WATCH_A],
            ["https://www.youtube.com/results?search_query=fixture", WATCH_B],
        ] as const) {
            const transition = classifyYouTubeWatchRouteHandoff({
                previousUrl: new URL(previous),
                currentUrl: new URL(current),
            });
            expect(transition.kind).toBe(DOCUMENT_ROUTE_HANDOFF_TRANSITION.REPLACE);
            expect("policy" in transition).toBe(true);
        }
    });

    it("allows identity-bound loaded data and permanently quarantines unbound Watch tiers", () => {
        document.body.innerHTML = `
            <ytd-watch-metadata>
                <div id="info-strings"><yt-formatted-string>2 days ago</yt-formatted-string></div>
            </ytd-watch-metadata>
            <time datetime="2026-08-23T10:15Z">2 hours ago</time>`;
        const watchSource = document.querySelector("yt-formatted-string");
        const genericSource = document.querySelector("time");
        if (!watchSource || !genericSource) {
            throw new Error("Expected Watch and generic sources");
        }
        const transition = classifyYouTubeWatchRouteHandoff({
            previousUrl: new URL(WATCH_A),
            currentUrl: new URL(WATCH_B),
        });
        if (transition.kind !== DOCUMENT_ROUTE_HANDOFF_TRANSITION.REPLACE) {
            throw new Error("Expected replacement policy");
        }

        expect(transition.policy.allowsRule(
            YOUTUBE_PLAYER_RESPONSE_RULE_ID,
            watchSource,
        )).toBe(true);
        expect(transition.policy.allowsRule(YOUTUBE_ADAPTER_ID, watchSource)).toBe(false);
        expect(transition.policy.allowsRule(YOUTUBE_ADAPTER_ID, genericSource)).toBe(true);
    });
});

describe("YouTube Watch handoff session", () => {
    it("coalesces exact assignment changes and bounded replacement roots", async () => {
        document.head.innerHTML = '<script>var ytInitialPlayerResponse = {"first":true};</script>';
        const script = document.head.querySelector("script");
        if (!script) {
            throw new Error("Expected player script");
        }
        const transition = classifyYouTubeWatchRouteHandoff({
            previousUrl: new URL(WATCH_A),
            currentUrl: new URL(WATCH_B),
        });
        if (transition.kind !== DOCUMENT_ROUTE_HANDOFF_TRANSITION.REPLACE) {
            throw new Error("Expected replacement policy");
        }
        const requestReconciliation = vi.fn();
        const session = transition.policy.activate({
            document,
            currentUrl: new URL(WATCH_B),
            generation: 3,
            requestReconciliation,
        });

        script.textContent = 'var ytInitialPlayerResponse = {"second":true};';
        script.textContent = 'var ytInitialPlayerResponse = {"third":true};';
        await flushMutations();
        expect(requestReconciliation).toHaveBeenCalledOnce();

        const wrapper = document.createElement("div");
        wrapper.innerHTML = '<script>var ytInitialPlayerResponse = {"replacement":true};</script>';
        document.body.append(wrapper);
        session.noteStructure({ addedRoots: [wrapper], removedRoots: [] });
        session.noteStructure({ addedRoots: [wrapper], removedRoots: [] });
        await flushMutations();
        expect(requestReconciliation).toHaveBeenCalledTimes(2);

        session.dispose();
    });

    it("makes queued and later assignment work inert after disposal", async () => {
        document.head.innerHTML = '<script>var ytInitialPlayerResponse = {"first":true};</script>';
        const script = document.head.querySelector("script");
        if (!script) {
            throw new Error("Expected player script");
        }
        const transition = classifyYouTubeWatchRouteHandoff({
            previousUrl: new URL(WATCH_A),
            currentUrl: new URL(WATCH_B),
        });
        if (transition.kind !== DOCUMENT_ROUTE_HANDOFF_TRANSITION.REPLACE) {
            throw new Error("Expected replacement policy");
        }
        const requestReconciliation = vi.fn();
        const session = transition.policy.activate({
            document,
            currentUrl: new URL(WATCH_B),
            generation: 4,
            requestReconciliation,
        });

        script.textContent = 'var ytInitialPlayerResponse = {"second":true};';
        session.dispose();
        await flushMutations();
        script.textContent = 'var ytInitialPlayerResponse = {"third":true};';
        await flushMutations();

        expect(requestReconciliation).not.toHaveBeenCalled();
    });
});
