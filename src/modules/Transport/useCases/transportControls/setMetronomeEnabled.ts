import { getTransportState } from '../../repositories/transport/getTransportState';
import { updateTransportState } from '../../repositories/transport/updateTransportState';

export function setMetronomeEnabled(enabled: boolean): void {
    const state = getTransportState();
    if (!state) {
        return;
    }
    updateTransportState({ metronomeEnabled: enabled });
}
