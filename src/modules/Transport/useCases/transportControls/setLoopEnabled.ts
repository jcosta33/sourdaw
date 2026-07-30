import { getTransportState } from '../../repositories/transport/getTransportState';
import { updateTransportState } from '../../repositories/transport/updateTransportState';

export function setLoopEnabled(enabled: boolean): boolean {
    const state = getTransportState();
    if (!state) {
        return false;
    }
    if (enabled && state.loopEnd <= state.loopStart) {
        return false;
    }
    updateTransportState({ isLooping: enabled });
    return true;
}
