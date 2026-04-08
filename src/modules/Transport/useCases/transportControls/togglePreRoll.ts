import { inject } from '#/infra/di/inject';
import { getTransportState, updateTransportState } from '#/modules/Transport/repositories/transport';

export const togglePreRoll = inject({ getTransportState, updateTransportState })(
    ({ getTransportState, updateTransportState }) =>
        function togglePreRoll(): void {
            const state = getTransportState();
            if (!state) {
                return;
            }
            updateTransportState({ preRollEnabled: !state.preRollEnabled });
        }
);
