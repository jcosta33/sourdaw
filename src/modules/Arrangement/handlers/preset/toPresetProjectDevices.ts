import { type DeviceSnapshot } from '../../models/DeviceSnapshot';
import { projectDeviceSnapshots } from '../../models/DeviceSnapshotProjection';

/** Keep existing handler callers on the owner's shared snapshot projection. */
export function toPresetProjectDevices(devices: readonly DeviceSnapshot[]) {
    return projectDeviceSnapshots(devices);
}
