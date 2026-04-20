import type { FermenterDependencies } from '../fermenterDependencies';

export type { DeviceRef, GetAllTracksFn } from '#/utils/createFindDeviceRef';
export { createFindDeviceRef } from '#/utils/createFindDeviceRef';
export type UpdateDeviceParamFn = FermenterDependencies['updateDeviceParam'];
export type PersistDeviceParamFn = FermenterDependencies['persistDeviceParam'];
