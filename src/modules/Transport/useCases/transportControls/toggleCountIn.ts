import { getTransportState, updateTransportState } from '#/modules/Transport/repositories/transportRepository';

export function toggleCountIn(): void {
    const state = getTransportState();
    if (!state) {
        return;
    }
    updateTransportState({ countInEnabled: !state.countInEnabled });
}
