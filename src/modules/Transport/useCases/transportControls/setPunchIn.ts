import { getTransportState, updateTransportState } from '#/modules/Transport/repositories/transport';

export function setPunchIn(beat: number): void {
    const state = getTransportState();
    if (!state) {
        return;
    }
    updateTransportState({ punchInBeat: Math.max(0, beat) });
}
