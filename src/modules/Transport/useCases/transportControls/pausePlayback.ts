import { getTransportState } from '#/modules/Transport/repositories/transport/getTransportState';
import { updateTransportState } from '#/modules/Transport/repositories/transport/updateTransportState';
import { stopPlayheadScheduler } from '#/modules/Transport/useCases/playheadScheduler';
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
