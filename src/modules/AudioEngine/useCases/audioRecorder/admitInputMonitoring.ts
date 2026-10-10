import { startInputMonitoring as startInputMonitoringRepo } from '../../repositories/audioRecorder/inputMonitoring';
import { captureInputMonitoringProjectRootIdentity } from '../../stores/inputMonitoringProjectAccess';

import { inputMonitoringAdmissions, type Admission, type ReadIntent } from './inputMonitoringAdmission';

export function admitInputMonitoring(
    trackId: string,
    captureInputId: string | null | undefined,
    readIntent: ReadIntent
): Promise<boolean> {
    const requestingRootIdentity = captureInputMonitoringProjectRootIdentity();
    // Reconciliation reuses this reader when input changes; it must retain the original root authority.
    const readAuthorizedIntent: ReadIntent = () =>
        captureInputMonitoringProjectRootIdentity() === requestingRootIdentity ? readIntent() : null;
    const intent = readAuthorizedIntent();
    if (!intent) {
        return Promise.resolve(false);
    }
    const requestedInputId = captureInputId === undefined ? intent.inputId : captureInputId;
    const admission: Admission = {
        selectorInputId: intent.inputId,
        captureInputId: requestedInputId,
        readIntent: readAuthorizedIntent,
    };
    inputMonitoringAdmissions.set(trackId, admission);
    const isCurrent = (): boolean | 'retain' => {
        if (captureInputMonitoringProjectRootIdentity() !== requestingRootIdentity) {
            return false;
        }
        const current = readAuthorizedIntent();
        if (!current || current.inputId !== admission.selectorInputId) {
            return false;
        }
        return current.canAttach === false ? 'retain' : true;
    };
    return startInputMonitoringRepo(trackId, requestedInputId, isCurrent).then((opened) => {
        if (!opened && inputMonitoringAdmissions.get(trackId) === admission) {
            const current = readAuthorizedIntent();
            // A held retarget can outlive its cancelled old grant. Keep its
            // existing permission authority for resume, never for a refusal.
            if (!current || current.inputId === admission.selectorInputId) {
                inputMonitoringAdmissions.delete(trackId);
            }
        }
        return opened;
    });
}
