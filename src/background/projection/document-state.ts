/**
 * Derives authoritative policy state for one content-script document.
 *
 * @file Top-level tab policy projection for document hydration.
 */
import {
    createUnavailableDocumentState,
    type DocumentState,
} from '../../shared/messaging/document-state';
import { STATE_AVAILABILITY } from '../../shared/messaging/view-state-values';
import { isSiteProcessingEnabled } from '../../shared/settings/site-scope';
import { parseHttpUrl } from '../../shared/url/http';
import { APPLICATION_PHASE } from '../application/contracts';

import { deriveDisplayState } from './display-state';

import type { DiagnosticSender } from '../../shared/diagnostics/events';
import type { ApplicationStateView } from '../application/state';

/**
 * Builds document state from application settings and sender tab metadata.
 *
 * @param state - Current authoritative application state.
 * @param sender - Untrusted sender metadata supplied by the browser.
 *
 * @returns Fail-closed or ready document state.
 */
export function deriveDocumentState(
    state: ApplicationStateView,
    sender: DiagnosticSender,
): DocumentState {
    if (state.phase !== APPLICATION_PHASE.READY || !state.snapshot) {
        return createUnavailableDocumentState(state.failure);
    }
    const displayState = deriveDisplayState(state);
    const topLevelUrl = parseHttpUrl(sender.tab?.url);
    return {
        availability: STATE_AVAILABILITY.READY,
        revision: state.snapshot.revision,
        enabled: state.snapshot.globalEnabled
            && topLevelUrl !== null
            && isSiteProcessingEnabled(state.snapshot.siteScope, topLevelUrl.hostname),
        display: state.snapshot.display,
        debugEnabled: state.snapshot.debugEnabled,
        ...('error' in displayState ? { error: displayState.error } : {}),
    };
}
