import { getTransportState } from '#/modules/Transport/repositories/transport/getTransportState';
import { updateTransportState } from '#/modules/Transport/repositories/transport/updateTransportState';

export function setPunchOut(beat: number): void {
    const state = getTransportState();
    if (!state) {
        return;
    }
    updateTransportState({ punchOutBeat: Math.max(0, beat) });
}
