import { inject } from '#/infra/di/inject';
import { getTransportState, updateTransportState } from '../repositories/transport';
import { createInvalidTempoError } from '../errors/InvalidTempoError';

export const setTempo = inject({ getTransportState, updateTransportState })(
    ({ getTransportState, updateTransportState }) =>
        function setTempo(bpm: number): void {
            if (bpm < 20 || bpm > 300) {
                throw createInvalidTempoError(bpm);
            }

            const state = getTransportState();
            if (!state) {
                return;
            }

            updateTransportState({ tempo: bpm });
        }
);
