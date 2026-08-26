import { describe, expect, it, vi } from "vitest";

import { ensureGitHubRuntime, GITHUB_REGISTRATION } from "../../src/runtime/register-github";

describe("ensureGitHubRuntime", () => {
    it("registers the exact GitHub content script when missing", async () => {
        const runtime = {
            getRegisteredContentScripts: vi.fn(() => Promise.resolve([])),
            registerContentScripts: vi.fn(() => Promise.resolve()),
            updateContentScripts: vi.fn(() => Promise.resolve())
        };

        await ensureGitHubRuntime(runtime);

        expect(runtime.registerContentScripts).toHaveBeenCalledWith([{
            id: "no-more-ago-github",
            matches: ["http://github.com/*", "https://github.com/*"],
            js: ["content.js"],
            runAt: "document_start",
            allFrames: false,
            persistAcrossSessions: true
        }]);
        expect(runtime.updateContentScripts).not.toHaveBeenCalled();
    });

    it("updates the exact GitHub content script when it already exists", async () => {
        const runtime = {
            getRegisteredContentScripts: vi.fn(() =>
                Promise.resolve([{ id: GITHUB_REGISTRATION.id }])
            ),
            registerContentScripts: vi.fn(() => Promise.resolve()),
            updateContentScripts: vi.fn(() => Promise.resolve())
        };

        await ensureGitHubRuntime(runtime);

        expect(runtime.updateContentScripts).toHaveBeenCalledTimes(1);
        expect(runtime.updateContentScripts).toHaveBeenCalledWith([GITHUB_REGISTRATION]);
        expect(runtime.registerContentScripts).not.toHaveBeenCalled();
    });

    it("does not update an already matching persistent registration", async () => {
        const runtime = {
            getRegisteredContentScripts: vi.fn(() => Promise.resolve([{ ...GITHUB_REGISTRATION }])),
            registerContentScripts: vi.fn(() => Promise.resolve()),
            updateContentScripts: vi.fn(() => Promise.resolve())
        };
        await ensureGitHubRuntime(runtime);
        expect(runtime.registerContentScripts).not.toHaveBeenCalled();
        expect(runtime.updateContentScripts).not.toHaveBeenCalled();
    });
});
