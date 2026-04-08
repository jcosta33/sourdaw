import { inject } from '#/infra/di/inject';
import { getTransportState, updateTransportState } from '#/modules/Transport/repositories/transport';

export const toggleMetronome = inject({ getTransportState, updateTransportState })(
    ({ getTransportState, updateTransportState }) =>
        function toggleMetronome(): void {
            const state = getTransportState();
            if (!state) {
                return;
            }
            updateTransportState({ metronomeEnabled: !state.metronomeEnabled });
        }
);
