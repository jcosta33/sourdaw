import { persistDeviceParam } from '#/modules/Arrangement/stores';

import { bridges } from './helpers';

export function setProofParam(deviceId: string, name: string, value: number): void {
    bridges.get(deviceId)?.setParam(name, value);
    persistDeviceParam(deviceId, name, value);
}
