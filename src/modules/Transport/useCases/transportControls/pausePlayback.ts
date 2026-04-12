import { getTransportState } from '../../repositories/transport/getTransportState';
import { updateTransportState } from '../../repositories/transport/updateTransportState';
import { stopPlayheadScheduler } from '../playheadScheduler';
import { stopAllScheduled, resetMidiState } from '#/modules/AudioEngine/useCases';

export function pausePlayback(): void {
    const state = getTransportState();
    if (!state) {
        return;
    }

    stopPlayheadScheduler();
    stopAllScheduled();
    resetMidiState();
    updateTransportState({ isPlaying: false, isRecording: false });
}
