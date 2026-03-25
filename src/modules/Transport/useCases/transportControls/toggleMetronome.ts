import { getTransportState, updateTransportState } from '#/modules/Transport/repositories/transport';

export function toggleMetronome(): void {
    const state = getTransportState();
    if (!state) {
        return;
    }
    updateTransportState({ metronomeEnabled: !state.metronomeEnabled });
}
