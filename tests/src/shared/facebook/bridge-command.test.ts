/**
 * @file Verifies the self-contained main-world Facebook lease command.
 */

import { describe, expect, it, vi } from "vitest";

import { applyFacebookBridgeLeaseCommand } from
    "../../../../src/shared/facebook/bridge-command";
import { FACEBOOK_PAYLOAD_BRIDGE_SLOT_KEY } from
    "../../../../src/shared/messaging/facebook-bridge";

const BRIDGE_SLOT = Symbol.for(FACEBOOK_PAYLOAD_BRIDGE_SLOT_KEY);

describe("Facebook bridge lease command", () => {
    it("fails closed when no bridge slot exists", () => {
        expect(applyFacebookBridgeLeaseCommand(
            FACEBOOK_PAYLOAD_BRIDGE_SLOT_KEY,
            {
                active: false,
                generation: 1,
                leaseId: "12345678-1234-1234-1234-123456789abc",
            },
        )).toBe(false);
    });

    it("rejects a page-replaceable lookalike slot", () => {
        const reconcileLease = vi.fn(() => true);
        Object.defineProperty(window, BRIDGE_SLOT, {
            value: Object.freeze({ reconcileLease }),
            configurable: true,
        });

        expect(applyFacebookBridgeLeaseCommand(
            FACEBOOK_PAYLOAD_BRIDGE_SLOT_KEY,
            {
                active: false,
                generation: 1,
                leaseId: "12345678-1234-1234-1234-123456789abc",
            },
        )).toBe(false);
        expect(reconcileLease).not.toHaveBeenCalled();
        Reflect.deleteProperty(window, BRIDGE_SLOT);
    });

    it("invokes only a compatible installed bridge slot", () => {
        const reconcileLease = vi.fn(() => true);
        Object.defineProperty(window, BRIDGE_SLOT, {
            value: Object.freeze({ reconcileLease }),
            configurable: false,
            writable: false,
        });
        const command = {
            active: false as const,
            generation: 1,
            leaseId: "12345678-1234-1234-1234-123456789abc",
        };

        expect(applyFacebookBridgeLeaseCommand(
            FACEBOOK_PAYLOAD_BRIDGE_SLOT_KEY,
            command,
        )).toBe(true);
        expect(reconcileLease).toHaveBeenCalledWith(command);
    });
});
