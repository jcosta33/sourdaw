import { deviceParameterRuntimeWriteOwners } from '../../stores/deviceParameterRuntimeWriteOwners';

export function setDeviceParameterRuntimeWriteOwner(
    trackId: string,
    deviceId: string,
    paramId: string,
    owner: symbol | undefined
): void {
    const deviceOwners = deviceParameterRuntimeWriteOwners.get(trackId);
    const parameterOwners = deviceOwners?.get(deviceId);
    if (!owner) {
        parameterOwners?.delete(paramId);
        return;
    }

    if (parameterOwners) {
        parameterOwners.set(paramId, owner);
        return;
    }

    const nextParameterOwners = new Map([[paramId, owner]]);
    if (deviceOwners) {
        deviceOwners.set(deviceId, nextParameterOwners);
        return;
    }
    deviceParameterRuntimeWriteOwners.set(trackId, new Map([[deviceId, nextParameterOwners]]));
}
