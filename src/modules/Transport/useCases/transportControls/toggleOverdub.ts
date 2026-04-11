import { getTransportState, updateTransportState } from '#/modules/Transport/repositories/transport';

export function toggleOverdub(): void {
    const state = getTransportState();
    if (!state) {
        return;
    }
    updateTransportState({ overdubEnabled: !state.overdubEnabled });
}
