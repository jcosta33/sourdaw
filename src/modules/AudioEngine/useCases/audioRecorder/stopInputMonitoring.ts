import { stopInputMonitoring as stopInputMonitoringRepo } from '../../repositories/audioRecorder/stopInputMonitoring';

import { forgetAllInputMonitoringAdmissions } from './forgetAllInputMonitoringAdmissions';

export function stopInputMonitoring(): void {
    forgetAllInputMonitoringAdmissions();
    stopInputMonitoringRepo();
}
