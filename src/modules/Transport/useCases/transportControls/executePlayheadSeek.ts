import { logger } from '#/infra/logger/appLogger';
import { repositionNativeLiveGraphSession, stopAllScheduled } from '#/modules/AudioEngine/useCases';
import { resetMidiState } from '#/modules/MIDI/useCases';

import { getTransportState } from '../../repositories/transport/getTransportState';
import { updateTransportState } from '../../repositories/transport/updateTransportState';
import { playheadPositionRef } from '../../stores/playheadPositionRef';
import { tempoMapStore } from '../../stores/tempoMapStore';
import { advanceSchedulerDiscontinuityEpoch } from '../playheadScheduler/advanceSchedulerDiscontinuityEpoch';
import { startPlayheadScheduler } from '../playheadScheduler/startPlayheadScheduler';
import { stopPlayheadScheduler } from '../playheadScheduler/stopPlayheadScheduler';
import { secondsBetweenBeats } from '../secondsBetweenBeats';

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

    // #3101: this scheduler restarts at the target beat, and until now nothing
    // told the engine, which kept rolling from wherever it already was. Locating
    // one transport and not the other is only inaudible while the native
    // topology carries no clips; the moment it does, a seek would leave the two
    // playing different parts of the arrangement at once.
    //
    // A locate on the live session rather than a fresh one. The engine's loop
    // region and transport maps are installed and survive a reposition, so
    // re-sending the topology to reach a new position would buy nothing and cost
    // a stop/start edge through a transport that never stopped — see
    // `repositionNativeLiveGraphSession` for the engine laws that hold it up.
    //
    // Only while playing. A seek with the transport parked writes nothing: a
    // parked engine renders no frame and its playhead feed is closed, so its
    // position is neither heard nor read, and the next play re-sends the
    // position it starts from. The gesture that most often seeks — dragging the
    // playhead across the ruler with the transport stopped — therefore costs the
    // bridge nothing at all.
    //
    // Sent here rather than from `finishSeek`, which runs behind the recording
    // flush: the session applies its commands in arrival order, so a stop or a
    // pause landing during that flush must queue *behind* this locate and win.
    // Deferred, it would instead be admitted after the stop and set a parked
    // engine rolling again at the seek target.
    //
    // Fired rather than awaited, as every other transport gesture fires its
    // native command: Web Audio is the audible path, so nothing about seeking
    // waits on the engine, and a session that never started declines — the
    // ordinary browser-build answer.
    if (wasPlaying) {
        Promise.resolve(
            repositionNativeLiveGraphSession({
                positionSeconds: secondsBetweenBeats(tempoMapStore.value?.changes ?? [], 0, targetBeat, state.tempo),
            })
        ).catch((error: unknown) => {
            logger.warn(new Error('Native live graph session failed to reposition on seek', { cause: error }));
        });
    }

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
