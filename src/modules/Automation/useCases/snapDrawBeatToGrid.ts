/**
 * Snap a beat to the nearest grid position.
 *
 * A non-positive or non-finite grid resolution has no snap interval. Returning
 * the raw beat avoids `NaN`/`Infinity` poisoning the painted automation point.
 */
export function snapDrawBeatToGrid(beat: number, gridResolution: number): number {
    if (!(gridResolution > 0) || !Number.isFinite(gridResolution)) {
        return beat;
    }

    return Math.round(beat / gridResolution) * gridResolution;
}
