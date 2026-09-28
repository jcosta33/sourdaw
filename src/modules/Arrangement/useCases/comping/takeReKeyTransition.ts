import { type CompRegion, type Take } from '../../models/TakeLane';

/**
 * The minimal clip geometry the take re-key derivation reads. Both delete
 * routes hand over plain `{id, startBeat, endBeat}` views of their clips, so
 * the comping module never imports the track model.
 */
export type TakeReKeyClipGeometry = {
    id: string;
    startBeat: number;
    endBeat: number;
};

/**
 * One surviving fragment of a clip a delete-time operation cut: the window of
 * the clip's pre-delete timeline span the fragment carries, and where that
 * window lands on the post-delete timeline under `targetClipId`.
 *
 * `sourceEndBeat - sourceStartBeat` always equals the fragment's post-delete
 * length; `targetStartBeat - sourceStartBeat` is the shift applied to every
 * beat inside the window (0 for the left half of a split, `-duration` for
 * material the ripple pulls left, and 0 again for the excise route's right
 * fragment, which stays at `endBeat`).
 */
export type TakeReKeyClipWindow = {
    sourceClipId: string;
    targetClipId: string;
    sourceStartBeat: number;
    sourceEndBeat: number;
    targetStartBeat: number;
};

/**
 * The take-lane facet change one lane undergoes when a delete-time operation
 * re-keys, splits, trims, or shifts the clips its takes are keyed to (#4841).
 * Both facet arrays are whole-facet captures — the lane's takes and comp
 * regions exactly as they stood before the operation and as the operation
 * leaves them — so the undo/redo legs reconcile by diffing the two sides
 * instead of re-deriving geometry, and the take ids a split minted stay stable
 * across the round trip. Takes the operation did not touch (including takes
 * the paired retirement removes) appear identically on both sides, so the
 * reconcile never moves them.
 */
export type TakeReKeyLaneTransition = {
    laneIndex: number;
    laneId: string;
    trackId: string;
    takesBefore: readonly Take[];
    takesAfter: readonly Take[];
    regionsBefore: readonly CompRegion[];
    regionsAfter: readonly CompRegion[];
};
