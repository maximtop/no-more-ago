/**
 * @file Canonical discriminants and the shared dispatch of client mutations.
 */

/**
 * Result kinds shared by popup and options clients and their consumers.
 */
export const CLIENT_RESULT_KIND = {
    RESPONSE: "response",
    AMBIGUOUS: "ambiguous",
    ERROR: "error",
} as const;

/**
 * Outcome of one settings mutation: the background response, or the state
 * reread after that response was lost.
 */
export type MutationResult<TResponse, TState> =
    | {
        /**
         * Indicates that the background answered the command.
         */
        readonly kind: typeof CLIENT_RESULT_KIND.RESPONSE;

        /**
         * Result of the command as the background reported it.
         */
        readonly response: TResponse;
    }
    | {
        /**
         * Indicates that command completion could not be determined directly.
         */
        readonly kind: typeof CLIENT_RESULT_KIND.AMBIGUOUS;

        /**
         * State reread after the ambiguous command, when the reread succeeded.
         */
        readonly state?: TState;
    };

/**
 * Dispatches one mutation exactly once and rereads state when no usable response
 * arrives. The mutation is never retried, because a lost response may follow a
 * committed write. The background produces the response, so its shape is the
 * contract both sides compile against; only its presence and, where a command
 * is answered per surface, its surface discriminant are read.
 *
 * @param send - Sends the mutation and resolves with the background response.
 * @param reread - Reads the surface's current state after a lost response.
 * @param accept - Optional discriminant check selecting this surface's response.
 * @returns - The background response, or an ambiguous outcome with the reread state.
 */
export async function runMutation<TResponse, TState, TAccepted extends TResponse = TResponse>(
    send: () => Promise<unknown>,
    reread: () => Promise<TState>,
    accept?: (response: TResponse) => response is TAccepted,
): Promise<MutationResult<TAccepted, TState>> {
    let response: unknown;
    try {
        response = await send();
    } catch {
        return rereadAfterAmbiguousResponse(reread);
    }
    const result = response as TResponse | undefined;
    if (result === undefined) {
        return rereadAfterAmbiguousResponse(reread);
    }
    if (accept === undefined) {
        return { kind: CLIENT_RESULT_KIND.RESPONSE, response: result as TAccepted };
    }
    return accept(result)
        ? { kind: CLIENT_RESULT_KIND.RESPONSE, response: result }
        : rereadAfterAmbiguousResponse(reread);
}

/**
 * Reads current state after a mutation response is lost.
 *
 * @param reread - Reads the surface's current state.
 * @returns - An ambiguous result carrying the state when the reread succeeds.
 */
async function rereadAfterAmbiguousResponse<TResponse, TState>(
    reread: () => Promise<TState>,
): Promise<MutationResult<TResponse, TState>> {
    try {
        return { kind: CLIENT_RESULT_KIND.AMBIGUOUS, state: await reread() };
    } catch {
        return { kind: CLIENT_RESULT_KIND.AMBIGUOUS };
    }
}
