/**
 * @file Verifies browser-mediated Facebook bridge lease coordination.
 */

import { describe, expect, it, vi } from "vitest";

import { FacebookBridgeLeaseCoordinator } from
    "../../../../src/background/runtime/facebook-bridge";
import { BROWSER_OPERATION_TIMEOUT_MS } from
    "../../../../src/background/runtime/settle";
import { SCRIPT_EXECUTION_WORLD, type ScriptingRuntime } from
    "../../../../src/background/runtime/scripting";
import { applyFacebookBridgeLeaseCommand } from
    "../../../../src/shared/facebook/bridge-command";
import { FACEBOOK_PAYLOAD_BRIDGE_SCRIPT_FILE } from
    "../../../../src/shared/extension-files";
import {
    FACEBOOK_BRIDGE_LEASE_REQUEST_MESSAGE,
    FACEBOOK_PAYLOAD_BRIDGE_SLOT_KEY,
} from
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
    it("commands an installed bridge without reinjecting its bundle", async () => {
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
        expect(boundary.executeScript).toHaveBeenCalledOnce();
        expect(boundary.executeScript).toHaveBeenCalledWith({
            target: { tabId: 3, frameIds: [7] },
            func: applyFacebookBridgeLeaseCommand,
            args: [FACEBOOK_PAYLOAD_BRIDGE_SLOT_KEY, {
                active: true,
                generation: 1_000,
                leaseId: LEASE_ID,
                secret: SECRET,
                expiresAt: 31_000,
            }],
            world: SCRIPT_EXECUTION_WORLD.MAIN,
        });
    });

    it("installs and retries only after the exact frame reports a missing slot", async () => {
        const boundary = scriptingBoundary();
        boundary.executeScript.mockResolvedValueOnce([{ frameId: 7, result: false }]);
        const coordinator = new FacebookBridgeLeaseCoordinator({
            scripting: boundary.scripting,
            now: () => 1_000,
            createLeaseId: () => LEASE_ID,
            createSecret: () => SECRET,
        });

        await expect(coordinator.reconcile(3, 7, {
            type: FACEBOOK_BRIDGE_LEASE_REQUEST_MESSAGE,
            active: true,
        })).resolves.toMatchObject({ ok: true, active: true });

        expect(boundary.executeScript).toHaveBeenNthCalledWith(2, {
            target: { tabId: 3, frameIds: [7] },
            files: [FACEBOOK_PAYLOAD_BRIDGE_SCRIPT_FILE],
            world: SCRIPT_EXECUTION_WORLD.MAIN,
        });
        expect(boundary.executeScript).toHaveBeenCalledTimes(3);
    });

    it("renews through one command without reinjecting the installed bundle", async () => {
        const boundary = scriptingBoundary();
        const coordinator = new FacebookBridgeLeaseCoordinator({
            scripting: boundary.scripting,
            now: () => 1_000,
            createLeaseId: () => LEASE_ID,
            createSecret: () => SECRET,
        });

        await coordinator.reconcile(3, 7, {
            type: FACEBOOK_BRIDGE_LEASE_REQUEST_MESSAGE,
            active: true,
        });
        await coordinator.reconcile(3, 7, {
            type: FACEBOOK_BRIDGE_LEASE_REQUEST_MESSAGE,
            active: true,
        });

        expect(boundary.executeScript).toHaveBeenCalledTimes(2);
        expect(boundary.executeScript.mock.calls.map(([input]) =>
            Reflect.has(input, "func"))).toEqual([true, true]);
        expect(boundary.executeScript.mock.calls[1]?.[0]).toMatchObject({
            args: [FACEBOOK_PAYLOAD_BRIDGE_SLOT_KEY, { generation: 1_001 }],
        });
    });

    it("releases the named lease without reinstalling the bridge", async () => {
        const boundary = scriptingBoundary();
        const coordinator = new FacebookBridgeLeaseCoordinator({
            scripting: boundary.scripting,
            now: () => 1_000,
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
            args: [FACEBOOK_PAYLOAD_BRIDGE_SLOT_KEY, {
                active: false,
                generation: 1_000,
                leaseId: LEASE_ID,
            }],
            world: SCRIPT_EXECUTION_WORLD.MAIN,
        });
    });

    it("returns no credentials when command execution misses the target frame", async () => {
        const boundary = scriptingBoundary();
        boundary.executeScript.mockResolvedValueOnce([{ frameId: 8 }]);
        const coordinator = new FacebookBridgeLeaseCoordinator({
            scripting: boundary.scripting,
            now: () => 1_000,
            createLeaseId: () => LEASE_ID,
            createSecret: () => SECRET,
        });

        await expect(coordinator.reconcile(3, 7, {
            type: FACEBOOK_BRIDGE_LEASE_REQUEST_MESSAGE,
            active: true,
        })).resolves.toEqual({ ok: false });
        expect(boundary.executeScript.mock.calls[0]?.[0]).toMatchObject({
            args: [FACEBOOK_PAYLOAD_BRIDGE_SLOT_KEY, { generation: 1_000 }],
        });
    });

    it("reapplies a release barrier after a timed-out active command settles late", async () => {
        vi.useFakeTimers();
        const boundary = scriptingBoundary();
        let resolveLate: ((
            value: readonly { readonly frameId: number; readonly result: boolean }[],
        ) => void) | undefined;
        boundary.executeScript.mockImplementationOnce(() => new Promise((resolve) => {
            resolveLate = resolve;
        }));
        const coordinator = new FacebookBridgeLeaseCoordinator({
            scripting: boundary.scripting,
            now: () => 1_000,
            createLeaseId: () => LEASE_ID,
            createSecret: () => SECRET,
        });

        const response = coordinator.reconcile(3, 7, {
            type: FACEBOOK_BRIDGE_LEASE_REQUEST_MESSAGE,
            active: true,
        });
        await vi.advanceTimersByTimeAsync(BROWSER_OPERATION_TIMEOUT_MS);
        await expect(response).resolves.toEqual({ ok: false });
        expect(boundary.executeScript.mock.calls[1]?.[0]).toMatchObject({
            args: [FACEBOOK_PAYLOAD_BRIDGE_SLOT_KEY, {
                active: false,
                generation: 1_001,
                leaseId: LEASE_ID,
            }],
        });

        resolveLate?.([{ frameId: 7, result: true }]);
        await vi.runAllTimersAsync();
        await Promise.resolve();

        expect(boundary.executeScript.mock.calls.at(-1)?.[0]).toMatchObject({
            args: [FACEBOOK_PAYLOAD_BRIDGE_SLOT_KEY, {
                active: false,
                generation: 1_001,
                leaseId: LEASE_ID,
            }],
        });
        vi.useRealTimers();
    });
});
