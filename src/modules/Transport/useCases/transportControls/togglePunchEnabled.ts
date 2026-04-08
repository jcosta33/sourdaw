import { inject } from '#/infra/di/inject';
import { getTransportState, updateTransportState } from '#/modules/Transport/repositories/transport';

export const togglePunchEnabled = inject({ getTransportState, updateTransportState })(
    ({ getTransportState, updateTransportState }) =>
        function togglePunchEnabled(): void {
            const state = getTransportState();
            if (!state) {
                return;
            }
            updateTransportState({ punchInEnabled: !state.punchInEnabled });
        }
);
