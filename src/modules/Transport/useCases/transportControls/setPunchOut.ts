import { inject } from '#/infra/di/inject';
import { getTransportState, updateTransportState } from '#/modules/Transport/repositories/transport';

export const setPunchOut = inject({ getTransportState, updateTransportState })(
    ({ getTransportState, updateTransportState }) =>
        function setPunchOut(beat: number): void {
            const state = getTransportState();
            if (!state) {
                return;
            }
            updateTransportState({ punchOutBeat: Math.max(0, beat) });
        }
);
