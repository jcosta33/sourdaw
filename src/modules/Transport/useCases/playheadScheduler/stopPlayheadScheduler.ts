import { logger } from '#/infra/logger/appLogger';
import { stopRecording } from '#/modules/Arrangement/useCases';
import { stopAllScheduled, stopAudioRecording, getAudioContext } from '#/modules/AudioEngine/useCases';
import { stopAutomationRecording } from '#/modules/Automation/useCases';

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
        stopRecording();
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
}
