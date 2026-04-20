import { setMasterGainValue } from '#/modules/AudioEngine/useCases';

import { getTransportState } from '../repositories/transport/getTransportState';
import { updateTransportState } from '../repositories/transport/updateTransportState';

export function setMasterGain(storeValue: number): void {
    const state = getTransportState();
    if (!state) {
        return;
    }
    updateTransportState({ masterGain: storeValue });
    setMasterGainValue(storeValue / 100);
}
