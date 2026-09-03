/**
 * @file React subscription to committed settings changes.
 */

import { useEffect } from "react";
import type { SubscribeSettingsChanged } from "../messaging/settings-notifications";

/**
 * Runs a callback whenever the background announces a newer settings revision.
 *
 * @param subscribe - Subscriber over the extension message runtime.
 * @param currentRevision - Revision the surface already renders, or null.
 * @param onNewerRevision - Called once per announcement that is newer, with its revision.
 */
export function useSettingsChanged(
    subscribe: SubscribeSettingsChanged,
    currentRevision: number | null,
    onNewerRevision: (revision: number) => void,
): void {
    useEffect(() => {
        const subscription = subscribe((revision) => {
            if (currentRevision === null || revision > currentRevision) {
                onNewerRevision(revision);
            }
        });
        return () => {
            subscription.unsubscribe();
        };
    }, [subscribe, currentRevision, onNewerRevision]);
}
