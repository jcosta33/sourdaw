import { type AppAction } from '#/utils/handlerContract';

type QuantizeTransientsPayload = Extract<AppAction, { type: 'quantizeTransients' }>['payload'];

/**
 * What a transient quantize did, read from its own materialized arguments: each onset it cut and
 * moved (from the beat it was heard on to the grid beat it now plays on) and each onset it left
 * uncut. A command that was never planned has no outcome.
 */
export function readTransientQuantizeOutcome(payload: QuantizeTransientsPayload) {
    const { plan } = payload;
    if (plan === undefined) {
        return null;
    }
    return { clipId: payload.clipId, moves: plan.moves, skipped: plan.skipped };
}
