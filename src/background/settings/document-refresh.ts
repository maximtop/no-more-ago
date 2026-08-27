/**
 * @file Broadcasts committed display and diagnostic policy changes to active documents.
 */

import type { RuntimeAdapterDefinition } from "../../runtime/adapter-activation";
import {
    UPDATE_DEBUG_POLICY_MESSAGE,
    UPDATE_PRESENTATION_MESSAGE,
    isDebugPolicyUpdateAcknowledgement,
    isPresentationUpdateAcknowledgement,
} from "../../runtime/messages";
import type { RuntimeTab, TabsRuntime } from "../../runtime/tabs";
import {
    isSiteEnabled,
    type DisplaySettings,
    type SettingsSnapshotV5,
} from "../../settings/snapshot";
import type { DebugRefreshFailure, DisplayRefreshFailure } from "../messaging/view-state";

/**
 * Parses a tab URL, returning null when it is absent or invalid.
 *
 * @param tab - Browser tab to inspect.
 * @returns - Parsed URL, or null for absent and malformed values.
 */
function urlFromTab(tab: RuntimeTab): URL | null {
    if (!tab.url) {
        return null;
    }
    try {
        return new URL(tab.url);
    } catch {
        return null;
    }
}

/**
 * Sends committed settings revisions to enabled top-frame documents.
 */
export class DocumentRefresh {
    /**
     * Browser tab query and messaging boundary.
     */
    private readonly tabs: TabsRuntime;

    /**
     * Immutable runtime adapter catalog.
     */
    private readonly adapters: readonly RuntimeAdapterDefinition[];

    /**
     * Creates a document settings broadcaster.
     *
     * @param tabs - Browser tab query and messaging boundary.
     * @param adapters - Runtime adapter catalog.
     */
    public constructor(tabs: TabsRuntime, adapters: readonly RuntimeAdapterDefinition[]) {
        this.tabs = tabs;
        this.adapters = adapters;
    }

    /**
     * Notifies enabled-site tabs of a diagnostic-policy revision.
     *
     * @param snapshot - Authoritative settings snapshot.
     * @param enabled - New diagnostic forwarding policy.
     * @param revision - Settings revision associated with the policy.
     * @returns - Per-tab diagnostic-policy refresh failures.
     */
    public refreshDebugPolicy(
        snapshot: SettingsSnapshotV5,
        enabled: boolean,
        revision: number,
    ): Promise<readonly DebugRefreshFailure[]> {
        return this.broadcast(
            snapshot,
            { type: UPDATE_DEBUG_POLICY_MESSAGE, revision, enabled },
            (response) => isDebugPolicyUpdateAcknowledgement(response, revision),
        );
    }

    /**
     * Notifies enabled-site tabs of a display-settings revision.
     *
     * @param snapshot - Authoritative settings snapshot.
     * @param display - Validated display settings.
     * @param revision - Settings revision associated with the display settings.
     * @returns - Per-tab display refresh failures.
     */
    public refreshDisplay(
        snapshot: SettingsSnapshotV5,
        display: DisplaySettings,
        revision: number,
    ): Promise<readonly DisplayRefreshFailure[]> {
        return this.broadcast(
            snapshot,
            { type: UPDATE_PRESENTATION_MESSAGE, revision, display },
            (response) => isPresentationUpdateAcknowledgement(response, revision),
        );
    }

    /**
     * Broadcasts one revisioned message to unique matching top-frame documents.
     *
     * @param snapshot - Authoritative settings snapshot.
     * @param message - Revisioned runtime message.
     * @param acknowledges - Response validator for the message.
     * @returns - Query and per-tab update failures.
     */
    private async broadcast(
        snapshot: SettingsSnapshotV5,
        message: unknown,
        acknowledges: (response: unknown) => boolean,
    ): Promise<readonly DisplayRefreshFailure[]> {
        if (!snapshot.globalEnabled) {
            return [];
        }
        const failures: DisplayRefreshFailure[] = [];
        for (const adapter of this.adapters) {
            if (!isSiteEnabled(snapshot.sitePreferences, adapter.hostname)) {
                continue;
            }
            let tabs: readonly RuntimeTab[];
            try {
                tabs = await this.tabs.query({ url: adapter.registration.matches });
            } catch {
                failures.push({ hostname: adapter.hostname, reason: "matching-tabs-query" });
                continue;
            }
            const seen = new Set<number>();
            for (const tab of tabs) {
                const url = urlFromTab(tab);
                if (!url || !adapter.matches(url) || seen.has(tab.id)) {
                    continue;
                }
                seen.add(tab.id);
                try {
                    const response = await this.tabs.sendMessage(
                        tab.id,
                        message,
                        { frameId: 0 },
                    );
                    if (!acknowledges(response)) {
                        failures.push({
                            hostname: adapter.hostname,
                            tabId: tab.id,
                            reason: "tab-update",
                        });
                    }
                } catch {
                    failures.push({
                        hostname: adapter.hostname,
                        tabId: tab.id,
                        reason: "tab-update",
                    });
                }
            }
        }
        return failures;
    }
}
