import { getTransportState } from '../../repositories/transport/getTransportState';
import { updateTransportState } from '../../repositories/transport/updateTransportState';

export function toggleMetronome(): void {
    const state = getTransportState();
    if (!state) {
        return;
    }
    updateTransportState({ metronomeEnabled: !state.metronomeEnabled });
}
