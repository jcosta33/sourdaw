import { setMasterGainValue } from '#/modules/AudioEngine/useCases';

import { getTransportState } from '../repositories/transport/getTransportState';
import { updateTransportState } from '../repositories/transport/updateTransportState';
import { MAX_MASTER_GAIN } from '../stores/transportStore';

/**
 * `masterGain` is a 0–100 percentage-like value where 80 is unity gain (see
 * `defaultTransportState.masterGain` and `MasterChannelStrip`'s dB readout).
 * `MAX_MASTER_GAIN` (shared with `transportStore`'s hydration validator) is
 * the ceiling because every consumer of the field already treats 100 as one:
 * both `createWebAudioEngine`'s `setMasterGain` (`storeValue / 100`, clamped
 * to `[0, 1]`) and `renderOffline`'s master gain node divide by 100 and clamp
 * to `[0, 1]`. A value above 100 changes nothing audible and only pollutes
 * stored/undo state. `NaN` and negative inputs clamp to 0, the field's floor.
 */
const MIN_MASTER_GAIN = 0;

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
