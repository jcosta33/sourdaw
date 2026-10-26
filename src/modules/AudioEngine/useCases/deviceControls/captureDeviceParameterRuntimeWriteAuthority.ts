import { deviceParameterRuntimeWriteOwners } from '../../stores/deviceParameterRuntimeWriteOwners';

export function captureDeviceParameterRuntimeWriteAuthority(trackId: string, deviceId: string, paramId: string) {
    const owner = Symbol('device parameter runtime write');
    const ownsCurrentWrite = (): boolean =>
        deviceParameterRuntimeWriteOwners.get(trackId)?.get(deviceId)?.get(paramId) === owner;

    return {
        owner,
        isCurrent: ownsCurrentWrite,
        release: (): void => {
            if (ownsCurrentWrite()) {
                deviceParameterRuntimeWriteOwners.get(trackId)?.get(deviceId)?.delete(paramId);
            }
        },
    };
}
