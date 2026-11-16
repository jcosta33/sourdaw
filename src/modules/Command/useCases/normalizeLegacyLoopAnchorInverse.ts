import { type AppAction, type AppActionType } from '#/utils/handlerContract';

import { type ActionOf, legacyLoopAnchorInverseByActionType } from './legacyLoopAnchorInverseByActionType';

function lookup<Type extends AppActionType>(action: ActionOf<Type>): AppAction {
    if (!Object.hasOwn(legacyLoopAnchorInverseByActionType, action.type)) {
        return action;
    }
    return legacyLoopAnchorInverseByActionType[action.type](action);
}

/**
 * The undo seam's normalization for recorded inverses that predate the loop
 * anchor (#5198). New entries always carry `loopOriginBeat` at capture time —
 * a value or `null` — so a payload decoded WITHOUT the field can only be a
 * legacy entry, and its pre-action clip was anchorless by construction: the
 * field did not exist yet. Replayed as-is, the trim and loop handlers fall
 * back to their fresh-action mint laws and mint an anchor the pre-action
 * state never carried — silencing restored material and refusing deeper
 * legacy whole-track restores, whose anchorless snapshots then conflict
 * against the minted key.
 *
 * The seam therefore rewrites keyless legacy `trimClipStart` and
 * `restoreClipLoop` payloads to the explicit anchorless-restoration form
 * (`loopOriginBeat: null`) before dispatch. Entries that carry the field pass
 * through untouched, and fresh user actions never pass through this seam at
 * all — they dispatch directly — so every mint law keeps its exact
 * fresh-action behavior. `restoreClipLoop`'s `expected` snapshot is left
 * alone: the compare-and-swap guard reads only presence and enabled, and a
 * legacy expected snapshot must not conflict with a live anchor a later edit
 * minted.
 *
 * Keyless legacy `slipClipContent` payloads normalize the same way: a slip
 * inverse recorded before `rowLiftBeats` existed is a restoration, and the
 * pre-anchor slip undo restored the captured offset verbatim, moving no rows
 * and never wrapping. Replayed keyless, the handler cannot tell the inverse
 * from a fresh dispatch and applies the forward wrap law — re-wrapping a
 * captured figure that is not a phase of the live loop config and shifting
 * rows its capture never lifted. The seam keys the legacy payload to the
 * same verbatim restoration the field now always records (`rowLiftBeats: 0`
 * — zero included, never an explicit-undefined key); the field is midi-only,
 * and an audio slip's replay path reads it not at all.
 */
export function normalizeLegacyLoopAnchorInverse(action: AppAction): AppAction {
    return lookup(action);
}
