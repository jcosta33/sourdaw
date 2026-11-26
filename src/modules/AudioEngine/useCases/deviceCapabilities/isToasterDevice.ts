import { isToasterDevice as isToasterDeviceType } from '../../models/NoteInputKindByDeviceType';

/** True for the Toaster drum machine, addressed by pad rather than voiced by a kit scheduler. */
export function isToasterDevice(deviceType: string): boolean {
    return isToasterDeviceType(deviceType);
}
