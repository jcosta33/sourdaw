import { isDrumDevice as isDrumDeviceType } from '../../models/noteInputKindByDeviceType';

/** True for the drum family, voiced by the kit schedulers rather than a chain node. */
export function isDrumDevice(deviceType: string): boolean {
    return isDrumDeviceType(deviceType);
}
