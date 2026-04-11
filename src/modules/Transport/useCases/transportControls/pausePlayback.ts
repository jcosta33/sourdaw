import { getTransportState, updateTransportState } from '#/modules/Transport/repositories/transport';
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
