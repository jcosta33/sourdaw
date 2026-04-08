import { inject } from '#/infra/di/inject';
import { getTransportState, updateTransportState } from '#/modules/Transport/repositories/transport';

export const setPunchIn = inject({ getTransportState, updateTransportState })(
    ({ getTransportState, updateTransportState }) =>
        function setPunchIn(beat: number): void {
            const state = getTransportState();
            if (!state) {
                return;
            }
            updateTransportState({ punchInBeat: Math.max(0, beat) });
        }
);
