import { deviceParameterRuntimeWriteContexts as writeContexts } from '../../stores/deviceParameterRuntimeWriteOwners';

import { deviceParameterRuntimeWriteParameterId } from './deviceParameterRuntimeWriteParameterId';

/** Attach the caller to an attempt; only the controller's receipt can publish it. */
export function withDeviceParameterRuntimeWriteOwner(
    trackId: string,
    deviceId: string,
    paramId: string,
    owner: symbol | undefined,
    write: () => void
): void {
    const parameterId = deviceParameterRuntimeWriteParameterId(trackId, deviceId, paramId);
    writeContexts.push({ trackId, deviceId, paramId: parameterId, owner });
    try {
        write();
    } finally {
        writeContexts.pop();
    }
}
