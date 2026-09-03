/**
 * @file Canonical discriminants and the shared dispatch of validated client mutations.
 */

import * as v from "valibot";

/**
 * Result kinds shared by popup and options clients and their consumers.
 */
export const CLIENT_RESULT_KIND = {
    RESPONSE: "response",
    AMBIGUOUS: "ambiguous",
    ERROR: "error",
} as const;

/**
 * Outcome of one settings mutation: a validated response, or the state reread
 * after the response was lost or malformed.
 */
export type MutationResult<TResponse, TState> =
    | {
        /**
         * Indicates that the background returned a validated command response.
         */
        readonly kind: typeof CLIENT_RESULT_KIND.RESPONSE;

        /**
         * Validated result of the command.
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
 * Dispatches one mutation exactly once and rereads state when its response is
 * lost or malformed. The mutation is never retried, because a lost response may
 * follow a committed write.
 *
 * @param send - Sends the mutation and resolves with the raw response.
 * @param schema - Response schema; a response is accepted only when it matches.
 * @param reread - Reads the surface's current state after an ambiguous response.
 * @param accept - Optional narrowing of a valid response, such as a surface check.
 * @returns - Validated response, or an ambiguous outcome with the reread state.
 */
export async function runMutation<TResponse, TState, TAccepted extends TResponse = TResponse>(
    send: () => Promise<unknown>,
    schema: v.GenericSchema<unknown, TResponse>,
    reread: () => Promise<TState>,
    accept?: (response: TResponse) => response is TAccepted,
): Promise<MutationResult<TAccepted, TState>> {
    let response: unknown;
    try {
        response = await send();
    } catch {
        return rereadAfterAmbiguousResponse(reread);
    }
    const parsed = v.safeParse(schema, response);
    if (parsed.success) {
        if (accept === undefined) {
            return { kind: CLIENT_RESULT_KIND.RESPONSE, response: parsed.output as TAccepted };
        }
        if (accept(parsed.output)) {
            return { kind: CLIENT_RESULT_KIND.RESPONSE, response: parsed.output };
        }
    }
    return rereadAfterAmbiguousResponse(reread);
}

/**
 * Reads current state after a mutation response is lost or malformed.
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
