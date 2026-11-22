/**
 * Full-left to full-right on the track's own `pan` field. The automation lane is
 * normalised instead, so the two are not interchangeable — see `setTrackPan`.
 */
export const PAN_FIELD_FULL_SCALE = 50;

/**
 * The pan a request for `pan` actually becomes.
 *
 * `setTrackPan` writes through here and `handleSetTrackPan` and the batch
 * projection predict through here, so an inverse's `expectedPan` always equals
 * the stored value; an unclamped request there makes undo conflict forever.
 */
export function clampTrackPan(pan: number): number {
    return Math.max(-PAN_FIELD_FULL_SCALE, Math.min(PAN_FIELD_FULL_SCALE, pan));
}
