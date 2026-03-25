import { transportStore } from '../stores/transportStore';
import { setMasterGainValue } from '#/modules/AudioEngine/useCases/engineAccess';

/**
 * Set the master gain. This updates both the store (for UI reactivity) and the
 * audio engine (for actual gain change). The `storeValue` is 0-100 (fader %).
 */
export function setMasterGain(storeValue: number): void {
    const state = transportStore.value;
    if (!state) {
        return;
    }
    transportStore.set({ ...state, masterGain: storeValue });
    setMasterGainValue(storeValue / 100);
}
