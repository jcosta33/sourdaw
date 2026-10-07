import { type TakeReKeyLaneTransition } from './takeReKeyTransition';
import { writeTakeReKeyTransitions } from './writeTakeReKeyTransitions';

/**
 * Undo half of the take re-key (#4841): put every captured lane's pre-operation
 * facets back. Runs only after the clips are back on their tracks (the
 * arrangement leg of the same undo), so a take the transition re-keys onto a
 * restored clip id has its material to resolve against; takes whose clips stay
 * gone are skipped by the liveness rule instead of being resurrected as
 * orphans.
 */
export function restoreTakeReKeyTransitions(transitions: readonly TakeReKeyLaneTransition[]): void {
    writeTakeReKeyTransitions(transitions, 'restore');
}
