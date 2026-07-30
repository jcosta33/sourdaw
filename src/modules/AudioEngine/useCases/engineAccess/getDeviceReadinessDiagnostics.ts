import { deviceReadinessDiagnostics } from '../../services/deviceReadinessDiagnostics';

export function getDeviceReadinessDiagnostics() {
    return deviceReadinessDiagnostics.snapshot();
}
