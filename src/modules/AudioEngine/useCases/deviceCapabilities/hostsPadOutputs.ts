import { resolveDeviceRoles } from '../../models/DeviceRolesByDeviceType';

/** True for a device that hosts one output per pad, its folder track's children being those pads' tracks (Toaster). */
export function hostsPadOutputs(deviceType: string): boolean {
    return resolveDeviceRoles(deviceType)?.padOutputHost === true;
}
