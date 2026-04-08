import { inject } from '#/infra/di/inject';
import { getTransportState, updateTransportState } from '#/modules/Transport/repositories/transport';

export const setMetronomeVolume = inject({ getTransportState, updateTransportState })(
    ({ getTransportState, updateTransportState }) =>
        function setMetronomeVolume(volume: number): void {
            const state = getTransportState();
            if (!state) {
                return;
            }
            updateTransportState({ metronomeVolume: Math.max(0, Math.min(1, volume)) });
        }
);
