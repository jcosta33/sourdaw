import { startInputMonitoring } from '../../repositories/audioRecorder/inputMonitoring';
import { readCommittedInputMonitoringTrack } from '../../stores/inputMonitoringProjectAccess';

import { reconcileAutoInputMonitoring } from './reconcileAutoInputMonitoring';

/** Restore admission and its pending grant must both observe current committed intent. */
export async function rearmCommittedTrackInputMonitoring(trackId: string): Promise<void> {
    const track = readCommittedInputMonitoringTrack(trackId);
    if (!track || track.inputMonitoring !== 'on') {
        return;
    }
    reconcileAutoInputMonitoring();
    const inputId = track.inputId;
    const isCurrent = (): boolean => {
        const current = readCommittedInputMonitoringTrack(trackId);
        return current?.inputMonitoring === 'on' && current.inputId === inputId;
    };
    await startInputMonitoring(trackId, inputId, isCurrent);
}
