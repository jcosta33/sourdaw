import { getTransportState, updateTransportState } from '../repositories/transport';
import { InvalidTempoError } from '../errors/InvalidTempoError';

export function setTempo(bpm: number): void {
    if (bpm < 20 || bpm > 300) {
        throw new InvalidTempoError(bpm);
    }

    const state = getTransportState();
    if (!state) {
        return;
    }

    updateTransportState({ tempo: bpm });
}
