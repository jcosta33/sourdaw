import { getTransportState, updateTransportState } from '#/modules/Transport/repositories/transportRepository';
import { stopPlayheadScheduler } from '#/modules/Transport/useCases/playheadScheduler';
import { stopAllScheduled } from '#/modules/AudioEngine/useCases/scheduling';
import { resetMidiState } from '#/modules/AudioEngine/useCases/webMidiInput';

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
