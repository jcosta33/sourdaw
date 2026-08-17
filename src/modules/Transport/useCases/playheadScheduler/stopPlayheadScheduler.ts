import { logger } from '#/infra/logger/appLogger';
import { stopRecording } from '#/modules/Arrangement/useCases';
import {
    stopAllScheduled,
    stopAudioRecording,
    getAudioContext,
    cancelTrackAutomationRamps,
} from '#/modules/AudioEngine/useCases';
import { stopAutomationRecording } from '#/modules/Automation/useCases';

import { playheadPositionRef } from '../../stores/playheadPositionRef';
import { resetMetronomeBeat } from '../scheduling/resetMetronomeBeat';

import { schedulerSession, stopActiveSources } from './schedulerSession';

export function stopPlayheadScheduler(): void {
    schedulerSession.generation += 1;
    stopAutomationRecording();
    if (schedulerSession.worker) {
        schedulerSession.worker.postMessage({ type: 'stop' });
        schedulerSession.worker.terminate();
        schedulerSession.worker = null;
    }
    if (schedulerSession.punchRecordingActive) {
        Promise.resolve(stopAudioRecording()).catch((error: unknown) => {
            logger.error(new Error('Scheduler recording teardown failed', { cause: error }));
        });
        // Close the punched take at the live playhead. Every caller reaches this
        // before it rewrites the position: `pausePlayback` has already copied the
        // ref into the store (so the two agree), while `stopPlayback` and
        // `executePlayheadSeek` only assign the new position *after* this call —
        // so the store still holds the beat playback started at, and the ref is
        // the one value that is correct on all three paths.
        stopRecording(playheadPositionRef.current);
        schedulerSession.punchRecordingActive = false;
    }
    schedulerSession.lastTickTime = 0;
    schedulerSession.accumulatedPosition = 0;
    schedulerSession.lastScheduledBeat = -1;
    schedulerSession.tickInFlight = false;
    resetMetronomeBeat(0);
    schedulerSession.scheduledAudioClips.clear();
    schedulerSession.scheduledFrozenTracks.clear();
    const ctx = getAudioContext();
    stopActiveSources(schedulerSession.activeAudioSources, ctx);
    stopAllScheduled();
    // RT-5: hold each track's fader gain/pan and drop pending automation ramps
    // so a ramp scheduled toward a compensated future time cannot land after
    // playback has stopped (the AudioParam analog of stopActiveSources).
    cancelTrackAutomationRamps();
}
