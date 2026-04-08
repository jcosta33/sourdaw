import { inject } from '#/infra/di/inject';
import { getTransportState, updateTransportState } from '#/modules/Transport/repositories/transport';

export const toggleCountIn = inject({ getTransportState, updateTransportState })(
    ({ getTransportState, updateTransportState }) =>
        function toggleCountIn(): void {
            const state = getTransportState();
            if (!state) {
                return;
            }
            updateTransportState({ countInEnabled: !state.countInEnabled });
        }
);
