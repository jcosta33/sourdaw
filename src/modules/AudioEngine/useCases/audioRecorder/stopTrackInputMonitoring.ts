import { stopTrackInputMonitoring as stopTrackInputMonitoringRepo } from '../../repositories/audioRecorder/stopTrackInputMonitoring';

export function stopTrackInputMonitoring(trackId: string): void {
    stopTrackInputMonitoringRepo(trackId);
}
