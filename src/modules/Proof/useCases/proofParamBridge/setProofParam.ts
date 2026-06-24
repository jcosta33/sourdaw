import { persistDeviceParam } from '#/modules/Arrangement/stores';

import { bridges } from './helpers';

type SetProofParamInput = {
    deviceId: string;
    name: string;
    value: number;
};

export function setProofParam({ deviceId, name, value }: SetProofParamInput): void {
    bridges.get(deviceId)?.setParam(name, value);
    persistDeviceParam(deviceId, name, value);
}
