/**
 * @file Issues browser-mediated leases to the Facebook main-world payload bridge.
 */

import { applyFacebookBridgeLeaseCommand } from "../../shared/facebook/bridge-command";
import { FACEBOOK_PAYLOAD_BRIDGE_SCRIPT_FILE } from "../../shared/extension-files";
import {
    FACEBOOK_BRIDGE_LEASE_DURATION_MS,
    FACEBOOK_PAYLOAD_BRIDGE_SLOT_KEY,
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

const MAX_RETAINED_FACEBOOK_BRIDGE_FRAMES = 2_000;

/**
 * Observable result of one exact-frame command attempt.
 */
const FACEBOOK_BRIDGE_COMMAND_RESULT = {
    ACCEPTED: "accepted",
    REJECTED: "rejected",
    FAILED: "failed",
} as const;

/**
 * Exact observable result of one main-world command attempt.
 */
type FacebookBridgeCommandResult = (typeof FACEBOOK_BRIDGE_COMMAND_RESULT)[
    keyof typeof FACEBOOK_BRIDGE_COMMAND_RESULT
];

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
     * Monotonic generation assigned before every desired state transition.
     */
    private commandGeneration = 0;

    /**
     * Latest desired command per exact frame, retained for late-operation convergence.
     */
    private readonly desiredCommands = new Map<string, FacebookBridgeLeaseCommand>();

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
            const command: FacebookBridgeLeaseCommand = {
                active: false,
                generation: this.nextCommandGeneration(),
                leaseId: request.leaseId,
            };
            this.rememberDesiredCommand(tabId, frameId, command);
            const released = await this.applyCommand(tabId, frameId, command, true);
            return released && this.isDesiredCommand(tabId, frameId, command)
                ? { ok: true, active: false }
                : { ok: false };
        }
        const leaseId = this.createLeaseId();
        const secret = this.createSecret();
        const expiresAt = this.now() + FACEBOOK_BRIDGE_LEASE_DURATION_MS;
        const command: FacebookBridgeLeaseCommand = {
            active: true,
            generation: this.nextCommandGeneration(),
            leaseId,
            secret,
            expiresAt,
        };
        this.rememberDesiredCommand(tabId, frameId, command);
        const applied = await this.applyCommand(tabId, frameId, command, true);
        if (applied && this.isDesiredCommand(tabId, frameId, command)) {
            return { ok: true, active: true, leaseId, secret, expiresAt };
        }
        if (this.isDesiredCommand(tabId, frameId, command)) {
            const barrier: FacebookBridgeLeaseCommand = {
                active: false,
                generation: this.nextCommandGeneration(),
                leaseId,
            };
            this.rememberDesiredCommand(tabId, frameId, barrier);
            void this.applyCommand(tabId, frameId, barrier, false);
        }
        return { ok: false };
    }

    /**
     * Allocates a wall-clock-backed generation that remains ordered across worker restarts.
     *
     * @returns - Strictly increasing safe integer.
     */
    private nextCommandGeneration(): number {
        const wallClockGeneration = Math.max(0, Math.trunc(this.now()));
        this.commandGeneration = Math.max(
            this.commandGeneration + 1,
            wallClockGeneration,
        );
        return this.commandGeneration;
    }

    /**
     * Produces a stable map key for one exact browser frame.
     *
     * @param tabId - Target tab.
     * @param frameId - Target frame.
     * @returns - Frame state key.
     */
    private frameKey(tabId: number, frameId: number): string {
        return `${String(tabId)}:${String(frameId)}`;
    }

    /**
     * Retains the latest desired frame command within a bounded background cache.
     *
     * @param tabId - Target tab.
     * @param frameId - Target frame.
     * @param command - New desired command.
     */
    private rememberDesiredCommand(
        tabId: number,
        frameId: number,
        command: FacebookBridgeLeaseCommand,
    ): void {
        const key = this.frameKey(tabId, frameId);
        this.desiredCommands.delete(key);
        this.desiredCommands.set(key, command);
        while (this.desiredCommands.size > MAX_RETAINED_FACEBOOK_BRIDGE_FRAMES) {
            const oldest = this.desiredCommands.keys().next().value;
            if (oldest === undefined) {
                break;
            }
            this.desiredCommands.delete(oldest);
        }
    }

    /**
     * Checks whether an asynchronous attempt still represents desired frame state.
     *
     * @param tabId - Target tab.
     * @param frameId - Target frame.
     * @param command - Command captured by the attempt.
     * @returns - Whether no newer request superseded the command.
     */
    private isDesiredCommand(
        tabId: number,
        frameId: number,
        command: FacebookBridgeLeaseCommand,
    ): boolean {
        return this.desiredCommands.get(this.frameKey(tabId, frameId)) === command;
    }

    /**
     * Commands first and installs the bridge only after an exact missing-slot result.
     *
     * @param tabId - Target tab.
     * @param frameId - Exact target frame.
     * @param command - Active or release command.
     * @param observeLate - Whether timed-out browser work should converge afterward.
     * @returns - Whether the target bridge accepted the command.
     */
    private async applyCommand(
        tabId: number,
        frameId: number,
        command: FacebookBridgeLeaseCommand,
        observeLate: boolean,
    ): Promise<boolean> {
        const result = await this.executeCommand(
            tabId,
            frameId,
            command,
            observeLate,
        );
        if (result === FACEBOOK_BRIDGE_COMMAND_RESULT.ACCEPTED) {
            return true;
        }
        if (
            !command.active
            || result !== FACEBOOK_BRIDGE_COMMAND_RESULT.REJECTED
            || !this.isDesiredCommand(tabId, frameId, command)
        ) {
            return false;
        }
        const installed = await this.executeFile(
            tabId,
            frameId,
            observeLate,
        );
        if (!installed || !this.isDesiredCommand(tabId, frameId, command)) {
            return false;
        }
        return await this.executeCommand(
            tabId,
            frameId,
            command,
            observeLate,
        ) === FACEBOOK_BRIDGE_COMMAND_RESULT.ACCEPTED;
    }

    /**
     * Executes one bounded command and observes uncancellable late completion.
     *
     * @param tabId - Target tab.
     * @param frameId - Exact target frame.
     * @param command - Desired lease command.
     * @param observeLate - Whether late completion should trigger convergence.
     * @returns - Exact acceptance, rejection, or browser failure.
     */
    private async executeCommand(
        tabId: number,
        frameId: number,
        command: FacebookBridgeLeaseCommand,
        observeLate: boolean,
    ): Promise<FacebookBridgeCommandResult> {
        let pending: Promise<readonly InjectionResult[]>;
        try {
            pending = this.input.scripting.executeScript({
                target: { tabId, frameIds: [frameId] },
                func: applyFacebookBridgeLeaseCommand,
                args: [FACEBOOK_PAYLOAD_BRIDGE_SLOT_KEY, command] as const,
                world: SCRIPT_EXECUTION_WORLD.MAIN,
            });
        } catch {
            return FACEBOOK_BRIDGE_COMMAND_RESULT.FAILED;
        }
        const applied = await settleBrowserOperation(() => pending);
        if (!applied.ok) {
            if (observeLate) {
                void pending.then(
                    () => this.converge(tabId, frameId),
                    () => undefined,
                );
            }
            return FACEBOOK_BRIDGE_COMMAND_RESULT.FAILED;
        }
        if (hasFrameResult(applied.value, frameId, true)) {
            return FACEBOOK_BRIDGE_COMMAND_RESULT.ACCEPTED;
        }
        return hasFrameResult(applied.value, frameId, false)
            ? FACEBOOK_BRIDGE_COMMAND_RESULT.REJECTED
            : FACEBOOK_BRIDGE_COMMAND_RESULT.FAILED;
    }

    /**
     * Injects the full bridge only after a command proves its slot is absent.
     *
     * @param tabId - Target tab.
     * @param frameId - Exact target frame.
     * @param observeLate - Whether late completion should trigger convergence.
     * @returns - Whether the bundle executed in the exact frame.
     */
    private async executeFile(
        tabId: number,
        frameId: number,
        observeLate: boolean,
    ): Promise<boolean> {
        let pending: Promise<readonly InjectionResult[]>;
        try {
            pending = this.input.scripting.executeScript({
                target: { tabId, frameIds: [frameId] },
                files: [FACEBOOK_PAYLOAD_BRIDGE_SCRIPT_FILE],
                world: SCRIPT_EXECUTION_WORLD.MAIN,
            });
        } catch {
            return false;
        }
        const installed = await settleBrowserOperation(() => pending);
        if (!installed.ok) {
            if (observeLate) {
                void pending.then(
                    () => this.converge(tabId, frameId),
                    () => undefined,
                );
            }
            return false;
        }
        return hasFrameResult(installed.value, frameId);
    }

    /**
     * Reapplies the newest desired command after older browser work settles late.
     *
     * @param tabId - Target tab.
     * @param frameId - Exact target frame.
     * @returns - Promise settled after one best-effort convergence attempt.
     */
    private async converge(tabId: number, frameId: number): Promise<void> {
        const command = this.desiredCommands.get(this.frameKey(tabId, frameId));
        if (!command) {
            return;
        }
        await this.applyCommand(tabId, frameId, command, false);
    }
}
