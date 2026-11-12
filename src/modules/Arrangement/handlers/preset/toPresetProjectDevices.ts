import { type DeviceSnapshot } from '#/utils/handlerContract';

import { projectDeviceSnapshots } from '../../models/projectDeviceSnapshots';

/** Keep existing handler callers on the owner's shared snapshot projection. */
export function toPresetProjectDevices(devices: readonly DeviceSnapshot[]) {
    return projectDeviceSnapshots(devices);
}
