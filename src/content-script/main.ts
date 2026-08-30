/**
 * @file Starts the page-local runtime with the current document, URL, and Chrome messaging API.
 */

import { installContentRuntime } from "./runtime";
import { GET_DOCUMENT_STATE_MESSAGE } from "../shared/messaging/contracts";
import { DIAGNOSTIC_EVENT_MESSAGE } from "../shared/messaging/document-messages";
import { classifyYouTubeWatchRouteHandoff } from
    "./adapters/youtube-watch-route-handoff";

installContentRuntime({
    document,
    url: new URL(window.location.href),
    urlProvider: () => new URL(window.location.href),
    routeEvents: {
        addListener: (listener) => {
            window.addEventListener("popstate", listener);
        },
    },
    routeHandoffClassifier: classifyYouTubeWatchRouteHandoff,
    locales: navigator.languages,
    localesProvider: () => navigator.languages,
    ...(typeof chrome.runtime.sendMessage === "function"
        ? {
            loadDocumentState: () =>
                chrome.runtime.sendMessage({ type: GET_DOCUMENT_STATE_MESSAGE }),
            reportDiagnostic: (event: Record<string, unknown>) =>
                chrome.runtime.sendMessage({ type: DIAGNOSTIC_EVENT_MESSAGE, event }),
        }
        : {}),
    messages: chrome.runtime,
});
