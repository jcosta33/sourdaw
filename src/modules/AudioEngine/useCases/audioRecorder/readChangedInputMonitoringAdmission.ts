import { inputMonitoringAdmissions, type ReadIntent } from './inputMonitoringAdmission';

export function readChangedInputMonitoringAdmission(
    trackId: string
): { inputId: string | null; readIntent: ReadIntent } | null {
    const admission = inputMonitoringAdmissions.get(trackId);
    const intent = admission?.readIntent();
    if (!admission || !intent || intent.inputId === admission.selectorInputId) {
        return null;
    }
    return { inputId: intent.inputId, readIntent: admission.readIntent };
}
