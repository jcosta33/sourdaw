import { audioEngine } from '#/modules/AudioEngine/useCases';

import { getTransportState } from '../../repositories/transport/getTransportState';

import { pausePlayback } from './pausePlayback';
import { startPlayback } from './startPlayback';

export function setPlayback(playing: boolean): void {
    audioEngine.beginAudioPreviewIntent().release();
    const state = getTransportState();
    if (!state || state.isPlaying === playing) {
        return;
    }

    if (playing) {
        void startPlayback();
        return;
    }

    pausePlayback();
}
