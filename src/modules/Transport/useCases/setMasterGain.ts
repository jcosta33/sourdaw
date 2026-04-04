import { getTransportState, updateTransportState } from '../repositories/transport';
import { setMasterGainValue } from '#/modules/AudioEngine/useCases/engineAccess';

/**
 * Set the master gain. This updates both the store (for UI reactivity) and the
 * audio engine (for actual gain change). The `storeValue` is 0-100 (fader %).
 */
export function setMasterGain(storeValue: number): void {
    const state = getTransportState();
    if (!state) {
        return;
    }
    updateTransportState({ masterGain: storeValue });
    setMasterGainValue(storeValue / 100);
}
