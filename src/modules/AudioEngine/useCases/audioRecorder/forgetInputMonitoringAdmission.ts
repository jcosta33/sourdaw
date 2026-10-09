import { inputMonitoringAdmissions } from './inputMonitoringAdmission';

export function forgetInputMonitoringAdmission(trackId: string): void {
    inputMonitoringAdmissions.delete(trackId);
}
