import { logger } from '#/infra/logger/appLogger';
import { stopAllScheduled, resetMidiState } from '#/modules/AudioEngine/useCases';

import { getTransportState } from '../../repositories/transport/getTransportState';
import { updateTransportState } from '../../repositories/transport/updateTransportState';
import { stopPlayheadScheduler } from '../playheadScheduler';

import { panicYeastRuntime } from './panicYeastRuntime';
import { stopActiveRecording } from './stopActiveRecording';

export function pausePlayback(): void {
    const state = getTransportState();
    if (!state) {
        return;
    }

    // Flip `isPlaying: false` BEFORE tearing the scheduler down. The worker
    // posts ticks asynchronously; `stopPlayheadScheduler` terminates the worker
    // but a tick already queued on the main thread can still run. `tick` bails
    // immediately when `transportStore.value.isPlaying` is false (its first
    // guard), so committing the paused state first makes any in-flight tick a
    // no-op instead of letting it run the full body and write a stale beat
    // record into the SAB.
    updateTransportState({ isPlaying: false, isRecording: false });

    // Cancel any pending count-in. During count-in `isRecording` is still
    // false, so `stopActiveRecording` would otherwise be skipped and the
    // queued `setTimeout` would fire `beginActualRecording` after the pause.
    // `stopActiveRecording` clears the count-in timer and is a safe no-op when
    // nothing is recording (the audio recorder and clip finaliser both bail on
    // empty session/clip sets).
    Promise.resolve(stopActiveRecording())
        .catch((error: unknown) => {
            logger.error(new Error('Recording teardown failed before pausing playback', { cause: error }));
        })
        .then(() => {
            // A play pressed during the recording flush starts a fresh
            // scheduler session (startPlayback's re-entry guard only checks
            // `isPlaying`). That new session now owns the scheduler, so this
            // stale pause continuation must not tear it down.
            if (getTransportState()?.isPlaying) {
                return undefined;
            }
            panicYeastRuntime();
            stopPlayheadScheduler();
            stopAllScheduled();
            resetMidiState();
            return undefined;
        })
        .catch((error: unknown) => {
            logger.error(new Error('Playback pause cleanup failed', { cause: error }));
        });
}
