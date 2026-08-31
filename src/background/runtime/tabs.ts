/**
 * Defines the narrow browser boundary for locating tabs, enumerating frames, and messaging them.
 *
 * @file Browser tab and frame capabilities used by background services.
 */
export interface RuntimeTab {
    /**
     * Numeric tab ID accepted by sendMessage for the lifetime of the tab.
     */
    readonly id: number;

    /**
     * Page URL when the browser exposes it for this tab.
     */
    readonly url?: string;
}

/**
 * Identifies a reachable frame in a tab.
 */
export interface RuntimeFrame {
    /**
     * Numeric frame ID accepted by targeted sendMessage delivery.
     */
    readonly frameId: number;

    /**
     * HTTP(S) document URL when the browser exposes it.
     */
    readonly url?: string;
}

/**
 * Subset of the browser tabs API used by the extension runtime.
 */
export interface TabsRuntime {
    /**
     * Finds tabs matching the supplied Chrome tab-query filters.
     */
    query(query: {
        /**
         * URL match patterns that restrict the returned tabs.
         */
        readonly url?: string[];

        /**
         * Restricts a tab query to the active tab.
         */
        readonly active?: boolean;

        /**
         * Restricts a tab query to the current window.
         */
        readonly currentWindow?: boolean;
    }): Promise<readonly RuntimeTab[]>;

    /**
     * Finds every currently reachable frame in a tab.
     *
     * @param tabId - Tab whose frames should be enumerated.
     * @returns - Reachable frame identifiers, including the top-level frame.
     */
    getAllFrames(tabId: number): Promise<readonly RuntimeFrame[]>;

    /**
     * Sends a message to one frame when a frame ID is supplied, or every frame otherwise.
     */
    sendMessage(
        tabId: number,
        message: unknown,
        options?: {
            /**
             * Frame identifier for targeted delivery.
             */
            readonly frameId: number;
        },
    ): Promise<unknown>;
}
