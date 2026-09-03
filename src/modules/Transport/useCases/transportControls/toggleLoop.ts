import { getTransportState } from '../../repositories/transport/getTransportState';
import { updateTransportState } from '../../repositories/transport/updateTransportState';

export function toggleLoop(): void {
    const state = getTransportState();
    if (!state) {
        return;
    }
    updateTransportState({ isLooping: !state.isLooping });
}
