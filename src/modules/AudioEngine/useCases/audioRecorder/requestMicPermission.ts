import { requestMicPermission as requestMicPermissionRepo } from '../../repositories/audioRecorder/recording';

export function requestMicPermission(): Promise<boolean> {
    return requestMicPermissionRepo();
}
