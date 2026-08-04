import { getTransportState } from '../../repositories/transport/getTransportState';

import { pausePlayback } from './pausePlayback';
import { startPlayback } from './startPlayback';

export function setPlayback(playing: boolean): void {
    const state = getTransportState();
    if (!state || state.isPlaying === playing) {
        return;
    }

    if (playing) {
        startPlayback();
        return;
    }

    pausePlayback();
}
