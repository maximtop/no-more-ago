/**
 * @file Bounds browser operations that may reject, throw, or never settle.
 */

/**
 * Maximum time one browser operation may delay an application response.
 */
export const BROWSER_OPERATION_TIMEOUT_MS = 1_000;

/**
 * Successful bounded operation result.
 */
interface SettledSuccess<T> {
    /**
     * Success discriminant.
     */
    readonly ok: true;

    /**
     * Value returned by the browser operation.
     */
    readonly value: T;
}

/**
 * Failed or timed-out bounded operation result.
 */
interface SettledFailure {
    /**
     * Failure discriminant.
     */
    readonly ok: false;
}

/**
 * Result of a browser operation bounded by a deadline.
 */
export type SettledOperation<T> = SettledSuccess<T> | SettledFailure;

/**
 * Settles a browser operation without rejecting its caller.
 *
 * @param operation - Operation to invoke and settle.
 * @returns - Tagged success or failure result.
 */
function settle<T>(operation: () => Promise<T>): Promise<SettledOperation<T>> {
    try {
        return Promise.resolve(operation()).then(
            (value) => ({ ok: true, value } as const),
            () => ({ ok: false } as const),
        );
    } catch {
        return Promise.resolve({ ok: false } as const);
    }
}

/**
 * Settles a browser operation within the shared application deadline.
 *
 * The deadline bounds waiting only. Callers must still make the underlying operation
 * idempotent because browser APIs do not provide cancellation.
 *
 * @param operation - Operation to invoke and settle.
 * @returns - Tagged success or failure result.
 */
export async function settleBrowserOperation<T>(
    operation: () => Promise<T>,
): Promise<SettledOperation<T>> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<SettledFailure>((resolve) => {
        timeout = setTimeout(() => {
            resolve({ ok: false });
        }, BROWSER_OPERATION_TIMEOUT_MS);
    });
    try {
        return await Promise.race([settle(operation), deadline]);
    } finally {
        if (timeout !== undefined) {
            clearTimeout(timeout);
        }
    }
}
