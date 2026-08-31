/**
 * @file Starts the page-local runtime with the current document, URL, and Chrome messaging API.
 */

import { installContentRuntime } from "./runtime";
import { installFacebookPayloadRuntime } from "./facebook/payload-runtime";
import { isFacebookUrl } from "../shared/url/facebook";
import { GET_DOCUMENT_STATE_MESSAGE } from "../shared/messaging/contracts";
import { DIAGNOSTIC_EVENT_MESSAGE } from "../shared/messaging/document-messages";
import { classifyYouTubeWatchRouteHandoff } from
    "./adapters/youtube-watch-route-handoff";

const documentUrl = new URL(window.location.href);
const runtimeComposition: {
    content?: ReturnType<typeof installContentRuntime>;
} = {};
const facebookRuntime = isFacebookUrl(documentUrl)
    ? installFacebookPayloadRuntime({
        window,
        document,
        onSourcesChanged: (sources) => {
            runtimeComposition.content?.reconcileSources(sources);
        },
        ...(typeof chrome.runtime.sendMessage === "function"
            ? {
                requestBridgeLease: (request) => chrome.runtime.sendMessage(request),
            }
            : {}),
    })
    : undefined;

runtimeComposition.content = installContentRuntime({
    document,
    url: documentUrl,
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
    ...(facebookRuntime === undefined
        ? {}
        : {
            onActivityChanged: (active: boolean) => {
                facebookRuntime.setEnabled(active);
            },
        }),
    messages: chrome.runtime,
});
