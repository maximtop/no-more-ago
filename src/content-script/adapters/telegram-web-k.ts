/**
 * @file Telegram Web K adapter for message.date Unix-seconds sources.
 */

import { discoverElements } from "./discover-elements";
import { findSimpleTextTarget } from "./simple-text-target";
import { isHtmlElement } from "./html-element";
import {
    TIMESTAMP_PRESENTATION_KIND,
    TIMESTAMP_SOURCE_ATTRIBUTE,
    TIMESTAMP_SOURCE_KIND,
    TIMESTAMP_VALIDATION_RULE,
    TIMESTAMP_VISIBILITY_POLICY,
    type TimestampSourceAttribute,
    type TimestampSourceRule,
} from "./types";

const MESSAGE_SELECTOR = "div.bubble[data-timestamp]" as const;
const MESSAGE_CLASS = "bubble" as const;
const TIME_INNER_SELECTOR = ".time-inner" as const;
const TIME_INNER_CLASS = "time-inner" as const;
const CLOCK_CLASS = "i18n" as const;
const FORWARDED_LABEL_SELECTOR = ".bubble-name-forwarded" as const;
const FORWARDED_LABEL_CLASS = "bubble-name-forwarded" as const;
const FORWARDED_CLASS = "forwarded" as const;
const RELEVANT_CLASSES = [
    MESSAGE_CLASS,
    TIME_INNER_CLASS,
    CLOCK_CLASS,
    FORWARDED_LABEL_CLASS,
    FORWARDED_CLASS,
] as const;

/**
 * Stable identifier for the Telegram Web K source rule.
 */
export const TELEGRAM_WEB_K_ADAPTER_ID = "telegram-web-k" as const;

/**
 * Canonical hostname handled by the Telegram Web K adapter.
 */
export const TELEGRAM_WEB_HOSTNAME = "web.telegram.org" as const;

/**
 * Checks whether a URL belongs to the supported Telegram Web K surface.
 *
 * @param url - URL considered for adapter selection.
 * @returns - Whether the URL is HTTPS on the Web K path.
 */
export function matchesTelegramWebKUrl(url: URL): boolean {
    return url.protocol === "https:"
        && url.hostname === TELEGRAM_WEB_HOSTNAME
        && url.pathname.startsWith("/k/");
}

/**
 * Checks whether an element has the exact Web K message source shape.
 *
 * @param element - Candidate Telegram message bubble.
 * @returns - Whether the element can carry a Web K candidate.
 */
function isTelegramWebKMessage(element: Element): boolean {
    return isHtmlElement(element)
        && element.localName === "div"
        && element.classList.contains(MESSAGE_CLASS)
        && element.hasAttribute("data-timestamp");
}

/**
 * Checks whether an element is an HTML message container independent of its current class.
 *
 * @param element - Element considered as a current or former message source.
 * @returns - Whether the element has the stable HTML and timestamp shape.
 */
function isMessageContainer(element: Element): boolean {
    return isHtmlElement(element)
        && element.localName === "div"
        && element.hasAttribute("data-timestamp");
}

/**
 * Checks whether one class token was present in a previous class attribute.
 *
 * @param value - Previous serialized class attribute.
 * @param token - Class token to find.
 * @returns - Whether the previous value contained the exact token.
 */
function previousClassContains(value: string | null, token: string): boolean {
    return value?.split(/\s+/u).includes(token) ?? false;
}

/**
 * Checks whether a class mutation changed Telegram eligibility or presentation structure.
 *
 * @param element - Element whose class changed.
 * @param oldValue - Previous serialized class attribute.
 * @returns - Whether a relevant token was added or removed.
 */
function changedRelevantClass(element: Element, oldValue: string | null): boolean {
    return RELEVANT_CLASSES.some(
        (token) => element.classList.contains(token) !== previousClassContains(oldValue, token),
    );
}

/**
 * Finds the nearest message source owning an adapter-relevant class mutation.
 *
 * @param element - Element whose class changed.
 * @param oldValue - Previous serialized class attribute.
 * @returns - Current or former owning message source, or null.
 */
function findMutationSource(element: Element, oldValue: string | null): Element | null {
    if (
        isMessageContainer(element)
        && (
            element.classList.contains(MESSAGE_CLASS)
            || previousClassContains(oldValue, MESSAGE_CLASS)
        )
    ) {
        return element;
    }
    let current = element.parentElement;
    while (current) {
        if (isTelegramWebKMessage(current)) {
            return current;
        }
        current = current.parentElement;
    }
    return null;
}

/**
 * Maps Telegram source and descendant attribute changes to their owning message bubble.
 *
 * @param element - Element whose adapter-declared attribute changed.
 * @param attributeName - Changed adapter attribute.
 * @param oldValue - Attribute value before the mutation.
 * @returns - Exact message source requiring reconciliation.
 */
function getMutationSources(
    element: Element,
    attributeName: TimestampSourceAttribute,
    oldValue: string | null,
): readonly Element[] {
    if (attributeName === TIMESTAMP_SOURCE_ATTRIBUTE.DATA_TIMESTAMP) {
        return isHtmlElement(element)
            && element.localName === "div"
            && element.classList.contains(MESSAGE_CLASS)
            && (element.hasAttribute("data-timestamp") || oldValue !== null)
            ? [element]
            : [];
    }
    if (
        attributeName !== TIMESTAMP_SOURCE_ATTRIBUTE.CLASS
        || !changedRelevantClass(element, oldValue)
    ) {
        return [];
    }
    const source = findMutationSource(element, oldValue);
    return source ? [source] : [];
}

/**
 * Finds one ordinary send-time clock without inspecting localized text.
 *
 * @param source - Approved Web K message bubble.
 * @returns - Existing clock text node, or null for an ambiguous presentation.
 */
function findClockTarget(source: Element): Text | null {
    const hasForwardedLabel = Array.from(
        source.querySelectorAll(FORWARDED_LABEL_SELECTOR),
    ).some((label) => label.closest(".bubble") === source);
    if (
        source.classList.contains(FORWARDED_CLASS)
        || hasForwardedLabel
    ) {
        return null;
    }
    const containers = Array.from(source.querySelectorAll(TIME_INNER_SELECTOR))
        .filter((container) => container.closest(".bubble") === source);
    if (containers.length !== 1) {
        return null;
    }
    const container = containers[0];
    if (!container) {
        return null;
    }
    const clocks = Array.from(container.children).filter(
        (child) => isHtmlElement(child)
            && child.localName === "span"
            && child.classList.contains(CLOCK_CLASS),
    );
    const clock = clocks.length === 1 ? clocks[0] : undefined;
    return clock ? findSimpleTextTarget(clock) : null;
}

/**
 * Specialized Telegram Web K source using the bubble's message.date value.
 */
export const telegramWebKAdapter: TimestampSourceRule = {
    id: TELEGRAM_WEB_K_ADAPTER_ID,
    mutationAttributes: [
        TIMESTAMP_SOURCE_ATTRIBUTE.CLASS,
        TIMESTAMP_SOURCE_ATTRIBUTE.DATA_TIMESTAMP,
    ],
    getMutationSources,
    matches: matchesTelegramWebKUrl,
    matchesElement: isTelegramWebKMessage,
    discover: (root) => discoverElements(root, MESSAGE_SELECTOR, isTelegramWebKMessage),
    extract: (element) => {
        if (!isTelegramWebKMessage(element)) {
            return null;
        }
        const rawDatetime = element.getAttribute("data-timestamp");
        const target = findClockTarget(element);
        if (rawDatetime === null || !target) {
            return null;
        }
        return {
            ruleId: TELEGRAM_WEB_K_ADAPTER_ID,
            source: element,
            sourceKind: TIMESTAMP_SOURCE_KIND.TELEGRAM_WEB_K_MESSAGE,
            rawDatetime,
            presentation: {
                kind: TIMESTAMP_PRESENTATION_KIND.IN_PLACE_TEXT,
                target,
            },
            validationRule: TIMESTAMP_VALIDATION_RULE.UNIX_SECONDS,
            visibilityPolicy: TIMESTAMP_VISIBILITY_POLICY.IGNORE_PAGE_SUPPRESSION,
        };
    },
};
