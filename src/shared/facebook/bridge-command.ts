/**
 * @file Self-contained function injected to control the Facebook main-world bridge.
 */

import type { FacebookBridgeLeaseCommand } from "../messaging/facebook-bridge";

/**
 * Applies one browser-mediated lease command to an installed main-world bridge.
 *
 * This function deliberately has no runtime closure dependencies because Chrome
 * serializes it before main-world execution.
 *
 * @param slotKey - Shared serializable key for the immutable bridge slot.
 * @param command - Background-created lease command.
 * @returns - Whether a compatible installed bridge accepted the command.
 */
export function applyFacebookBridgeLeaseCommand(
    slotKey: string,
    command: FacebookBridgeLeaseCommand,
): boolean {
    const slotSymbol = Symbol.for(slotKey);
    const slot = (window as unknown as Window & Record<symbol, unknown>)[slotSymbol];
    if (slot === null || typeof slot !== "object" || Array.isArray(slot)) {
        return false;
    }
    const descriptor = Object.getOwnPropertyDescriptor(window, slotSymbol);
    if (
        descriptor?.value !== slot
        || descriptor.configurable
        || descriptor.writable
        || !Object.isFrozen(slot)
    ) {
        return false;
    }
    const reconcileLease = (slot as {
        readonly reconcileLease?: (value: FacebookBridgeLeaseCommand) => unknown;
    }).reconcileLease;
    return typeof reconcileLease === "function"
        && reconcileLease(command) === true;
}
