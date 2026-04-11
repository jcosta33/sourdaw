import { getTransportState } from '../repositories/transport/getTransportState';
import { updateTransportState } from '../repositories/transport/updateTransportState';
import { createInvalidTempoError } from '../errors/InvalidTempoError';

export function setTempo(bpm: number): void {
    if (bpm < 20 || bpm > 300) {
        throw createInvalidTempoError(bpm);
    }

    const state = getTransportState();
    if (!state) {
        return;
    }

    updateTransportState({ tempo: bpm });
}
