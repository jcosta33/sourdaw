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

export function pausePlayback(): void {
    const state = getTransportState();
    if (!state) {
        return;
    }

    // Read once, so the beat the engine parks on and the beat the store commits
    // are the same number by construction rather than by two matching reads.
    const pausedBeat = playheadPositionRef.current;

    // #3096: pause halts the engine; it just does not locate it. Established
    // transports separate pause from stop only by where the playhead is left,
    // never by whether the engine keeps running — REAPER's Play/Pause holds the
    // cursor where it stopped while Play/Stop returns it, Cubase's stop does the
    // same under `Return to Start Position on Stop`, Live's Shift+Space resumes
    // from the stop point, and Pro Tools names its pause "pre-prime deck for
    // instant playback", which is the other half of the convention: the session
    // under a paused transport stays live so resume costs nothing.
    //
    // `stopNativeLiveGraphSession` is exactly that halt and not a teardown. It
    // sends `set-transport playing:false` and closes the playhead feed, while
    // deliberately keeping the topology mirrored, the backend handle open and
    // the plugin runtimes hosted. So pause sends the same command the stop
    // gesture sends, differing only in the position — the pause point rather
    // than the stop-rest point — and a parked engine renders nothing at all
    // (`advance_playhead` returns on `!is_playing`), which is what will keep a
    // paused project silent once the topology carries clips.
    //
    // Sent here rather than from the deferred continuation below, because the
    // session serialises its commands in arrival order: a play that lands during
    // the recording flush must queue behind this park and win, not ahead of it.
    // Fired rather than awaited, exactly as the stop gesture fires it: Web Audio
    // is the audible path, so nothing about pausing waits on the engine, and a
    // session that never started declines — the ordinary browser-build answer.
    Promise.resolve(
        stopNativeLiveGraphSession({
            positionSeconds: secondsBetweenBeats(tempoMapStore.value?.changes ?? [], 0, pausedBeat, state.tempo),
        })
    ).catch((error: unknown) => {
        logger.warn(new Error('Native live graph session failed to park on pause', { cause: error }));
    });

    // Flip `isPlaying: false` BEFORE tearing the scheduler down. The worker
    // posts ticks asynchronously; `stopPlayheadScheduler` terminates the worker
    // but a tick already queued on the main thread can still run. `tick` bails
    // immediately when `transportStore.value.isPlaying` is false (its first
    // guard), so committing the paused state first makes any in-flight tick a
    // no-op instead of letting it run the full body and write a stale beat
    // record into the SAB.
    //
    // Persist the live playhead in the same commit. During playback the
    // scheduler advances only `playheadPositionRef` (the store is written on
    // discrete events: start, stop, seek), so without this the store still
    // holds the position where playback *started* and the next
    // `startPlayback` resumes from there instead of the pause point.
    updateTransportState({ isPlaying: false, isRecording: false, playheadPosition: pausedBeat });

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
            void panicYeastRuntime();
            stopPlayheadScheduler();
            stopAllScheduled();
            resetMidiState();
            return undefined;
        })
        .catch((error: unknown) => {
            logger.error(new Error('Playback pause cleanup failed', { cause: error }));
        });
}
