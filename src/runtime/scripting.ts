export interface RegisteredContentScriptSpec {
    readonly id: string;
    readonly matches: string[];
    readonly js: string[];
    readonly runAt: "document_start";
    readonly allFrames: boolean;
    readonly persistAcrossSessions: boolean;
}

export interface RegisteredContentScriptReference {
    readonly id: string;
    readonly matches?: readonly string[] | undefined;
    readonly js?: readonly string[] | undefined;
    readonly runAt?: string | undefined;
    readonly allFrames?: boolean | undefined;
    readonly persistAcrossSessions?: boolean | undefined;
}

export interface ScriptingRuntime {
    getRegisteredContentScripts(filter: {
        ids: string[];
    }): Promise<readonly RegisteredContentScriptReference[]>;
    registerContentScripts(scripts: RegisteredContentScriptSpec[]): Promise<void>;
    updateContentScripts(scripts: RegisteredContentScriptSpec[]): Promise<void>;
    unregisterContentScripts?(filter: { ids: string[] }): Promise<void>;
    executeScript?(input: {
        readonly target: { readonly tabId: number; readonly allFrames: false };
        readonly files: string[];
    }): Promise<unknown>;
}
