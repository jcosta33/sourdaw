import { startInputMonitoring as startInputMonitoringRepo } from '../../repositories/audioRecorder/inputMonitoring';

import { inputMonitoringAdmissions, type Admission, type ReadIntent } from './inputMonitoringAdmission';

export function admitInputMonitoring(
    trackId: string,
    captureInputId: string | null | undefined,
    readIntent: ReadIntent
): Promise<boolean> {
    const intent = readIntent();
    if (!intent) {
        return Promise.resolve(false);
    }
    const requestedInputId = captureInputId === undefined ? intent.inputId : captureInputId;
    const admission: Admission = { selectorInputId: intent.inputId, readIntent };
    inputMonitoringAdmissions.set(trackId, admission);
    const isCurrent = (): boolean => readIntent()?.inputId === admission.selectorInputId;
    return startInputMonitoringRepo(trackId, requestedInputId, isCurrent).then((opened) => {
        if (!opened && inputMonitoringAdmissions.get(trackId) === admission) {
            inputMonitoringAdmissions.delete(trackId);
        }
        return opened;
    });
}
