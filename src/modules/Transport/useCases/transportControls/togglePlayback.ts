import { getTransportState } from '../../repositories/transport/getTransportState';

import { pausePlayback } from './pausePlayback';
import { startPlayback } from './startPlayback';

export function togglePlayback(): void {
    const state = getTransportState();
    if (!state) {
        return;
    }

    if (state.isPlaying) {
        pausePlayback();
    } else {
        startPlayback();
    }
}
