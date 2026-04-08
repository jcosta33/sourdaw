import { inject } from '#/infra/di/inject';
import { getTransportState, updateTransportState } from '#/modules/Transport/repositories/transport';

export const toggleOverdub = inject({ getTransportState, updateTransportState })(
    ({ getTransportState, updateTransportState }) =>
        function toggleOverdub(): void {
            const state = getTransportState();
            if (!state) {
                return;
            }
            updateTransportState({ overdubEnabled: !state.overdubEnabled });
        }
);
