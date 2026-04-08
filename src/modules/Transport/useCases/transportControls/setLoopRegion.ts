import { inject } from '#/infra/di/inject';
import { getTransportState, updateTransportState } from '#/modules/Transport/repositories/transport';

export const setLoopRegion = inject({ getTransportState, updateTransportState })(
    ({ getTransportState, updateTransportState }) =>
        function setLoopRegion(startBeat: number, endBeat: number): void {
            const state = getTransportState();
            if (!state) {
                return;
            }
            updateTransportState({ loopStart: startBeat, loopEnd: endBeat, isLooping: true });
        }
);
