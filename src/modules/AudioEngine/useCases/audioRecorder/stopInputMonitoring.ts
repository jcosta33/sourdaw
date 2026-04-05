import { stopInputMonitoring as stopInputMonitoringRepo } from '../../repositories/audioRecorder/inputMonitoring';

export function stopInputMonitoring(): void {
    stopInputMonitoringRepo();
}
