import { getTransportState } from '../../repositories/transport/getTransportState';
import { updateTransportState } from '../../repositories/transport/updateTransportState';

export function setLoopRegion(startBeat: number, endBeat: number): void {
    const state = getTransportState();
    if (!state) {
        return;
    }
    updateTransportState({ loopStart: startBeat, loopEnd: endBeat, isLooping: true });
}
