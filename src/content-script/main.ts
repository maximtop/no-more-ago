/**
 * @file Starts the page-local runtime with the current document, URL, and Chrome messaging API.
 */

import {
    READ_YOUTUBE_PUBLICATION_MESSAGE,
    type ReadYouTubePublicationMessage,
} from '../shared/adapters/youtube-player';
import { GET_DOCUMENT_STATE_MESSAGE } from '../shared/messaging/contracts';
import { DIAGNOSTIC_EVENT_MESSAGE } from '../shared/messaging/document-messages';
import { isFacebookUrl } from '../shared/url/facebook';

import { classifyYouTubeWatchRouteHandoff } from
    './adapters/youtube-watch-route-handoff';
import { installFacebookPayloadRuntime } from './facebook/payload-runtime';
import { installContentRuntime } from './runtime';

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
    })
    : undefined;

runtimeComposition.content = installContentRuntime({
    document,
    url: documentUrl,
    urlProvider: () => new URL(window.location.href),
    routeEvents: {
        addListener: (listener) => {
            window.addEventListener('popstate', listener);
        },
    },
    routeHandoffClassifier: (route) => classifyYouTubeWatchRouteHandoff(
        route,
        async (href) => {
            const message: ReadYouTubePublicationMessage = { type: READ_YOUTUBE_PUBLICATION_MESSAGE, href };
            // A worker that stopped before answering leaves the reply undefined.
            const reply = await chrome.runtime.sendMessage<ReadYouTubePublicationMessage, string | null | undefined>(
                message,
            );
            return reply ?? null;
        },
    ),
    locales: navigator.languages,
    localesProvider: () => navigator.languages,
    ...(typeof chrome.runtime.sendMessage === 'function'
        ? {
            loadDocumentState: () => chrome.runtime.sendMessage({ type: GET_DOCUMENT_STATE_MESSAGE }),
            reportDiagnostic: (event: Record<string, unknown>) => chrome.runtime.sendMessage({
                type: DIAGNOSTIC_EVENT_MESSAGE,
                event,
            }),
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
