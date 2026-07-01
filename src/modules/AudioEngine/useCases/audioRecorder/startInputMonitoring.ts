import { startInputMonitoring as startInputMonitoringRepo } from '../../repositories/audioRecorder/inputMonitoring';
import { getSelectedInputId } from '../audioDeviceSelection/getSelectedInputId';

export function startInputMonitoring(trackId: string, inputId?: string | null): Promise<boolean> {
    const selectedInputId = inputId === undefined ? getSelectedInputId() : inputId;
    return startInputMonitoringRepo(trackId, selectedInputId);
}
