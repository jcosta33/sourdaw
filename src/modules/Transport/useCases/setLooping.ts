import { getTransportState } from '../repositories/transport/getTransportState';
import { updateTransportState } from '../repositories/transport/updateTransportState';

export function disableLooping(): void {
    const state = getTransportState();
    if (!state) {
        return;
    }
    updateTransportState({ isLooping: false });
}
