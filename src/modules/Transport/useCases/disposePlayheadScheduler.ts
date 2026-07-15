import { getAudioContext } from '#/modules/AudioEngine/useCases';

import { schedulerSession } from './playheadScheduler';
import { disposeAudioClipScheduling } from './scheduling/disposeAudioClipScheduling';
import { resetMetronomeBeat } from './scheduling/resetMetronomeBeat';
import { stopActiveSources } from './stopActiveSources';

/**
 * Tear down all process-lifetime scheduler state. `schedulerSession` and
 * `sessionState.requestedAssets` (in scheduleAudioClips) plus the GainNode pool
 * are module-level holders that otherwise survive an HMR reload or a project
 * switch — the old `tick` worker keeps running against stale closures, the
 * dedup Sets keep clips suppressed, and the pool keeps GainNodes wired into a
 * discarded AudioContext alive. Disposing terminates the worker, stops active
 * sources, clears every dedup Set and the requested-asset set, drops the stop
 * callback, and resets the change-detection signatures so a fresh session
 * starts clean.
 */
export function disposePlayheadScheduler(): void {
    schedulerSession.generation += 1;
    if (schedulerSession.worker) {
        schedulerSession.worker.postMessage({ type: 'stop' });
        schedulerSession.worker.terminate();
        schedulerSession.worker = null;
    }
    try {
        const ctx = getAudioContext();
        stopActiveSources(schedulerSession.activeAudioSources, ctx);
    } catch {
        // AudioContext may already be gone on teardown; still drop the references.
        schedulerSession.activeAudioSources.length = 0;
    }
    schedulerSession.lastTickTime = 0;
    schedulerSession.accumulatedPosition = 0;
    schedulerSession.lastScheduledBeat = -1;
    schedulerSession.punchRecordingActive = false;
    schedulerSession.tickInFlight = false;
    schedulerSession.scheduledAudioClips.clear();
    schedulerSession.scheduledFrozenTracks.clear();
    schedulerSession.onStopRequested = null;
    schedulerSession.lastTempoMapChanges = null;
    schedulerSession.lastLoopSignature = '';
    resetMetronomeBeat(0);
    disposeAudioClipScheduling();
}
