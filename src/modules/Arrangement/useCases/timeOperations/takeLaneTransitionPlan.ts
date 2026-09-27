import { type RetiredTakeLaneSnapshot } from '#/utils/handlerContract';

/**
 * The take-lane leg of a time operation's restore plan (#4520).
 *
 * Delete Time and Delete Time Range drop the clips a span fully contains
 * without going through `removeClip`, so nothing retired the takes and comp
 * regions naming them: the orphan region kept advancing the comp cursor, and a
 * clip that landed on the freed span was treated as already comped — silent in
 * playback and in the offline render. The forward routes now retire those
 * takes through `removeTakesForClips`, and this slot is how the operation's own
 * restore plan carries the capture: applying the plan puts the retired lanes
 * back, applying the reversed plan retires them again.
 *
 * `appliedEffect` says which of the two applying the *enclosing* plan performs.
 * Owner slots reverse by swapping their `expected`/`replacement` pair; this
 * slot's two directions are not the same write with different data — one
 * restores the captured lanes, the other retires the clips' takes — so the
 * reversal flips the flag instead (`reverseTakeLaneTransitionPlan`).
 */
export type TakeLaneTransitionPlan = {
    version: 1;
    appliedEffect: 'restore' | 'retire';
    removedClipIds: readonly string[];
    retiredLanes: readonly RetiredTakeLaneSnapshot[];
};
