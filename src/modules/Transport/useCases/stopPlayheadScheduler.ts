import { stopRecording } from '#/modules/Arrangement/useCases';
import { stopAllScheduled, stopAudioRecording, getAudioContext } from '#/modules/AudioEngine/useCases';
import { stopAutomationRecording } from '#/modules/Automation/useCases';

import { schedulerSession } from './playheadScheduler';
import { resetMetronomeBeat } from './scheduling/resetMetronomeBeat';
import { stopActiveSources } from './stopActiveSources';

export function stopPlayheadScheduler(): void {
    schedulerSession.generation += 1;
    stopAutomationRecording();
    if (schedulerSession.worker) {
        schedulerSession.worker.postMessage({ type: 'stop' });
        schedulerSession.worker.terminate();
        schedulerSession.worker = null;
    }
    if (schedulerSession.punchRecordingActive) {
        void stopAudioRecording();
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
