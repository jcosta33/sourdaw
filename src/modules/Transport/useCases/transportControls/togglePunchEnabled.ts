import { getTransportState } from '#/modules/Transport/repositories/transport/getTransportState';
import { updateTransportState } from '#/modules/Transport/repositories/transport/updateTransportState';

export function togglePunchEnabled(): void {
    const state = getTransportState();
    if (!state) {
        return;
    }
    updateTransportState({ punchInEnabled: !state.punchInEnabled });
}
