import { getAllTracks } from '#/modules/Arrangement/useCases';
import { createFindDeviceRef, type DeviceRef, type GetAllTracksFn } from '#/utils/createFindDeviceRef';

export { createFindDeviceRef };
export type { DeviceRef, GetAllTracksFn };

export const findDeviceRef = createFindDeviceRef(getAllTracks);
