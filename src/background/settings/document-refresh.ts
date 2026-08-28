/**
 * Broadcasts committed presentation and diagnostic policy to active documents.
 *
 * @file Settings refresh fanout for all enabled HTTP(S) tabs.
 */
import {
    UPDATE_DEBUG_POLICY_MESSAGE,
    UPDATE_PRESENTATION_MESSAGE,
    REFRESH_FAILURE_REASON,
    isDebugPolicyUpdateAcknowledgement,
    isPresentationUpdateAcknowledgement,
    type DebugRefreshFailure,
    type DisplayRefreshFailure,
    type DebugPolicyUpdateMessage,
    type PresentationUpdateMessage,
} from "../../shared/messages";
import { HTTP_MATCH_PATTERNS, parseHttpUrl } from "../../shared/url/http";
import {
    isSiteEnabled,
    type DisplaySettings,
    type SettingsSnapshotV5,
} from "../../shared/settings/snapshot";
import type { RuntimeTab, TabsRuntime } from "../runtime/tabs";

/**
 * Revisioned settings message sent to a document runtime.
 */
type RefreshMessage = DebugPolicyUpdateMessage | PresentationUpdateMessage;

/**
 * Checks an optional browser response against the revision sent to documents.
 *
 * @param response - Untrusted response returned by the browser.
 * @param message - Revisioned update sent to the tab.
 * @returns - Whether the response acknowledges the sent revision.
 */
function isRefreshAcknowledgement(
    response: unknown,
    message: RefreshMessage,
): boolean {
    return message.type === UPDATE_PRESENTATION_MESSAGE
        ? isPresentationUpdateAcknowledgement(response, message.revision)
        : isDebugPolicyUpdateAcknowledgement(response, message.revision);
}

/**
 * Sends revisioned settings to every reachable frame in enabled HTTP(S) tabs.
 */
export class DocumentRefresh {
    /**
     * Creates a refresh broadcaster.
     *
     * @param tabs - Browser tab query and messaging boundary.
     * @returns - A refresh broadcaster.
     */
    public constructor(private readonly tabs: TabsRuntime) {}

    /**
     * Broadcasts a diagnostic-policy revision to every reachable frame in each matching tab.
     *
     * @param snapshot - Committed settings snapshot.
     * @param enabled - New diagnostic forwarding policy.
     * @param revision - Revision carried by the message.
     * @returns - Refresh failures by tab.
     */
    public refreshDebugPolicy(
        snapshot: SettingsSnapshotV5,
        enabled: boolean,
        revision: number,
    ): Promise<readonly DebugRefreshFailure[]> {
        return this.broadcast(snapshot, {
            type: UPDATE_DEBUG_POLICY_MESSAGE,
            revision,
            enabled,
        });
    }

    /**
     * Broadcasts a display-settings revision to every reachable frame in each matching tab.
     *
     * @param snapshot - Committed settings snapshot.
     * @param display - New display settings.
     * @param revision - Revision carried by the message.
     * @returns - Refresh failures by tab.
     */
    public refreshDisplay(
        snapshot: SettingsSnapshotV5,
        display: DisplaySettings,
        revision: number,
    ): Promise<readonly DisplayRefreshFailure[]> {
        return this.broadcast(snapshot, {
            type: UPDATE_PRESENTATION_MESSAGE,
            revision,
            display,
        });
    }

    /**
     * Broadcasts one message to every reachable frame in enabled HTTP(S) tabs.
     *
     * @param snapshot - Committed settings snapshot.
     * @param message - Typed update message.
     * @returns - Refresh failures by tab.
     */
    private async broadcast(
        snapshot: SettingsSnapshotV5,
        message: RefreshMessage,
    ): Promise<readonly DisplayRefreshFailure[]> {
        if (!snapshot.globalEnabled) {
            return [];
        }
        let tabs: readonly RuntimeTab[];
        try {
            tabs = await this.tabs.query({ url: [...HTTP_MATCH_PATTERNS] });
        } catch {
            return [{
                hostname: "*",
                reason: REFRESH_FAILURE_REASON.MATCHING_TABS_QUERY,
            }];
        }
        const failures: DisplayRefreshFailure[] = [];
        const seen = new Set<number>();
        await Promise.all(tabs.map(async (tab) => {
            if (seen.has(tab.id)) {
                return;
            }
            seen.add(tab.id);
            const url = parseHttpUrl(tab.url);
            if (!url || !isSiteEnabled(snapshot.sitePreferences, url.hostname)) {
                return;
            }
            try {
                const frames = await this.tabs.getAllFrames(tab.id);
                if (frames.length === 0) {
                    throw new Error("No reachable document frames");
                }
                await Promise.all(frames.map(async ({ frameId }) => {
                    const response = await this.tabs.sendMessage(tab.id, message, { frameId });
                    if (!isRefreshAcknowledgement(response, message)) {
                        throw new Error("Invalid document refresh acknowledgement");
                    }
                }));
            } catch {
                failures.push({
                    hostname: url.hostname,
                    tabId: tab.id,
                    reason: REFRESH_FAILURE_REASON.TAB_UPDATE,
                });
            }
        }));
        return failures;
    }
}
