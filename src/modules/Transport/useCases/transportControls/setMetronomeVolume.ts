import { getTransportState, updateTransportState } from '#/modules/Transport/repositories/transportRepository';

export function setMetronomeVolume(volume: number): void {
    const state = getTransportState();
    if (!state) {
        return;
    }
    updateTransportState({ metronomeVolume: Math.max(0, Math.min(1, volume)) });
}
