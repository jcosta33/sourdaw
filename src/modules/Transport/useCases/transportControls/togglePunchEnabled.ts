import { getTransportState, updateTransportState } from '#/modules/Transport/repositories/transport';

export function togglePunchEnabled(): void {
    const state = getTransportState();
    if (!state) {
        return;
    }
    updateTransportState({ punchInEnabled: !state.punchInEnabled });
}
