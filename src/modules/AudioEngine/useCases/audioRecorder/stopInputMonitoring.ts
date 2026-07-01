import { stopInputMonitoring as stopInputMonitoringRepo } from '../../repositories/audioRecorder/stopInputMonitoring';

export function stopInputMonitoring(): void {
    stopInputMonitoringRepo();
}
