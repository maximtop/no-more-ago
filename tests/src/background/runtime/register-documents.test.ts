/**
 * @file Verifies universal document-runtime registration repair.
 */

import { describe, expect, it, vi } from "vitest";
/* eslint-disable @typescript-eslint/require-await */
import {
    DOCUMENT_RUNTIME_REGISTRATION,
    ensureDocumentRuntime,
} from "../../../../src/background/runtime/register-documents";

describe("ensureDocumentRuntime", () => {
    it("registers the persistent all-frame HTTP runtime", async () => {
        const runtime = {
            getRegisteredContentScripts: vi.fn(async () => []),
            registerContentScripts: vi.fn(async () => undefined),
            updateContentScripts: vi.fn(async () => undefined),
            executeScript: vi.fn(async () => []),
            unregisterContentScripts: vi.fn(async () => undefined),
        };

        await ensureDocumentRuntime(runtime);

        expect(runtime.registerContentScripts).toHaveBeenCalledWith([
            DOCUMENT_RUNTIME_REGISTRATION,
        ]);
        expect(runtime.updateContentScripts).not.toHaveBeenCalled();
    });

    it("repairs a mismatched registration and leaves a matching one alone", async () => {
        const runtime = {
            getRegisteredContentScripts: vi.fn(async () => [{
                ...DOCUMENT_RUNTIME_REGISTRATION,
                allFrames: false,
            }]),
            registerContentScripts: vi.fn(async () => undefined),
            updateContentScripts: vi.fn(async () => undefined),
            executeScript: vi.fn(async () => []),
            unregisterContentScripts: vi.fn(async () => undefined),
        };

        await ensureDocumentRuntime(runtime);
        expect(runtime.updateContentScripts).toHaveBeenCalledWith([
            DOCUMENT_RUNTIME_REGISTRATION,
        ]);

        runtime.getRegisteredContentScripts.mockResolvedValue([
            DOCUMENT_RUNTIME_REGISTRATION,
        ]);
        runtime.updateContentScripts.mockClear();
        await ensureDocumentRuntime(runtime);
        expect(runtime.updateContentScripts).not.toHaveBeenCalled();
    });
});
