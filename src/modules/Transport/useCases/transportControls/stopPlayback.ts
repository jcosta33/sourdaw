import { stopAllScheduled, resetMidiState } from '#/modules/AudioEngine/useCases';

import { getTransportState } from '../../repositories/transport/getTransportState';
import { updateTransportState } from '../../repositories/transport/updateTransportState';
import { playheadPositionRef } from '../../stores/playheadPositionRef';
import { stopPlayheadScheduler } from '../playheadScheduler';

import { panicYeastRuntime } from './panicYeastRuntime';
import { stopActiveRecording } from './stopActiveRecording';

export function stopPlayback(): Promise<void> {
    // Runtime recording can still be flushing after transport state turns false,
    // and this also cancels a pending count-in.
    const recordingFlush = stopActiveRecording();
    const state = getTransportState();
    if (!state) {
        return recordingFlush;
    }

    // §8.7 / N5 — Spacebar stop used to flip `isRecording: false` directly,
    // which bypassed `stopAudioRecording` + `stopRecording`: the media
    // recorder kept capturing, the audio buffer never flushed, and the clip
    // stayed empty. Route through `stopActiveRecording` so the recording
    // pipeline commits the buffer to the clip before we halt the transport.
    panicYeastRuntime();
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
    return recordingFlush;
}
