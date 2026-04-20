import { stopAllScheduled, resetMidiState } from '#/modules/AudioEngine/useCases';

import { getTransportState } from '../../repositories/transport/getTransportState';
import { updateTransportState } from '../../repositories/transport/updateTransportState';
import { playheadPositionRef } from '../../stores/playheadPositionRef';
import { stopPlayheadScheduler } from '../playheadScheduler';

import { toggleRecording } from './toggleRecording';

export function stopPlayback(): void {
    const state = getTransportState();
    if (!state) {
        return;
    }

    // §8.7 / N5 — Spacebar stop used to flip `isRecording: false` directly,
    // which bypassed `stopAudioRecording` + `stopRecording`: the media
    // recorder kept capturing, the audio buffer never flushed, and the clip
    // stayed empty. Route through `toggleRecording` so the recording
    // pipeline commits the buffer to the clip before we halt the transport.
    if (state.isRecording) {
        toggleRecording();
    }

    stopPlayheadScheduler();
    stopAllScheduled();
    resetMidiState();

    let playheadPosition = 0;
    if (state.loopEnd > state.loopStart) {
        playheadPosition = state.loopStart;

        // Optional DAW standard UX: if already stopped at the loop start, double-stopping jumps to 0
        if (!state.isPlaying && state.playheadPosition === state.loopStart) {
            playheadPosition = 0;
        }
    }

    updateTransportState({ isPlaying: false, isRecording: false, playheadPosition });
    playheadPositionRef.current = playheadPosition;
}
