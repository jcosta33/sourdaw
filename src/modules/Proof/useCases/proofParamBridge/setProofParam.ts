import { persistDeviceParam, resolveEligibleDeviceWriteTarget } from '#/modules/Arrangement/stores';

import { bridges } from './helpers';

type SetProofParamInput = {
    deviceId: string;
    name: string;
    value: number;
};

export function setProofParam({ deviceId, name, value }: SetProofParamInput): void {
    const target = resolveEligibleDeviceWriteTarget(deviceId);
    if (target.status !== 'eligible') {
        return;
    }

    bridges.get(deviceId)?.setParam(name, value);
    persistDeviceParam(deviceId, name, value);
}
