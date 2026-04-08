import { inject } from '#/infra/di/inject';
import { getTransportState, updateTransportState } from '#/modules/Transport/repositories/transport';

export const setCountInBars = inject({ getTransportState, updateTransportState })(
    ({ getTransportState, updateTransportState }) =>
        function setCountInBars(bars: number): void {
            const state = getTransportState();
            if (!state) {
                return;
            }
            updateTransportState({ countInBars: Math.max(1, Math.min(8, bars)) });
        }
);
