import { getTransportState, updateTransportState } from '#/modules/Transport/repositories/transport';

export function setPunchOut(beat: number): void {
    const state = getTransportState();
    if (!state) {
        return;
    }
    updateTransportState({ punchOutBeat: Math.max(0, beat) });
}
