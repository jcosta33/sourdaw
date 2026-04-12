import { getTransportState } from '../../repositories/transport/getTransportState';
import { updateTransportState } from '../../repositories/transport/updateTransportState';

export function toggleOverdub(): void {
    const state = getTransportState();
    if (!state) {
        return;
    }
    updateTransportState({ overdubEnabled: !state.overdubEnabled });
}
