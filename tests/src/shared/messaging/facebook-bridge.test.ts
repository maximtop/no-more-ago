/**
 * @file Verifies browser-mediated Facebook bridge lease message boundaries.
 */

import { describe, expect, it } from "vitest";

import {
    FACEBOOK_BRIDGE_LEASE_REQUEST_MESSAGE,
    isFacebookBridgeLease,
    isFacebookBridgeLeaseRequest,
} from "../../../../src/shared/messaging/facebook-bridge";

const LEASE_ID = "12345678-1234-1234-1234-123456789abc";
const SECRET = "ab".repeat(32);

describe("Facebook bridge lease messages", () => {
    it("accepts only exact acquire and release request shapes", () => {
        expect(isFacebookBridgeLeaseRequest({
            type: FACEBOOK_BRIDGE_LEASE_REQUEST_MESSAGE,
            active: true,
        })).toBe(true);
        expect(isFacebookBridgeLeaseRequest({
            type: FACEBOOK_BRIDGE_LEASE_REQUEST_MESSAGE,
            active: false,
            leaseId: LEASE_ID,
        })).toBe(true);
        expect(isFacebookBridgeLeaseRequest({
            type: FACEBOOK_BRIDGE_LEASE_REQUEST_MESSAGE,
            active: true,
            leaseId: LEASE_ID,
        })).toBe(false);
        expect(isFacebookBridgeLeaseRequest({
            type: FACEBOOK_BRIDGE_LEASE_REQUEST_MESSAGE,
            active: false,
            leaseId: "page-controlled",
        })).toBe(false);
    });

    it("accepts only complete bounded active lease credentials", () => {
        const lease = {
            ok: true,
            active: true,
            leaseId: LEASE_ID,
            secret: SECRET,
            expiresAt: 1_000,
        };

        expect(isFacebookBridgeLease(lease)).toBe(true);
        expect(isFacebookBridgeLease({ ...lease, secret: "00" })).toBe(false);
        expect(isFacebookBridgeLease({ ...lease, expiresAt: 1.5 })).toBe(false);
        expect(isFacebookBridgeLease({ ...lease, leaseId: "page-controlled" })).toBe(false);
    });
});
