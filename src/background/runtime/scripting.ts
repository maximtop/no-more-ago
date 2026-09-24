/**
 * Declares the Chrome Scripting API subset used for document registration and injection.
 *
 * @file Chrome Scripting API contracts for the universal document runtime.
 */

/**
 * JavaScript execution worlds supported by extension scripting operations.
 */
export const SCRIPT_EXECUTION_WORLD = {
    ISOLATED: 'ISOLATED',
    MAIN: 'MAIN',
} as const;

/**
 * JavaScript execution world used by a registration or one-off injection.
 */
export type ScriptExecutionWorld = (typeof SCRIPT_EXECUTION_WORLD)[keyof typeof SCRIPT_EXECUTION_WORLD];

/**
 * Complete dynamic content-script registration specification.
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
    readonly runAt: 'document_start';

    /**
     * Whether Chrome injects into every matching frame rather than only the top frame.
     */
    readonly allFrames: boolean;

    /**
     * Whether Chrome retains this dynamic registration across browser sessions.
     */
    readonly persistAcrossSessions: boolean;

    /**
     * JavaScript world where the registered files execute.
     */
    readonly world: ScriptExecutionWorld;
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

    /**
     * Returned JavaScript execution world when Chrome includes it.
     */
    readonly world?: string | undefined;
}

/**
 * One-off script target covering every reachable frame in a tab.
 */
interface AllFramesScriptTarget {
    /**
     * Tab receiving the script.
     */
    readonly tabId: number;

    /**
     * Selects every reachable frame.
     */
    readonly allFrames: true;
}

/**
 * One-off script target covering explicit reachable frames in a tab.
 */
interface ExplicitFramesScriptTarget {
    /**
     * Tab receiving the script.
     */
    readonly tabId: number;

    /**
     * Exact frame identifiers receiving the script.
     */
    readonly frameIds: number[];
}

/**
 * Supported all-frame or explicit-frame one-off script target.
 */
export type ScriptInjectionTarget = AllFramesScriptTarget | ExplicitFramesScriptTarget;

/**
 * One-off injection of extension bundle files.
 */
export interface FileScriptInjection {
    /**
     * Selected tab and frame scope.
     */
    readonly target: ScriptInjectionTarget;

    /**
     * Extension-relative files to execute.
     */
    readonly files: string[];

    /**
     * Optional JavaScript world override.
     */
    readonly world?: ScriptExecutionWorld;
}

/**
 * One-off injection of a serializable function and its arguments.
 */
export interface FunctionScriptInjection {
    /**
     * Selected tab and frame scope.
     */
    readonly target: ScriptInjectionTarget;

    /**
     * Self-contained function serialized by the browser.
     */
    readonly func: (...args: never[]) => unknown;

    /**
     * Structured-cloneable arguments supplied to the function.
     */
    readonly args: readonly unknown[];

    /**
     * Optional JavaScript world override.
     */
    readonly world?: ScriptExecutionWorld;
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
     * Executes a content file in every frame of a tab.
     */
    executeScript(
        input: FileScriptInjection | FunctionScriptInjection,
    ): Promise<readonly InjectionResult[]>;

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
