/**
 * @file Starts the page-local runtime with the current document, URL, and Chrome messaging API.
 */


import { installContentRuntime } from "./runtime";
import { DIAGNOSTIC_EVENT_MESSAGE } from "../runtime/messages";

installContentRuntime({
    document,
    url: new URL(window.location.href),
    locales: navigator.languages,
    localesProvider: () => navigator.languages,
    ...(typeof chrome.runtime.sendMessage === "function" ? {
        loadDisplayState: () => chrome.runtime.sendMessage({ type: "no-more-ago:get-display-state" }),
        reportDiagnostic: (event: Record<string, unknown>) => chrome.runtime.sendMessage({ type: DIAGNOSTIC_EVENT_MESSAGE, event })
    } : {}),
    messages: chrome.runtime
});
