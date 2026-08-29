import { getTransportState } from '../../repositories/transport/getTransportState';
import { updateTransportState } from '../../repositories/transport/updateTransportState';

import { sendLoopRegionToNativeSession } from './sendLoopRegionToNativeSession';

export function toggleLoop(): void {
    const state = getTransportState();
    if (!state) {
        return;
    }
    updateTransportState({ isLooping: !state.isLooping });
    sendLoopRegionToNativeSession();
}
