/**
 * @file Bounds the first state read of a surface so a silent worker cannot keep it loading.
 */

/**
 * Time after which an unanswered state request renders the unavailable view.
 */
export const STATE_LOAD_TIMEOUT_MS = 5_000;

/**
 * Settles with the read's value, or rejects once the deadline passes without an answer.
 *
 * @param read - Pending state read.
 * @param timeoutMs - Deadline for the read.
 * @returns - The read's value, or a rejection when the deadline passed first.
 */
export function readWithDeadline<T>(
    read: Promise<T>,
    timeoutMs: number = STATE_LOAD_TIMEOUT_MS,
): Promise<T> {
    return new Promise((resolve, reject) => {
        const deadline = globalThis.setTimeout(() => {
            reject(new Error("The state request did not settle before its deadline"));
        }, timeoutMs);
        read.then(
            (value) => {
                globalThis.clearTimeout(deadline);
                resolve(value);
            },
            (error: unknown) => {
                globalThis.clearTimeout(deadline);
                reject(error instanceof Error ? error : new Error(String(error)));
            },
        );
    });
}
