/**
 * @file Verifies incremental Telegram Web K processing and restoration.
 */

import { describe, expect, it, vi } from "vitest";

import { genericTimeRule } from "../../../../src/content-script/adapters/generic-time";
import { AdapterRegistry } from "../../../../src/content-script/adapters/registry";
import {
    telegramWebKAdapter,
} from "../../../../src/content-script/adapters/telegram-web-k";
import type {
    TimestampSourceRule,
} from "../../../../src/content-script/adapters/types";
import {
    DocumentTransformationController,
} from "../../../../src/content-script/transformation/document-transformation-controller";
import {
    formatDateWithPresentation,
} from "../../../../src/shared/date/format-default-date";
import type { DisplaySettings } from "../../../../src/shared/settings/snapshot";

const TELEGRAM_WEB_K_URL = new URL("https://web.telegram.org/k/#@fictional");
const LOCALES = ["en-US"] as const;
const UTC_DISPLAY = {
    formatMode: "custom",
    pattern: "yyyy-MM-dd HH:mm",
    timeZone: { mode: "utc" },
} as const;

/**
 * Allows native mutation delivery and queued document reconciliation to complete.
 *
 * @returns - Promise resolved after pending mutation microtasks.
 */
async function flushMutations(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
}

/**
 * Builds one minimal ordinary Telegram Web K message bubble.
 *
 * @param id - Stable fixture identifier.
 * @param timestamp - Raw Unix-seconds source value.
 * @param label - Page-owned ordinary clock label.
 * @returns - Telegram message markup.
 */
function messageMarkup(id: string, timestamp: string, label: string): string {
    return `<div id="${id}" class="bubble" data-timestamp="${timestamp}">`
        + `<span class="time-inner"><span id="${id}-clock" class="i18n">`
        + `${label}</span></span></div>`;
}

describe("Telegram Web K document lifecycle", () => {
    it("processes live messages and batches of older history after startup", async () => {
        document.body.innerHTML = '<main><section id="live"></section>'
            + '<section id="history"></section></main>';
        const controller = new DocumentTransformationController({
            url: TELEGRAM_WEB_K_URL,
            root: document,
            locales: LOCALES,
            display: UTC_DISPLAY,
        });

        try {
            controller.start();
            document.getElementById("live")?.insertAdjacentHTML(
                "beforeend",
                messageMarkup("live-message", "1778774880", "16:08"),
            );
            const historyBatch = document.createElement("div");
            historyBatch.innerHTML = messageMarkup("history-one", "1778774940", "16:09")
                + messageMarkup("history-two", "1778775000", "16:10");
            document.getElementById("history")?.append(historyBatch);
            await flushMutations();

            expect(document.getElementById("live-message-clock")?.textContent)
                .toBe("2026-05-14 16:08");
            expect(document.getElementById("history-one-clock")?.textContent)
                .toBe("2026-05-14 16:09");
            expect(document.getElementById("history-two-clock")?.textContent)
                .toBe("2026-05-14 16:10");
            expect(document.querySelector("[data-no-more-ago-output]")).toBeNull();
        } finally {
            controller.teardown();
        }

        expect(document.getElementById("live-message-clock")?.textContent).toBe("16:08");
        expect(document.getElementById("history-one-clock")?.textContent).toBe("16:09");
        expect(document.getElementById("history-two-clock")?.textContent).toBe("16:10");
    });

    it("bounds work for a large history, one insertion, and an irrelevant mutation", async () => {
        const messageCount = 100;
        const rows = Array.from(
            { length: messageCount },
            (_, index) => messageMarkup(
                `bulk-${String(index)}`,
                "1778774880",
                `page ${String(index)}`,
            ),
        ).join("");
        document.body.innerHTML = `<main id="bulk-history">${rows}</main>`;
        const extract = vi.fn((element: Element, url: URL) =>
            telegramWebKAdapter.extract(element, url));
        const instrumented: TimestampSourceRule = {
            ...telegramWebKAdapter,
            extract,
        };
        const controller = new DocumentTransformationController({
            url: TELEGRAM_WEB_K_URL,
            root: document,
            locales: LOCALES,
            display: UTC_DISPLAY,
            registry: new AdapterRegistry([instrumented], genericTimeRule),
        });

        try {
            controller.start();
            expect(extract.mock.calls.length).toBeLessThanOrEqual(messageCount);
            expect(Array.from(document.querySelectorAll("#bulk-history span.i18n"))
                .every((clock) => clock.textContent === "2026-05-14 16:08"))
                .toBe(true);
            expect(document.querySelector("[data-no-more-ago-output]")).toBeNull();

            const visitsBeforeInsertion = extract.mock.calls.length;
            document.getElementById("bulk-history")?.insertAdjacentHTML(
                "beforeend",
                messageMarkup("bulk-new", "1778774940", "new page label"),
            );
            await flushMutations();
            expect(extract.mock.calls.length - visitsBeforeInsertion).toBeLessThanOrEqual(1);
            expect(document.getElementById("bulk-new-clock")?.textContent)
                .toBe("2026-05-14 16:09");

            const visitsBeforeIrrelevantMutation = extract.mock.calls.length;
            document.getElementById("bulk-history")?.classList.add("expanded-layout");
            await flushMutations();
            await flushMutations();
            await flushMutations();
            expect(extract.mock.calls.length - visitsBeforeIrrelevantMutation)
                .toBeLessThanOrEqual(1);
        } finally {
            controller.teardown();
        }
    });

    it("preserves an owned clock through unrelated message changes", async () => {
        document.body.innerHTML = messageMarkup("tracked", "1778774880", "16:08")
            + '<div id="unrelated" class="bubble"><span>unchanged</span></div>';
        const controller = new DocumentTransformationController({
            url: TELEGRAM_WEB_K_URL,
            root: document,
            locales: LOCALES,
            display: UTC_DISPLAY,
        });
        const clock = document.getElementById("tracked-clock");
        const unrelated = document.querySelector("#unrelated span");
        const source = document.getElementById("tracked");
        const messageContent = document.createElement("span");
        messageContent.textContent = "message body";
        source?.prepend(messageContent);
        if (!clock || !unrelated || !source) {
            throw new Error("Expected tracked and unrelated Telegram messages");
        }

        try {
            controller.start();
            expect(clock.textContent).toBe("2026-05-14 16:08");
            unrelated.textContent = "page changed";
            await flushMutations();

            messageContent.classList.add("selected-content");
            source.classList.add("selected");
            source.classList.add("highlighted");
            source.classList.remove("selected");
            await flushMutations();
            expect(document.getElementById("tracked-clock")).toBe(clock);
            expect(clock.textContent).toBe("2026-05-14 16:08");
            expect(unrelated.textContent).toBe("page changed");
            expect(document.querySelector("[data-no-more-ago-output]")).toBeNull();
            await flushMutations();
            expect(clock.textContent).toBe("2026-05-14 16:08");
        } finally {
            controller.teardown();
        }
    });

    it("reconciles eligibility when relevant descendant classes change", async () => {
        document.body.innerHTML = messageMarkup("shape", "1778774880", "16:08");
        const bubble = document.getElementById("shape");
        const timeInner = document.querySelector("#shape .time-inner");
        const clock = document.getElementById("shape-clock");
        const forwardedLabel = document.createElement("span");
        forwardedLabel.textContent = "page label";
        bubble?.prepend(forwardedLabel);
        if (!bubble || !timeInner || !clock) {
            throw new Error("Expected mutable Telegram message shape");
        }
        const controller = new DocumentTransformationController({
            url: TELEGRAM_WEB_K_URL,
            root: document,
            locales: LOCALES,
            display: UTC_DISPLAY,
        });

        try {
            controller.start();
            expect(clock.textContent).toBe("2026-05-14 16:08");

            clock.classList.remove("i18n");
            await flushMutations();
            expect(clock.textContent).toBe("16:08");
            clock.classList.add("i18n");
            await flushMutations();
            expect(clock.textContent).toBe("2026-05-14 16:08");

            timeInner.classList.remove("time-inner");
            await flushMutations();
            expect(clock.textContent).toBe("16:08");
            timeInner.classList.add("time-inner");
            await flushMutations();
            expect(clock.textContent).toBe("2026-05-14 16:08");

            forwardedLabel.classList.add("bubble-name-forwarded");
            await flushMutations();
            expect(clock.textContent).toBe("16:08");
            forwardedLabel.classList.remove("bubble-name-forwarded");
            await flushMutations();
            expect(clock.textContent).toBe("2026-05-14 16:08");
        } finally {
            controller.teardown();
        }
        expect(clock.textContent).toBe("16:08");
    });

    it("releases stale ownership across moves, removals, and replacements", async () => {
        document.body.innerHTML = '<main><section id="first">'
            + messageMarkup("moving", "1778774880", "16:08")
            + '</section><section id="second"></section></main>';
        const controller = new DocumentTransformationController({
            url: TELEGRAM_WEB_K_URL,
            root: document,
            locales: LOCALES,
            display: UTC_DISPLAY,
        });
        const bubble = document.getElementById("moving");
        const clock = document.getElementById("moving-clock");
        const second = document.getElementById("second");
        if (!bubble || !clock || !second) {
            throw new Error("Expected movable Telegram message");
        }

        try {
            controller.start();
            second.append(bubble);
            await flushMutations();
            expect(document.querySelector("#second #moving")).toBe(bubble);
            expect(document.getElementById("moving-clock")).toBe(clock);
            expect(clock.textContent).toBe("2026-05-14 16:08");

            bubble.remove();
            await flushMutations();
            expect(clock.textContent).toBe("16:08");
            expect(bubble.isConnected).toBe(false);

            second.innerHTML = messageMarkup("replacement", "1778774940", "16:09");
            await flushMutations();
            expect(document.getElementById("replacement-clock")?.textContent)
                .toBe("2026-05-14 16:09");
            expect(clock.textContent).toBe("16:08");
        } finally {
            controller.teardown();
        }

        expect(document.getElementById("replacement-clock")?.textContent).toBe("16:09");
    });

    it("reprocesses an exact source when data-timestamp changes", async () => {
        document.body.innerHTML = messageMarkup("dynamic-bubble", "1778774880", "16:08");
        const controller = new DocumentTransformationController({
            url: TELEGRAM_WEB_K_URL,
            root: document,
            locales: LOCALES,
            display: UTC_DISPLAY,
        });
        const clock = document.getElementById("dynamic-bubble-clock");
        const bubble = document.getElementById("dynamic-bubble");
        if (!clock || !bubble) {
            throw new Error("Expected dynamic Telegram message");
        }

        try {
            controller.start();
            expect(clock.textContent).toBe("2026-05-14 16:08");
            bubble.setAttribute("data-timestamp", "1778861280");
            await flushMutations();
            expect(clock.textContent).toBe("2026-05-15 16:08");
            bubble.removeAttribute("data-timestamp");
            await flushMutations();
            expect(clock.textContent).toBe("16:08");
            bubble.setAttribute("data-timestamp", "1778774880");
            await flushMutations();
            expect(clock.textContent).toBe("2026-05-14 16:08");
        } finally {
            controller.teardown();
        }
        expect(clock.textContent).toBe("16:08");
    });

    it("restores the latest page label while a forwarded shape is ambiguous", async () => {
        document.body.innerHTML = messageMarkup("changing", "1778774880", "16:08");
        const controller = new DocumentTransformationController({
            url: TELEGRAM_WEB_K_URL,
            root: document,
            locales: LOCALES,
            display: UTC_DISPLAY,
        });
        const bubble = document.getElementById("changing");
        const target = document.getElementById("changing-clock")?.firstChild;
        if (!bubble || !(target instanceof Text)) {
            throw new Error("Expected mutable Telegram message");
        }

        try {
            controller.start();
            target.data = "16:10";
            await flushMutations();
            expect(target.data).toBe("2026-05-14 16:08");
            bubble.classList.add("forwarded");
            await flushMutations();
            expect(target.data).toBe("16:10");
            bubble.classList.remove("forwarded");
            await flushMutations();
            expect(target.data).toBe("2026-05-14 16:08");
        } finally {
            controller.teardown();
        }
        expect(target.data).toBe("16:10");
    });

    it("leaves replacement primary-edit markup unchanged and releases ownership", async () => {
        document.body.innerHTML = messageMarkup("edited", "1778774880", "16:08");
        const controller = new DocumentTransformationController({
            url: TELEGRAM_WEB_K_URL,
            root: document,
            locales: LOCALES,
            display: UTC_DISPLAY,
        });
        const timeInner = document.querySelector("#edited .time-inner");
        if (!timeInner) {
            throw new Error("Expected Telegram time container");
        }

        try {
            controller.start();
            timeInner.innerHTML = '<span id="primary-edit" class="i18n">edited '
                + '<span class="i18n">16:09</span></span>';
            await flushMutations();
            expect(document.getElementById("primary-edit")?.textContent).toBe("edited 16:09");
            await flushMutations();
            expect(document.getElementById("primary-edit")?.textContent).toBe("edited 16:09");
        } finally {
            controller.teardown();
        }
        expect(document.getElementById("primary-edit")?.textContent).toBe("edited 16:09");
    });

    it("reformats only owned clocks for system, UTC, and IANA settings", () => {
        document.body.innerHTML = messageMarkup("settings", "1778774880", "16:08")
            + '<div id="unrelated-settings" class="bubble"><span>unchanged</span></div>';
        const displays: readonly DisplaySettings[] = [
            {
                formatMode: "custom",
                pattern: "yyyy-MM-dd HH:mm",
                timeZone: { mode: "system" },
            },
            UTC_DISPLAY,
            {
                formatMode: "custom",
                pattern: "yyyy-MM-dd HH:mm",
                timeZone: { mode: "iana", identifier: "Europe/Nicosia" },
            },
        ];
        let display: DisplaySettings = displays[0] ?? UTC_DISPLAY;
        const controller = new DocumentTransformationController({
            url: TELEGRAM_WEB_K_URL,
            root: document,
            localesProvider: () => LOCALES,
            displayProvider: () => display,
        });
        const clock = document.getElementById("settings-clock");
        const unrelated = document.getElementById("unrelated-settings");
        if (!clock || !unrelated) {
            throw new Error("Expected Telegram settings fixture");
        }
        const instant = new Date(1_778_774_880_000);

        try {
            controller.start();
            for (const nextDisplay of displays) {
                display = nextDisplay;
                controller.reformatOwned();
                expect(clock.textContent)
                    .toBe(formatDateWithPresentation(instant, LOCALES, display).text);
                expect(document.getElementById("settings-clock")).toBe(clock);
                expect(unrelated.textContent).toBe("unchanged");
            }
        } finally {
            controller.teardown();
        }
        expect(clock.textContent).toBe("16:08");
    });
});
