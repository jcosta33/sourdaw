import { inject } from '#/infra/di/inject';
import { getTransportState, updateTransportState } from '#/modules/Transport/repositories/transport';

export const setPreRollBars = inject({ getTransportState, updateTransportState })(
    ({ getTransportState, updateTransportState }) =>
        function setPreRollBars(bars: number): void {
            const state = getTransportState();
            if (!state) {
                return;
            }
            updateTransportState({ preRollBars: Math.max(1, Math.min(8, bars)) });
        }
);
