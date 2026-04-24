import { requestMicPermission as requestMicPermissionRepo } from '../../repositories/audioRecorder/requestMicPermission';

export function requestMicPermission(): Promise<boolean> {
    return requestMicPermissionRepo();
}
