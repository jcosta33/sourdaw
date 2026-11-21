import { resolveDeviceRoles } from '../../models/DeviceRolesByDeviceType';

/** True for a device that rewrites its track's notes and contributes no audio node (Yeast). */
export function isMidiTransformDevice(deviceType: string): boolean {
    return resolveDeviceRoles(deviceType)?.midiTransform === true;
}
