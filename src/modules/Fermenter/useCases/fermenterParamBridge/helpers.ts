import { persistDeviceParam } from '#/modules/Arrangement/useCases';
import { updateDeviceParam } from '#/modules/AudioEngine/useCases';
export type { DeviceRef, GetAllTracksFn } from '#/utils/createFindDeviceRef';
export { createFindDeviceRef } from '#/utils/createFindDeviceRef';
export type UpdateDeviceParamFn = typeof updateDeviceParam;
export type PersistDeviceParamFn = typeof persistDeviceParam;