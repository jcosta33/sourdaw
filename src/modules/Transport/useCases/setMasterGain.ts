import { setMasterGainValue } from '#/modules/AudioEngine/useCases';

import { getTransportState } from '../repositories/transport/getTransportState';
import { updateTransportState } from '../repositories/transport/updateTransportState';
import { MAX_MASTER_GAIN } from '../stores/transportStore';

/**
 * `masterGain` is a 0–100 scale where 100 is true unity gain (linear 1.0,
 * 0 dBFS) — every consumer of the field divides by 100 before it reaches an
 * audio node: `createWebAudioEngine`'s `setMasterGain` (`storeValue / 100`)
 * and `renderOffline`'s master gain node both do. `defaultTransportState`
 * seeds `80`, which is a little under unity (≈ −1.9 dB), matching the track
 * fader's own `0.8` default.
 *
 * `MAX_MASTER_GAIN` (shared with `transportStore`'s hydration validator) is
 * the ceiling, and it is not 100: it is `100 * FADER_MAX_GAIN`, the same
 * `+6 dB` headroom the track fader allows, expressed on this field's 0–100
 * scale — a value above it changes nothing audible (both the store and the
 * engine clamp there independently) and only pollutes stored/undo state.
 * `NaN` and negative inputs clamp to 0, the field's floor.
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
