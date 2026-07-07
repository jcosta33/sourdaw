import { type TempoMapResult } from '../../../models/TempoMappingTypes';
import { getTransportState } from '../../../repositories/transport/getTransportState';
import { updateTransportState } from '../../../repositories/transport/updateTransportState';

export function applyTempoMap(result: TempoMapResult): void {
    const state = getTransportState();
    if (!state) {
        return;
    }

    if (result.averageBpm > 0) {
        updateTransportState({ tempo: Math.round(result.averageBpm) });
    }
}
