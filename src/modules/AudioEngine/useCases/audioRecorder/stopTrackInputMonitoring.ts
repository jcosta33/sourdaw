import { stopTrackInputMonitoring as stopTrackInputMonitoringRepo } from '../../repositories/audioRecorder/stopTrackInputMonitoring';

import { forgetInputMonitoringAdmission } from './forgetInputMonitoringAdmission';

export function stopTrackInputMonitoring(trackId: string): void {
    forgetInputMonitoringAdmission(trackId);
    stopTrackInputMonitoringRepo(trackId);
}
