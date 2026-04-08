import { inject } from '#/infra/di/inject';
import { getTransportState, updateTransportState } from '../repositories/transport';

export const disableLooping = inject({ getTransportState, updateTransportState })(
    ({ getTransportState, updateTransportState }) =>
        function disableLooping(): void {
            const state = getTransportState();
            if (!state) {
                return;
            }
            updateTransportState({ isLooping: false });
        }
);
