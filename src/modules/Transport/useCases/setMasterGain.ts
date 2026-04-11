import { getTransportState } from '../repositories/transport/getTransportState';
import { updateTransportState } from '../repositories/transport/updateTransportState';
import { setMasterGainValue } from '#/modules/AudioEngine/useCases';

export function setMasterGain(storeValue: number): void {
    const state = getTransportState();
    if (!state) {
        return;
    }
    updateTransportState({ masterGain: storeValue });
    setMasterGainValue(storeValue / 100);
}
