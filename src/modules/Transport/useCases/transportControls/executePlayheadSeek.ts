import { stopAllScheduled } from '#/modules/AudioEngine/useCases';
import { resetMidiState } from '#/modules/MIDI/useCases';

import { getTransportState } from '../../repositories/transport/getTransportState';
import { updateTransportState } from '../../repositories/transport/updateTransportState';
import { playheadPositionRef } from '../../stores/playheadPositionRef';
import { advanceSchedulerDiscontinuityEpoch } from '../playheadScheduler/advanceSchedulerDiscontinuityEpoch';
import { startPlayheadScheduler } from '../playheadScheduler/startPlayheadScheduler';
import { stopPlayheadScheduler } from '../playheadScheduler/stopPlayheadScheduler';

import { panicYeastRuntime } from './panicYeastRuntime';
import { stopActiveRecording } from './stopActiveRecording';

export function executePlayheadSeek(beat: number): Promise<void> {
    const state = getTransportState();
    if (!state) {
        return Promise.resolve();
    }

    const wasPlaying = state.isPlaying;
    const wasRecording = state.isRecording;
    const targetBeat = Math.max(0, beat);

    function finishSeek(): Promise<void> {
        advanceSchedulerDiscontinuityEpoch();
        const yeastPanic = panicYeastRuntime();
        if (wasPlaying) {
            stopPlayheadScheduler();
            stopAllScheduled();
            resetMidiState();
        }

        updateTransportState({ playheadPosition: targetBeat });
        playheadPositionRef.current = targetBeat;

        // Resume only playback after a seek. We deliberately do not re-arm
        // recording here: `stopPlayheadScheduler` already flushed the recorded
        // automation segment up to the seek point (via `stopAutomationRecording`),
        // and re-starting the scheduler re-arms a fresh automation session for the
        // remainder. Recording stays committed/closed so the lane is split at the
        // seek rather than re-armed on every jump.
        // Gate the restart on live state, not the `wasPlaying` captured before
        // the recording flush await. A stop/pause landing during the flush wins;
        // do not resurrect the scheduler for a transport that is no longer
        // playing.
        if (wasPlaying && getTransportState()?.isPlaying === true) {
            startPlayheadScheduler();
        }

        return yeastPanic;
    }

    if (!wasRecording) {
        return finishSeek();
    }

    let recordingTeardown: Promise<void>;
    try {
        recordingTeardown = Promise.resolve(stopActiveRecording());
    } catch (error: unknown) {
        const recordingError =
            error instanceof Error
                ? error
                : new Error('Recording teardown failed before playhead seek', { cause: error });
        recordingTeardown = Promise.reject(recordingError);
    }

    // The recorder flush runs while the engine is still live. A failed flush
    // does not strand the transport at the old position, but the returned
    // promise still rejects after the seek so runtime receipts report a warning.
    return recordingTeardown.then(
        () => finishSeek(),
        async (recordingError: unknown) => {
            try {
                await finishSeek();
            } catch (seekError: unknown) {
                throw new AggregateError([recordingError, seekError], 'Recording teardown and playhead seek failed', {
                    cause: seekError,
                });
            }
            throw recordingError;
        }
    );
}
