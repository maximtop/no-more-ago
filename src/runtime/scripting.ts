/**
 * Declares the Chrome Scripting API subset used for adapter registration and injection.
 *
 * @file Chrome Scripting API contracts for runtime adapters.
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
 * Chrome Scripting API methods used to manage adapter registrations and inject files.
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
     * Removes dynamic registrations whose IDs are listed in the Chrome filter.
     */
    unregisterContentScripts?(filter: {
        /**
         * Registration IDs to remove.
         */
        ids: string[];
    }): Promise<void>;

    /**
     * Injects extension files into the selected tab's top frame.
     */
    executeScript?(input: {
        /**
         * Chrome execution target, deliberately limited to one top frame.
         */
        readonly target: {
            /**
             * Tab receiving the injected files.
             */
            readonly tabId: number;

            /**
             * Prevents injection into child frames.
             */
            readonly allFrames: false;
        };

        /**
         * Extension-relative JavaScript files to execute.
         */
        readonly files: string[];
    }): Promise<unknown>;
}
