/**
 * @file React subscription to committed settings changes with own-write suppression.
 */

import { useEffect, useRef, useState } from "react";
import type { SubscribeSettingsChanged } from "../messaging/settings-notifications";

/**
 * Inputs of the settings change subscription.
 */
export interface SettingsChangedOptions {
    /**
     * Subscriber over the extension message runtime.
     */
    readonly subscribe: SubscribeSettingsChanged;

    /**
     * Newest revision the surface currently renders, or null while none is
     * loaded. A surface that renders several projections brings the lagging
     * ones up to this revision itself.
     */
    readonly revision: number | null;

    /**
     * Whether one of this surface's own writes is in flight.
     */
    readonly inFlight: boolean;

    /**
     * Called once per announcement that another surface committed.
     */
    readonly onExternalChange: () => void;
}

/**
 * Runs a callback whenever the background announces a revision this surface
 * did not write.
 *
 * The background announces every committed write to every page, including the
 * page that issued it, and the announcement can arrive before the command
 * response. The decision therefore waits until no write of this surface is in
 * flight: an announced revision the surface already renders by then carries
 * nothing new, because it was the surface's own write or a projection already
 * absorbed it; anything newer came from another surface. Announcements that
 * arrive during a write are kept, not dropped, so a foreign write that lands
 * beside an own write is still applied.
 *
 * @param options - Subscriber, rendered revision, in-flight flag, and callback.
 */
export function useSettingsChanged(options: SettingsChangedOptions): void {
    const { subscribe, revision, inFlight, onExternalChange } = options;
    const [pending, setPending] = useState<number>();
    const callback = useRef(onExternalChange);
    useEffect(() => {
        callback.current = onExternalChange;
    }, [onExternalChange]);
    useEffect(() => {
        const subscription = subscribe((announced) => {
            setPending((current) => current === undefined
                ? announced
                : Math.max(current, announced));
        });
        return () => {
            subscription.unsubscribe();
        };
    }, [subscribe]);
    useEffect(() => {
        if (pending === undefined || inFlight) {
            return;
        }
        setPending(undefined);
        if (revision === null || revision < pending) {
            callback.current();
        }
    }, [pending, inFlight, revision]);
}
