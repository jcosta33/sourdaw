import { type TempoMapResult } from '../../../models/TempoMappingTypes';
import { MIN_TEMPO, MAX_TEMPO } from '../../../stores/transportStore';

/** Bounds mirror `transportStore`'s own tempo validator, so a detected tempo can
 * never write a value that CRDT hydration would immediately reject and reset. */
function clampToTransportTempoRange(bpm: number): number {
    return Math.min(MAX_TEMPO, Math.max(MIN_TEMPO, bpm));
}

export function normalizeDetectedTempo(result: TempoMapResult, transportAvailable: boolean): number | null {
    if (!transportAvailable || result.averageBpm <= 0) {
        return null;
    }

    return clampToTransportTempoRange(Math.round(result.averageBpm));
}
