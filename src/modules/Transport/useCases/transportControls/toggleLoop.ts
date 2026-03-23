import { getTransportState, updateTransportState } from '#/modules/Transport/repositories/transportRepository';

export function toggleLoop(): void {
    const state = getTransportState();
    if (!state) {
        return;
    }
    updateTransportState({ isLooping: !state.isLooping });
}
