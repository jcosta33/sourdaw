import { hasDeferredInputMonitoringEdge } from '../../repositories/audioRecorder/hasDeferredInputMonitoringEdge';

import { inputMonitoringAdmissions, type ReadIntent } from './inputMonitoringAdmission';

export function readChangedInputMonitoringAdmission(
    trackId: string
): { inputId: string | null; readIntent: ReadIntent } | null {
    const admission = inputMonitoringAdmissions.get(trackId);
    const intent = admission?.readIntent();
    if (!admission || !intent) {
        return null;
    }
    if (intent.inputId === admission.selectorInputId) {
        if (!admission.captureRetired && !hasDeferredInputMonitoringEdge(trackId)) {
            return null;
        }
        return { inputId: admission.captureInputId, readIntent: admission.readIntent };
    }
    return { inputId: intent.inputId, readIntent: admission.readIntent };
}
