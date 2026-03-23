import { getTransportState, updateTransportState } from '#/modules/Transport/repositories/transportRepository';

export function togglePreRoll(): void {
    const state = getTransportState();
    if (!state) {
        return;
    }
    updateTransportState({ preRollEnabled: !state.preRollEnabled });
}
