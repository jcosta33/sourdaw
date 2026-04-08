import { inject } from '#/infra/di/inject';
import { getTransportState, updateTransportState } from '#/modules/Transport/repositories/transport';

export const toggleLoop = inject({ getTransportState, updateTransportState })(
    ({ getTransportState, updateTransportState }) =>
        function toggleLoop(): void {
            const state = getTransportState();
            if (!state) {
                return;
            }
            updateTransportState({ isLooping: !state.isLooping });
        }
);
