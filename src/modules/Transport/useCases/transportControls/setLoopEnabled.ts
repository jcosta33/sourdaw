import { getTransportState } from '../../repositories/transport/getTransportState';
import { updateTransportState } from '../../repositories/transport/updateTransportState';

import { resolveLoopEnableRegion } from './resolveLoopEnableRegion';

export function setLoopEnabled(enabled: boolean): boolean {
    const state = getTransportState();
    if (!state) {
        return false;
    }
    if (!enabled) {
        updateTransportState({ isLooping: false });
        return true;
    }
    const region = resolveLoopEnableRegion(state);
    if (region) {
        updateTransportState({ ...region, isLooping: true });
        return true;
    }
    if (state.loopEnd <= state.loopStart) {
        return false;
    }
    updateTransportState({ isLooping: true });
    return true;
}
