/**
 * @file Starts the page-local runtime with the current document, URL, and Chrome messaging API.
 */

import { installContentRuntime } from "./runtime";
import {
    DIAGNOSTIC_EVENT_MESSAGE,
    GET_DOCUMENT_STATE_MESSAGE,
} from "../shared/messages";

installContentRuntime({
    document,
    url: new URL(window.location.href),
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
