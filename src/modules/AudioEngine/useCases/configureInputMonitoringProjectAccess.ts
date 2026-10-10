import {
    setInputMonitoringProjectAccess,
    type InputMonitoringProjectAccess,
} from '../stores/inputMonitoringProjectAccess';

/** Register committed-project readers before monitoring starts; null detaches the dependency. */
export function configureInputMonitoringProjectAccess(next: InputMonitoringProjectAccess | null): void {
    setInputMonitoringProjectAccess(next);
}
