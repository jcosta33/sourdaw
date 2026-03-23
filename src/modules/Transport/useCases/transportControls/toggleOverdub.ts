import { getTransportState, updateTransportState } from '#/modules/Transport/repositories/transportRepository';

export function toggleOverdub(): void {
    const state = getTransportState();
    if (!state) {
        return;
    }
    updateTransportState({ overdubEnabled: !state.overdubEnabled });
}
