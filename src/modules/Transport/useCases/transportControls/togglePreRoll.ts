import { getTransportState } from '#/modules/Transport/repositories/transport/getTransportState';
import { updateTransportState } from '#/modules/Transport/repositories/transport/updateTransportState';

export function togglePreRoll(): void {
    const state = getTransportState();
    if (!state) {
        return;
    }
    updateTransportState({ preRollEnabled: !state.preRollEnabled });
}
