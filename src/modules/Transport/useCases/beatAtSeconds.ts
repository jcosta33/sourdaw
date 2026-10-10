import { samplesToBeat } from '../models/TempoMap';

import type { TempoChange } from '../stores/tempoMapStore';

/** Pure inverse of song time for a captured tempo-map and base-tempo snapshot. */
export function beatAtSeconds(changes: readonly TempoChange[], seconds: number, defaultTempo: number): number {
    return samplesToBeat(changes, seconds, defaultTempo, 1);
}
