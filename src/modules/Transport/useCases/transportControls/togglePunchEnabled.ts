import { getTransportState } from '../../repositories/transport/getTransportState';
import { updateTransportState } from '../../repositories/transport/updateTransportState';

export function togglePunchEnabled(): void {
    const state = getTransportState();
    if (!state) {
        return;
    }
    updateTransportState({ punchInEnabled: !state.punchInEnabled });
}
