import { setMasterGainValue } from '#/modules/AudioEngine/useCases';

import { getTransportState } from '../repositories/transport/getTransportState';
import { updateTransportState } from '../repositories/transport/updateTransportState';

/**
 * `masterGain` is a 0–100 percentage-like value where 80 is unity gain (see
 * `defaultTransportState.masterGain` and `MasterChannelStrip`'s dB readout).
 * There is no stored upper bound, but every consumer of the field already
 * treats 100 as the ceiling: both `createWebAudioEngine`'s `setMasterGain`
 * (`storeValue / 100`, clamped to `[0, 1]`) and `renderOffline`'s master gain
 * node divide by 100 and clamp to `[0, 1]`. A value above 100 changes nothing
 * audible and only pollutes stored/undo state, so 100 is the contract's real
 * maximum. `NaN` and negative inputs clamp to 0, the field's floor.
 */
const MIN_MASTER_GAIN = 0;
const MAX_MASTER_GAIN = 100;

function clampMasterGain(value: number): number {
    if (!Number.isFinite(value)) {
        return MIN_MASTER_GAIN;
    }
    return Math.min(MAX_MASTER_GAIN, Math.max(MIN_MASTER_GAIN, value));
}

export function setMasterGain(storeValue: number): void {
    const state = getTransportState();
    if (!state) {
        return;
    }
    const clamped = clampMasterGain(storeValue);
    updateTransportState({ masterGain: clamped });
    setMasterGainValue(clamped / 100);
}
