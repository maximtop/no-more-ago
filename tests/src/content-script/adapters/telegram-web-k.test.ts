/**
 * @file Verifies Telegram Web K URL scope and fail-closed timestamp extraction.
 */

import { describe, expect, it } from "vitest";

import { GENERIC_TIME_RULE_ID } from "../../../../src/content-script/adapters/generic-time";
import { defaultRegistry } from "../../../../src/content-script/adapters/registry";
import {
    TELEGRAM_WEB_K_ADAPTER_ID,
    matchesTelegramWebKUrl,
    telegramWebKAdapter,
} from "../../../../src/content-script/adapters/telegram-web-k";
import {
    TIMESTAMP_PRESENTATION_KIND,
    TIMESTAMP_SOURCE_KIND,
    TIMESTAMP_VALIDATION_RULE,
    TIMESTAMP_VISIBILITY_POLICY,
} from "../../../../src/content-script/adapters/types";

describe("Telegram Web K source contract", () => {
    it.each([
        ["https://web.telegram.org/k/", true],
        ["https://web.telegram.org/k/#@fictional", true],
        ["https://web.telegram.org/k/?thread=1#message", true],
        ["https://web.telegram.org/k", false],
        ["https://web.telegram.org/a/", false],
        ["https://web.telegram.org/", false],
        ["http://web.telegram.org/k/", false],
        ["https://sub.web.telegram.org/k/", false],
        ["https://web.telegram.org.example/k/", false],
    ])("matches %s as %s", (value, expected) => {
        expect(matchesTelegramWebKUrl(new URL(value))).toBe(expected);
    });

    it("exports a stable source identifier", () => {
        expect(TELEGRAM_WEB_K_ADAPTER_ID).toBe("telegram-web-k");
    });

    it("registers Web K before generic without changing other Telegram surfaces", () => {
        expect(defaultRegistry.matching(new URL("https://web.telegram.org/k/"))
            .map((rule) => rule.id))
            .toEqual([TELEGRAM_WEB_K_ADAPTER_ID, GENERIC_TIME_RULE_ID]);
        for (const url of [
            "https://web.telegram.org/a/",
            "https://t.me/s/fictional",
            "https://t.me/fictional",
        ]) {
            expect(defaultRegistry.matching(new URL(url)).map((rule) => rule.id))
                .toEqual([GENERIC_TIME_RULE_ID]);
        }
    });

    it("discovers only bounded HTML message bubbles with a source attribute", () => {
        document.body.innerHTML = `
            <section id="history">
                <div id="eligible" class="bubble" data-timestamp="1778774880">
                    <span class="time-inner"><span class="i18n">16:08</span></span>
                </div>
                <div class="bubble">
                    <span class="time-inner"><span class="i18n">missing</span></span>
                </div>
                <span class="bubble" data-timestamp="1778774880">wrong element</span>
            </section>`;
        const history = document.getElementById("history");
        const eligible = document.getElementById("eligible");
        if (!history || !eligible) {
            throw new Error("Expected Telegram history fixture");
        }

        expect(telegramWebKAdapter.discover(document)).toEqual([eligible]);
        expect(telegramWebKAdapter.discover(history)).toEqual([eligible]);
        expect(telegramWebKAdapter.discover(eligible)).toEqual([eligible]);
        expect(telegramWebKAdapter.discover(document.createElement("aside"))).toEqual([]);
    });

    it("extracts only the ordinary direct clock text", () => {
        document.body.innerHTML = `
            <div id="message" class="bubble is-in" data-timestamp="1778774880">
                <span class="time-inner">
                    <i id="edited" class="time-edited time-part i18n">edited</i>
                    <span id="clock" class="i18n">16:08</span>
                    <span id="status" class="time-sending-status">sent</span>
                </span>
            </div>`;
        const source = document.getElementById("message");
        const clock = document.getElementById("clock");
        if (!source || !clock || !(clock.firstChild instanceof Text)) {
            throw new Error("Expected Telegram source and clock text");
        }

        expect(telegramWebKAdapter.extract(source)).toEqual({
            ruleId: TELEGRAM_WEB_K_ADAPTER_ID,
            source,
            sourceKind: TIMESTAMP_SOURCE_KIND.TELEGRAM_WEB_K_MESSAGE,
            rawDatetime: "1778774880",
            presentation: {
                kind: TIMESTAMP_PRESENTATION_KIND.IN_PLACE_TEXT,
                target: clock.firstChild,
            },
            validationRule: TIMESTAMP_VALIDATION_RULE.UNIX_SECONDS,
            visibilityPolicy: TIMESTAMP_VISIBILITY_POLICY.IGNORE_PAGE_SUPPRESSION,
        });
        expect(document.getElementById("edited")?.textContent).toBe("edited");
        expect(document.getElementById("status")?.textContent).toBe("sent");
    });

    it("passes malformed source values unchanged to shared resolution", () => {
        document.body.innerHTML = `
            <div id="message" class="bubble" data-timestamp=" not-numeric ">
                <span class="time-inner"><span class="i18n">16:08</span></span>
            </div>`;
        const source = document.getElementById("message");
        if (!source) {
            throw new Error("Expected malformed Telegram source");
        }

        expect(telegramWebKAdapter.extract(source)?.rawDatetime).toBe(" not-numeric ");
    });

    it("ignores forwarding labels and clocks owned by nested bubbles", () => {
        document.body.innerHTML = `
            <div id="outer" class="bubble" data-timestamp="1778774880">
                <span class="time-inner"><span id="outer-clock" class="i18n">16:08</span></span>
                <div class="bubble forwarded" data-timestamp="1778774940">
                    <span class="bubble-name-forwarded">Forwarded</span>
                    <span class="time-inner"><span class="i18n">16:09</span></span>
                </div>
            </div>`;
        const source = document.getElementById("outer");
        const clock = document.getElementById("outer-clock");
        if (!source || !clock) {
            throw new Error("Expected nested Telegram bubbles");
        }

        expect(telegramWebKAdapter.extract(source)?.presentation).toMatchObject({
            kind: TIMESTAMP_PRESENTATION_KIND.IN_PLACE_TEXT,
            target: clock.firstChild,
        });
    });

    it("rejects foreign-namespace sources and targets", () => {
        document.body.innerHTML = "";
        const source = document.createElementNS("http://www.w3.org/2000/svg", "div");
        source.setAttribute("class", "bubble");
        source.setAttribute("data-timestamp", "1778774880");
        const container = document.createElementNS("http://www.w3.org/2000/svg", "span");
        container.setAttribute("class", "time-inner");
        const clock = document.createElementNS("http://www.w3.org/2000/svg", "span");
        clock.setAttribute("class", "i18n");
        clock.textContent = "16:08";
        container.append(clock);
        source.append(container);
        document.body.append(source);

        expect(telegramWebKAdapter.discover(document)).toEqual([]);
        expect(telegramWebKAdapter.extract(source)).toBeNull();
    });

    it("rejects non-source elements", () => {
        const source = document.createElement("div");
        source.className = "bubble";
        source.innerHTML = '<span class="time-inner"><span class="i18n">16:08</span></span>';

        expect(telegramWebKAdapter.extract(source)).toBeNull();
    });
});
