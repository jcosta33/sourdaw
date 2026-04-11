import { getTransportState } from '#/modules/Transport/repositories/transport/getTransportState';
import { updateTransportState } from '#/modules/Transport/repositories/transport/updateTransportState';

export function setPunchIn(beat: number): void {
    const state = getTransportState();
    if (!state) {
        return;
    }
    updateTransportState({ punchInBeat: Math.max(0, beat) });
}
