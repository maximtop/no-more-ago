/**
 * @file Issues browser-mediated leases to the Facebook main-world payload bridge.
 */

import { applyFacebookBridgeLeaseCommand } from "../../shared/facebook/bridge-command";
import { FACEBOOK_PAYLOAD_BRIDGE_SCRIPT_FILE } from "../../shared/extension-files";
import {
    FACEBOOK_BRIDGE_LEASE_DURATION_MS,
    type FacebookBridgeLeaseCommand,
    type FacebookBridgeLeaseRequest,
    type FacebookBridgeLeaseResponse,
} from "../../shared/messaging/facebook-bridge";
import {
    SCRIPT_EXECUTION_WORLD,
    type InjectionResult,
    type ScriptingRuntime,
} from "./scripting";
import { settleBrowserOperation } from "./settle";

/**
 * Creates a cryptographically random lowercase hexadecimal value.
 *
 * @param byteLength - Number of random bytes to encode.
 * @returns - Hexadecimal random value with two characters per byte.
 */
function randomHex(byteLength: number): string {
    const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
    return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
}

/**
 * Checks whether an exact target frame reports the expected injected result.
 *
 * @param results - Browser results from a one-frame injection.
 * @param frameId - Frame expected to have executed the operation.
 * @param expectedResult - Optional exact function result.
 * @returns - Whether the target frame completed with the expected result.
 */
function hasFrameResult(
    results: readonly InjectionResult[],
    frameId: number,
    expectedResult?: unknown,
): boolean {
    return results.some((result) => result.frameId === frameId
        && (arguments.length < 3 || result.result === expectedResult));
}

/**
 * Browser and entropy dependencies for lease coordination.
 */
interface FacebookBridgeLeaseCoordinatorInput {
    /**
     * Scripting boundary used for main-world installation and commands.
     */
    readonly scripting: ScriptingRuntime;

    /**
     * Current Unix milliseconds.
     */
    readonly now?: () => number;

    /**
     * Creates one opaque lease identity.
     */
    readonly createLeaseId?: () => string;

    /**
     * Creates one 256-bit HMAC secret.
     */
    readonly createSecret?: () => string;
}

/**
 * Issues short-lived credentials and applies them through browser scripting.
 */
export class FacebookBridgeLeaseCoordinator {
    /**
     * Current-time provider.
     */
    private readonly now: () => number;

    /**
     * Opaque lease identifier provider.
     */
    private readonly createLeaseId: () => string;

    /**
     * Per-lease signing secret provider.
     */
    private readonly createSecret: () => string;

    /**
     * Creates a coordinator over the browser scripting boundary.
     *
     * @param input - Browser scripting, clock, and entropy dependencies.
     * @returns - New per-frame lease coordinator.
     */
    public constructor(private readonly input: FacebookBridgeLeaseCoordinatorInput) {
        this.now = input.now ?? Date.now;
        this.createLeaseId = input.createLeaseId ?? (() => crypto.randomUUID());
        this.createSecret = input.createSecret ?? (() => randomHex(32));
    }

    /**
     * Applies one active or release request to an exact extension-owned frame.
     *
     * @param tabId - Tab containing the requesting content runtime.
     * @param frameId - Exact requesting frame.
     * @param request - Validated acquire, renew, or release request.
     * @returns - Active credentials only after the main-world bridge accepts them.
     */
    public async reconcile(
        tabId: number,
        frameId: number,
        request: FacebookBridgeLeaseRequest,
    ): Promise<FacebookBridgeLeaseResponse> {
        if (!request.active) {
            const released = await this.applyCommand(tabId, frameId, {
                active: false,
                leaseId: request.leaseId,
            }, false);
            return released ? { ok: true, active: false } : { ok: false };
        }
        const leaseId = this.createLeaseId();
        const secret = this.createSecret();
        const expiresAt = this.now() + FACEBOOK_BRIDGE_LEASE_DURATION_MS;
        const command: FacebookBridgeLeaseCommand = {
            active: true,
            leaseId,
            secret,
            expiresAt,
        };
        const applied = await this.applyCommand(tabId, frameId, command, true);
        return applied
            ? { ok: true, active: true, leaseId, secret, expiresAt }
            : { ok: false };
    }

    /**
     * Ensures the bridge when needed and injects one self-contained lease command.
     *
     * @param tabId - Target tab.
     * @param frameId - Exact target frame.
     * @param command - Active or release command.
     * @param ensureInstalled - Whether the bridge bundle must be injected first.
     * @returns - Whether the target bridge accepted the command.
     */
    private async applyCommand(
        tabId: number,
        frameId: number,
        command: FacebookBridgeLeaseCommand,
        ensureInstalled: boolean,
    ): Promise<boolean> {
        if (ensureInstalled) {
            const installed = await settleBrowserOperation(() =>
                this.input.scripting.executeScript({
                    target: { tabId, frameIds: [frameId] },
                    files: [FACEBOOK_PAYLOAD_BRIDGE_SCRIPT_FILE],
                    world: SCRIPT_EXECUTION_WORLD.MAIN,
                }));
            if (!installed.ok || !hasFrameResult(installed.value, frameId)) {
                return false;
            }
        }
        const applied = await settleBrowserOperation(() => this.input.scripting.executeScript({
            target: { tabId, frameIds: [frameId] },
            func: applyFacebookBridgeLeaseCommand,
            args: [command] as const,
            world: SCRIPT_EXECUTION_WORLD.MAIN,
        }));
        return applied.ok && hasFrameResult(applied.value, frameId, true);
    }
}
