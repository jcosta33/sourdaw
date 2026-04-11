import { getTransportState, updateTransportState } from '../repositories/transport';

export function disableLooping(): void {
    const state = getTransportState();
    if (!state) {
        return;
    }
    updateTransportState({ isLooping: false });
}
