import { transportStore } from '../stores/transportStore';
import { InvalidTempoError } from '../errors/InvalidTempoError';

export function setTempo(bpm: number): void {
    if (bpm < 20 || bpm > 300) {
        throw new InvalidTempoError(bpm);
    }

    const state = transportStore.value;
    if (!state) {
        return;
    }

    transportStore.set({ ...state, tempo: bpm });
}
