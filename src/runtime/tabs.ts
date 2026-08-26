export interface RuntimeTab {
    readonly id: number;
    readonly url?: string;
}

export interface TabsRuntime {
    query(query: {
        readonly url?: string[];
        readonly active?: boolean;
        readonly currentWindow?: boolean;
    }): Promise<readonly RuntimeTab[]>;
    sendMessage(
        tabId: number,
        message: unknown,
        options: { readonly frameId: 0 }
    ): Promise<unknown>;
}

export type DocumentPhase = "waiting" | "active" | "stopped" | "failed";

export function isRuntimeTab(value: unknown): value is RuntimeTab {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
    const record = value as Record<string, unknown>;
    return Number.isSafeInteger(record.id) && (record.url === undefined || typeof record.url === "string");
}
