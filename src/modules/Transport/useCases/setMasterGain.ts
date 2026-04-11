import { getTransportState, updateTransportState } from '../repositories/transport';
import { setMasterGainValue } from '#/modules/AudioEngine/useCases';

export function setMasterGain(storeValue: number): void {
    const state = getTransportState();
    if (!state) {
        return;
    }
    updateTransportState({ masterGain: storeValue });
    setMasterGainValue(storeValue / 100);
}
