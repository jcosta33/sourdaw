import { type TakeReKeyLaneTransition } from './takeReKeyTransition';
import { writeTakeReKeyTransitions } from './writeTakeReKeyTransitions';

/**
 * The writing half of the take re-key (#4841): move every captured lane to its
 * post-operation facets. The delete routes call it in the same publish sweep
 * that retires the removed clips' takes (#4520), and the reversed restore plan
 * calls it again as the redo leg — the transitions carry the after state, so
 * the replay reproduces the exact take ids and geometry of the forward run.
 */
export function applyTakeReKeyTransitions(transitions: readonly TakeReKeyLaneTransition[]): void {
    writeTakeReKeyTransitions(transitions, 'apply');
}
