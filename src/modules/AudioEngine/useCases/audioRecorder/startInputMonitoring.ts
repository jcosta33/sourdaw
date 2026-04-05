import { startInputMonitoring as startInputMonitoringRepo } from '../../repositories/audioRecorder/inputMonitoring';

export function startInputMonitoring(trackId: string, inputId?: string | null): Promise<boolean> {
    return startInputMonitoringRepo(trackId, inputId);
}
