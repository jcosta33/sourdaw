import { logger } from '#/infra/logger/appLogger';
import { stopAllScheduled, stopNativeLiveGraphSession } from '#/modules/AudioEngine/useCases';
import { resetMidiState } from '#/modules/MIDI/useCases';

import { getTransportState } from '../../repositories/transport/getTransportState';
import { updateTransportState } from '../../repositories/transport/updateTransportState';
import { playheadPositionRef } from '../../stores/playheadPositionRef';
import { tempoMapStore } from '../../stores/tempoMapStore';
import { stopPlayheadScheduler } from '../playheadScheduler/stopPlayheadScheduler';
import { secondsBetweenBeats } from '../secondsBetweenBeats';

import { panicYeastRuntime } from './panicYeastRuntime';
import { stopActiveRecording } from './stopActiveRecording';

function captureTeardown(teardown: () => void | Promise<void>): Promise<void> {
    try {
        return Promise.resolve(teardown());
    } catch (error) {
        const failure = error instanceof Error ? error : new Error('Runtime teardown failed', { cause: error });
        return Promise.reject(failure);
    }
}

export function stopPlayback(): Promise<void> {
    // Runtime recording can still be flushing after transport state turns false,
    // and this also cancels a pending count-in.
    const recordingFlush = captureTeardown(stopActiveRecording);
    const state = getTransportState();
    if (!state) {
        return recordingFlush;
    }

    // §8.7 / N5 — Spacebar stop used to flip `isRecording: false` directly,
    // which bypassed `stopAudioRecording` + `stopRecording`: the media
    // recorder kept capturing, the audio buffer never flushed, and the clip
    // stayed empty. Route through `stopActiveRecording` so the recording
    // pipeline commits the buffer to the clip before we halt the transport.
    const yeastTeardown = captureTeardown(panicYeastRuntime);
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

    // D3.c.4a (#3066): the native engine holds its own `is_playing`, so a stop
    // it never hears leaves it running the topology forever. A session that
    // never started declines, which is the ordinary browser-build answer.
    Promise.resolve(
        stopNativeLiveGraphSession({
            positionSeconds: secondsBetweenBeats(tempoMapStore.value?.changes ?? [], 0, playheadPosition, state.tempo),
        })
    ).catch((error: unknown) => {
        logger.warn(new Error('Native live graph session failed to stop', { cause: error }));
    });

    updateTransportState({ isPlaying: false, isRecording: false, playheadPosition });
    playheadPositionRef.current = playheadPosition;
    return Promise.all([recordingFlush, yeastTeardown]).then(() => undefined);
}
