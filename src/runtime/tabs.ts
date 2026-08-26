/**
 * Models the tab data and APIs used to locate adapter pages and message their top frames.
 *
 * @file Models the tab data and APIs used to locate adapter pages and message their top frames.
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
     * Sends a message to a specific tab's top-level content frame.
     */
    sendMessage(
        tabId: number,
        message: unknown,
        options: {
            /**
             * Top-level frame target.
             */
            readonly frameId: 0;
        },
    ): Promise<unknown>;
}

/**
 * Recognizes browser tab records with a safe numeric ID and optional string URL.
 *
 * @param value - Untrusted browser tab value.
 * @returns - Whether the value is a usable runtime tab record.
 */
export function isRuntimeTab(value: unknown): value is RuntimeTab {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return false;
    }
    const record = value as Record<string, unknown>;
    return (
        Number.isSafeInteger(record.id) &&
        (record.url === undefined || typeof record.url === "string")
    );
}
