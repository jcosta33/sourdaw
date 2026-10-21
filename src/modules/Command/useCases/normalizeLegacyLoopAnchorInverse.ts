import { type AppAction } from '#/utils/handlerContract';

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
 */
export function normalizeLegacyLoopAnchorInverse(action: AppAction): AppAction {
    if (action.type === 'trimClipStart' && !Object.hasOwn(action.payload, 'loopOriginBeat')) {
        return { ...action, payload: { ...action.payload, loopOriginBeat: null } };
    }
    if (action.type === 'restoreClipLoop' && !Object.hasOwn(action.payload.replacement, 'loopOriginBeat')) {
        return {
            ...action,
            payload: {
                ...action.payload,
                replacement: { ...action.payload.replacement, loopOriginBeat: null },
            },
        };
    }
    return action;
}
