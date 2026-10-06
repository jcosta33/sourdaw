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
 * The source edges come from the original clip and deletion span; the target
 * edges are the emitted fragment's exact geometry. Keep both rather than
 * reconstructing an edge by subtracting and re-adding fractional beat origins.
 */
export type TakeReKeyClipWindow = {
    sourceClipId: string;
    targetClipId: string;
    sourceStartBeat: number;
    sourceEndBeat: number;
    targetStartBeat: number;
    targetEndBeat: number;
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
 *
 * One asymmetry: regions owned by the paired retirement — their take names a
 * clip the operation removes outright — ride `regionsBefore` verbatim but are
 * excluded from `regionsAfter`. The retirement leg owns their removal (#4520),
 * and carrying them on the after side would let a doomed region collide with a
 * survivor's remapped region on the freed span: the lane's first-held region
 * would destroy the other (#4841). On the before side they are the lane's
 * honest pre-operation state, and their presence lets the restore leg put them
 * back once the survivor's region has moved off the span — the retirement's
 * own restore runs while the survivor still occupies it and refuses the
 * overlap. Doomed takes still ride both sides verbatim — takes are keyed by id
 * and carry no span law, so the duplicate is harmless.
 */
export type TakeReKeyLaneTransition = {
    laneId: string;
    trackId: string;
    takesBefore: readonly Take[];
    takesAfter: readonly Take[];
    regionsBefore: readonly CompRegion[];
    regionsAfter: readonly CompRegion[];
};
