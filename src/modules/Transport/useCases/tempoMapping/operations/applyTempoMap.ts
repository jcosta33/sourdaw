import { type TempoMapResult } from '../../../models/TempoMappingTypes';
import { getTransportState } from '../../../repositories/transport/getTransportState';
import { updateTransportState } from '../../../repositories/transport/updateTransportState';
import { MIN_TEMPO, MAX_TEMPO } from '../../../stores/transportStore';

/** Bounds mirror `transportStore`'s own tempo validator, so a detected tempo can
 * never write a value that CRDT hydration would immediately reject and reset. */
function clampToTransportTempoRange(bpm: number): number {
    return Math.min(MAX_TEMPO, Math.max(MIN_TEMPO, bpm));
}

export function applyTempoMap(result: TempoMapResult): void {
    const state = getTransportState();
    if (!state) {
        return;
    }

    if (result.averageBpm > 0) {
        updateTransportState({ tempo: clampToTransportTempoRange(Math.round(result.averageBpm)) });
    }
}
