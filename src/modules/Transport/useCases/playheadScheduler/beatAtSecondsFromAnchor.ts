import { beatAtSecondsFromAnchor as integrateFromAnchor, type TempoChange } from '../../models/TempoMap';

/** The beat the tempo map assigns `elapsedSeconds` after `anchorBeat` (see the model's integrator). */
export function beatAtSecondsFromAnchor(
    changes: readonly TempoChange[],
    anchorBeat: number,
    elapsedSeconds: number,
    defaultTempo: number
): number {
    return integrateFromAnchor(changes, anchorBeat, elapsedSeconds, defaultTempo);
}
