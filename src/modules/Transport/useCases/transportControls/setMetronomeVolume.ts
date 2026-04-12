import { getTransportState } from '../../repositories/transport/getTransportState';
import { updateTransportState } from '../../repositories/transport/updateTransportState';

export function setMetronomeVolume(volume: number): void {
    const state = getTransportState();
    if (!state) {
        return;
    }
    updateTransportState({ metronomeVolume: Math.max(0, Math.min(1, volume)) });
}
