import { getTransportState } from '../../repositories/transport/getTransportState';
import { updateTransportState } from '../../repositories/transport/updateTransportState';

export function toggleCountIn(): void {
    const state = getTransportState();
    if (!state) {
        return;
    }
    updateTransportState({ countInEnabled: !state.countInEnabled });
}
