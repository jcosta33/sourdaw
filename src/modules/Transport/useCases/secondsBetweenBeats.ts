import { secondsBetweenBeats as integrateTempoMap } from '../models/TempoMap';

import type { TempoChange } from '../stores/tempoMapStore';

/** Public Transport contract for integrating timeline beats through tempo changes and ramps. */
export function secondsBetweenBeats(
    changes: readonly TempoChange[],
    fromBeat: number,
    toBeat: number,
    defaultTempo: number
): number {
    return integrateTempoMap(changes, fromBeat, toBeat, defaultTempo);
}
