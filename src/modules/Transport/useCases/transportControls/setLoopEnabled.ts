import { getTransportState } from '../../repositories/transport/getTransportState';
import { updateTransportState } from '../../repositories/transport/updateTransportState';

import { sendLoopRegionToNativeSession } from './sendLoopRegionToNativeSession';

export function setLoopEnabled(enabled: boolean): boolean {
    const state = getTransportState();
    if (!state) {
        return false;
    }
    if (enabled && state.loopEnd <= state.loopStart) {
        return false;
    }
    updateTransportState({ isLooping: enabled });
    sendLoopRegionToNativeSession();
    return true;
}
