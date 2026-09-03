/**
 * @file DOM and transport helpers shared by the popup and options UI tests.
 */

/**
 * Reads the request type of a background message.
 *
 * @param message - Message sent through the transport.
 * @returns - Request type, or undefined when the message has none.
 */
export function messageType(message: unknown): string | undefined {
    return message && typeof message === "object" && "type" in message
        && typeof message.type === "string"
        ? message.type
        : undefined;
}

/**
 * Finds a button by its exact visible label.
 *
 * @param container - Mounted container.
 * @param label - Visible button label.
 * @returns - Matching button, or undefined when none matches.
 */
export function findButton(container: HTMLElement, label: string): HTMLButtonElement | undefined {
    return [...container.querySelectorAll("button")].find(
        (button) => button.textContent === label,
    );
}

/**
 * Finds a switch or checkbox by its accessible name.
 *
 * @param container - Mounted container.
 * @param label - Accessible name of the control.
 * @returns - Matching input, or undefined when none matches.
 */
export function findSwitch(container: HTMLElement, label: string): HTMLInputElement | undefined {
    return container.querySelector<HTMLInputElement>(
        `input[type=checkbox][aria-label="${label}"]`,
    ) ?? undefined;
}

/**
 * Installs the `matchMedia` stub Mantine's color-scheme manager expects in JSDOM.
 */
export function installMatchMedia(): void {
    Object.defineProperty(window, "matchMedia", {
        configurable: true,
        value: () => ({
            matches: false,
            media: "",
            onchange: null,
            addListener: () => undefined,
            removeListener: () => undefined,
            addEventListener: () => undefined,
            removeEventListener: () => undefined,
            dispatchEvent: () => false,
        }),
    });
}
