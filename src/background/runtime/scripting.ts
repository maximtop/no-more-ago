/**
 * Declares the Chrome Scripting API subset used for document registration and injection.
 *
 * @file Chrome Scripting API contracts for the universal document runtime.
 */
export interface RegisteredContentScriptSpec {
    /**
     * Chrome registration ID, stable across updates and lookups.
     */
    readonly id: string;

    /**
     * Chrome match patterns that select pages for the content script.
     */
    readonly matches: string[];

    /**
     * Extension-relative JavaScript files injected by the registration.
     */
    readonly js: string[];

    /**
     * Requests injection at document start, before normal page scripts run.
     */
    readonly runAt: "document_start";

    /**
     * Whether Chrome injects into every matching frame rather than only the top frame.
     */
    readonly allFrames: boolean;

    /**
     * Whether Chrome retains this dynamic registration across browser sessions.
     */
    readonly persistAcrossSessions: boolean;
}

/**
 * Registration fields returned by Chrome when inspecting existing content scripts.
 */
export interface RegisteredContentScriptReference {
    /**
     * Chrome registration ID.
     */
    readonly id: string;

    /**
     * Returned match patterns when Chrome includes them.
     */
    readonly matches?: readonly string[] | undefined;

    /**
     * Returned JavaScript file list when Chrome includes it.
     */
    readonly js?: readonly string[] | undefined;

    /**
     * Returned injection timing when Chrome includes it.
     */
    readonly runAt?: string | undefined;

    /**
     * Returned all-frames setting when Chrome includes it.
     */
    readonly allFrames?: boolean | undefined;

    /**
     * Returned persistence setting when Chrome includes it.
     */
    readonly persistAcrossSessions?: boolean | undefined;
}

/**
 * Chrome Scripting API methods used to manage document registration and inject files.
 */
export interface ScriptingRuntime {
    /**
     * Returns registrations whose IDs are listed in the Chrome filter.
     */
    getRegisteredContentScripts(filter: {
        /**
         * Registration IDs to retrieve.
         */
        ids: string[];
    }): Promise<readonly RegisteredContentScriptReference[]>;

    /**
     * Adds the supplied dynamic content-script registrations.
     */
    registerContentScripts(scripts: RegisteredContentScriptSpec[]): Promise<void>;

    /**
     * Updates existing dynamic registrations by their IDs.
     */
    updateContentScripts(scripts: RegisteredContentScriptSpec[]): Promise<void>;

    /**
     * Executes a content file in every frame or an explicit set of frames in a tab.
     */
    executeScript(input: {
        /**
         * Frames in the tab selected for recovery injection.
         */
        readonly target: {
            /**
             * Tab identifier receiving the injection.
             */
            readonly tabId: number;

            /**
             * Requires execution in every reachable frame.
             */
            readonly allFrames: true;
        } | {
            /**
             * Tab identifier receiving the injection.
             */
            readonly tabId: number;

            /**
             * Exact frames whose policy message was not acknowledged.
             */
            readonly frameIds: number[];
        };

        /**
         * Extension-relative files to execute.
         */
        readonly files: string[];
    }): Promise<readonly InjectionResult[]>;

    /**
     * Removes dynamic registrations whose IDs are listed in the Chrome filter.
     */
    unregisterContentScripts(filter: {
        /**
         * Registration IDs to remove.
         */
        ids: string[];
    }): Promise<void>;
}

/**
 * Successful result returned by the browser's all-frame script execution.
 */
export interface InjectionResult {
    /**
     * Frame ID where the script ran.
     */
    readonly frameId: number;

    /**
     * Optional script result value.
     */
    readonly result?: unknown;
}
