/**
 * @file Browser-mediated lifecycle contract for the Facebook main-world bridge.
 */

/**
 * Requests acquisition, renewal, or release of a Facebook bridge lease.
 */
export const FACEBOOK_BRIDGE_LEASE_REQUEST_MESSAGE =
    "no-more-ago:facebook-bridge-lease-request" as const;

/**
 * Global-symbol key for the immutable main-world bridge command surface.
 */
export const FACEBOOK_PAYLOAD_BRIDGE_SLOT_KEY =
    "no-more-ago.facebook-payload-bridge" as const;

/**
 * Duration of one main-world inspection lease before automatic disposal.
 */
export const FACEBOOK_BRIDGE_LEASE_DURATION_MS = 30_000 as const;

/**
 * Delay before an active isolated runtime renews its current lease.
 */
export const FACEBOOK_BRIDGE_LEASE_RENEWAL_MS = 15_000 as const;

/**
 * Exact hexadecimal form of a per-lease HMAC secret.
 */
export const FACEBOOK_BRIDGE_SECRET = /^[\da-f]{64}$/u;

/**
 * Bounded opaque identifier assigned to one bridge lease.
 */
export const FACEBOOK_BRIDGE_LEASE_ID = /^[\da-f-]{16,64}$/u;

/**
 * Content-runtime request for a new lease or release of the current lease.
 */
export type FacebookBridgeLeaseRequest =
    | {
        /**
         * Stable browser-message discriminant.
         */
        readonly type: typeof FACEBOOK_BRIDGE_LEASE_REQUEST_MESSAGE;

        /**
         * Requests a fresh active lease.
         */
        readonly active: true;
    }
    | {
        /**
         * Stable browser-message discriminant.
         */
        readonly type: typeof FACEBOOK_BRIDGE_LEASE_REQUEST_MESSAGE;

        /**
         * Requests release of the named active lease.
         */
        readonly active: false;

        /**
         * Lease known only to the isolated runtime and background response.
         */
        readonly leaseId: string;
    };

/**
 * Successful active lease returned through extension runtime messaging.
 */
export interface FacebookBridgeLease {
    /**
     * Identifies a successful lease response.
     */
    readonly ok: true;

    /**
     * Identifies an acquired or renewed active lease.
     */
    readonly active: true;

    /**
     * Opaque lease identity included in authenticated payload messages.
     */
    readonly leaseId: string;

    /**
     * Per-lease HMAC secret delivered only through browser-mediated channels.
     */
    readonly secret: string;

    /**
     * Absolute Unix milliseconds when the main-world lease expires.
     */
    readonly expiresAt: number;
}

/**
 * Successful release acknowledgement.
 */
export interface FacebookBridgeLeaseRelease {
    /**
     * Identifies a successful lease operation.
     */
    readonly ok: true;

    /**
     * Identifies release rather than active credentials.
     */
    readonly active: false;
}

/**
 * Failed lease operation returned without exposing partial credentials.
 */
export interface FacebookBridgeLeaseFailure {
    /**
     * Identifies a failed lease response.
     */
    readonly ok: false;
}

/**
 * Browser-mediated lease response accepted by the isolated runtime.
 */
export type FacebookBridgeLeaseResponse =
    | FacebookBridgeLease
    | FacebookBridgeLeaseRelease
    | FacebookBridgeLeaseFailure;

/**
 * Command injected by the background into the page's main world.
 */
export type FacebookBridgeLeaseCommand =
    | {
        /**
         * Installs or renews active response inspection.
         */
        readonly active: true;

        /**
         * Monotonic per-background command generation used to reject late execution.
         */
        readonly generation: number;

        /**
         * Opaque identity for the new lease generation.
         */
        readonly leaseId: string;

        /**
         * Per-lease HMAC secret retained only in extension-controlled closures.
         */
        readonly secret: string;

        /**
         * Absolute Unix milliseconds when wrappers must become inactive.
         */
        readonly expiresAt: number;
    }
    | {
        /**
         * Releases the named lease and its owned wrappers.
         */
        readonly active: false;

        /**
         * Monotonic per-background command generation used to reject late execution.
         */
        readonly generation: number;

        /**
         * Current lease identity required to reject stale releases.
         */
        readonly leaseId: string;
    };

/**
 * Validates a content-runtime bridge lease request.
 *
 * @param value - Candidate extension runtime message.
 * @returns - Whether the request has the exact acquire or release shape.
 */
export function isFacebookBridgeLeaseRequest(
    value: unknown,
): value is FacebookBridgeLeaseRequest {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        return false;
    }
    const candidate = value as Record<string, unknown>;
    if (
        candidate.type !== FACEBOOK_BRIDGE_LEASE_REQUEST_MESSAGE
        || typeof candidate.active !== "boolean"
    ) {
        return false;
    }
    const keys = Object.keys(candidate).sort();
    return candidate.active
        ? keys.length === 2 && keys[0] === "active" && keys[1] === "type"
        : keys.length === 3
            && keys[0] === "active"
            && keys[1] === "leaseId"
            && keys[2] === "type"
            && typeof candidate.leaseId === "string"
            && FACEBOOK_BRIDGE_LEASE_ID.test(candidate.leaseId);
}
