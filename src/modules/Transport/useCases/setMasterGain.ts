import { inject } from '#/infra/di/inject';
import { getTransportState, updateTransportState } from '../repositories/transport';
import { setMasterGainValue } from '#/modules/AudioEngine';

/**
 * Set the master gain. This updates both the store (for UI reactivity) and the
 * audio engine (for actual gain change). The `storeValue` is 0-100 (fader %).
 */
export const setMasterGain = inject({ getTransportState, updateTransportState })(
    ({ getTransportState, updateTransportState }) =>
        function setMasterGain(storeValue: number): void {
            const state = getTransportState();
            if (!state) {
                return;
            }
            updateTransportState({ masterGain: storeValue });
            setMasterGainValue(storeValue / 100);
        }
);
