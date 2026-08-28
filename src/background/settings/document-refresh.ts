/**
 * Broadcasts committed presentation and diagnostic policy to active documents.
 *
 * @file Settings refresh fanout for all enabled HTTP(S) tabs.
 */
import {
    UPDATE_DEBUG_POLICY_MESSAGE,
    UPDATE_PRESENTATION_MESSAGE,
    REFRESH_FAILURE_REASON,
    type DebugRefreshFailure,
    type DisplayRefreshFailure,
} from "../../shared/messages";
import { HTTP_MATCH_PATTERNS, parseHttpUrl } from "../../shared/url/http";
import {
    isSiteEnabled,
    type DisplaySettings,
    type SettingsSnapshotV5,
} from "../../shared/settings/snapshot";
import type { RuntimeTab, TabsRuntime } from "../runtime/tabs";

/**
 * Sends revisioned settings to every enabled HTTP(S) top-level document.
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
     * Broadcasts a diagnostic-policy revision.
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
     * Broadcasts a display-settings revision.
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
     * Broadcasts one message to enabled HTTP(S) top-level tabs.
     *
     * @param snapshot - Committed settings snapshot.
     * @param message - Typed update message.
     * @returns - Refresh failures by tab.
     */
    private async broadcast(
        snapshot: SettingsSnapshotV5,
        message: unknown,
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
                await this.tabs.sendMessage(tab.id, message);
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
