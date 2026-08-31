/**
 * @file Verifies the self-contained main-world Facebook lease command.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { applyFacebookBridgeLeaseCommand } from
    "../../../../src/shared/facebook/bridge-command";

const BRIDGE_SLOT = Symbol.for("no-more-ago.facebook-payload-bridge");

afterEach(() => {
    Reflect.deleteProperty(window, BRIDGE_SLOT);
});

describe("Facebook bridge lease command", () => {
    it("invokes only a compatible installed bridge slot", () => {
        const reconcileLease = vi.fn(() => true);
        Object.defineProperty(window, BRIDGE_SLOT, {
            value: { reconcileLease },
            configurable: true,
        });
        const command = {
            active: false as const,
            leaseId: "12345678-1234-1234-1234-123456789abc",
        };

        expect(applyFacebookBridgeLeaseCommand(command)).toBe(true);
        expect(reconcileLease).toHaveBeenCalledWith(command);
    });

    it("fails closed when no bridge slot exists", () => {
        expect(applyFacebookBridgeLeaseCommand({
            active: false,
            leaseId: "12345678-1234-1234-1234-123456789abc",
        })).toBe(false);
    });
});
