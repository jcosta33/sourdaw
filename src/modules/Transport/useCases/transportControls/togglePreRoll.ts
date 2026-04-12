import { getTransportState } from '../../repositories/transport/getTransportState';
import { updateTransportState } from '../../repositories/transport/updateTransportState';

export function togglePreRoll(): void {
    const state = getTransportState();
    if (!state) {
        return;
    }
    updateTransportState({ preRollEnabled: !state.preRollEnabled });
}
