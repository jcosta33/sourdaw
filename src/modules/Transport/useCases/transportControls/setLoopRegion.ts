import { getTransportState, updateTransportState } from '#/modules/Transport/repositories/transport';

export function setLoopRegion(startBeat: number, endBeat: number): void {
    const state = getTransportState();
    if (!state) {
        return;
    }
    updateTransportState({ loopStart: startBeat, loopEnd: endBeat, isLooping: true });
}
