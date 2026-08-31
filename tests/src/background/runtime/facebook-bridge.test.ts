/**
 * @file Verifies browser-mediated Facebook bridge lease coordination.
 */

import { describe, expect, it, vi } from "vitest";

import { FacebookBridgeLeaseCoordinator } from
    "../../../../src/background/runtime/facebook-bridge";
import { SCRIPT_EXECUTION_WORLD, type ScriptingRuntime } from
    "../../../../src/background/runtime/scripting";
import { applyFacebookBridgeLeaseCommand } from
    "../../../../src/shared/facebook/bridge-command";
import { FACEBOOK_BRIDGE_LEASE_REQUEST_MESSAGE } from
    "../../../../src/shared/messaging/facebook-bridge";

const LEASE_ID = "12345678-1234-1234-1234-123456789abc";
const SECRET = "ab".repeat(32);

/**
 * Creates a scripting boundary that reports successful execution in frame seven.
 *
 * @returns - Complete scripting double and its execute spy.
 */
function scriptingBoundary() {
    const executeScript = vi.fn<ScriptingRuntime["executeScript"]>((input) =>
        Promise.resolve([{
            frameId: 7,
            ...(Reflect.has(input, "func") ? { result: true } : {}),
        }]));
    const scripting: ScriptingRuntime = {
        getRegisteredContentScripts: vi.fn(() => Promise.resolve([])),
        registerContentScripts: vi.fn(() => Promise.resolve()),
        updateContentScripts: vi.fn(() => Promise.resolve()),
        unregisterContentScripts: vi.fn(() => Promise.resolve()),
        executeScript,
    };
    return { scripting, executeScript };
}

describe("Facebook bridge lease coordinator", () => {
    it("installs the bridge before returning browser-mediated active credentials", async () => {
        const boundary = scriptingBoundary();
        const coordinator = new FacebookBridgeLeaseCoordinator({
            scripting: boundary.scripting,
            now: () => 1_000,
            createLeaseId: () => LEASE_ID,
            createSecret: () => SECRET,
        });

        await expect(coordinator.reconcile(3, 7, {
            type: FACEBOOK_BRIDGE_LEASE_REQUEST_MESSAGE,
            active: true,
        })).resolves.toEqual({
            ok: true,
            active: true,
            leaseId: LEASE_ID,
            secret: SECRET,
            expiresAt: 31_000,
        });
        expect(boundary.executeScript).toHaveBeenNthCalledWith(1, {
            target: { tabId: 3, frameIds: [7] },
            files: ["facebook-payload-bridge.js"],
            world: SCRIPT_EXECUTION_WORLD.MAIN,
        });
        expect(boundary.executeScript).toHaveBeenNthCalledWith(2, {
            target: { tabId: 3, frameIds: [7] },
            func: applyFacebookBridgeLeaseCommand,
            args: [{
                active: true,
                leaseId: LEASE_ID,
                secret: SECRET,
                expiresAt: 31_000,
            }],
            world: SCRIPT_EXECUTION_WORLD.MAIN,
        });
    });

    it("releases the named lease without reinstalling the bridge", async () => {
        const boundary = scriptingBoundary();
        const coordinator = new FacebookBridgeLeaseCoordinator({
            scripting: boundary.scripting,
        });

        await expect(coordinator.reconcile(3, 7, {
            type: FACEBOOK_BRIDGE_LEASE_REQUEST_MESSAGE,
            active: false,
            leaseId: LEASE_ID,
        })).resolves.toEqual({ ok: true, active: false });
        expect(boundary.executeScript).toHaveBeenCalledOnce();
        expect(boundary.executeScript).toHaveBeenCalledWith({
            target: { tabId: 3, frameIds: [7] },
            func: applyFacebookBridgeLeaseCommand,
            args: [{ active: false, leaseId: LEASE_ID }],
            world: SCRIPT_EXECUTION_WORLD.MAIN,
        });
    });

    it("returns no credentials when bridge installation misses the target frame", async () => {
        const boundary = scriptingBoundary();
        boundary.executeScript.mockResolvedValueOnce([{ frameId: 8 }]);
        const coordinator = new FacebookBridgeLeaseCoordinator({
            scripting: boundary.scripting,
            createLeaseId: () => LEASE_ID,
            createSecret: () => SECRET,
        });

        await expect(coordinator.reconcile(3, 7, {
            type: FACEBOOK_BRIDGE_LEASE_REQUEST_MESSAGE,
            active: true,
        })).resolves.toEqual({ ok: false });
        expect(boundary.executeScript).toHaveBeenCalledOnce();
    });
});
