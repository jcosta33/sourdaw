import {
    deviceParameterRuntimeWriteOwners,
    pendingDeviceParameterRuntimeWriteOwners,
    deviceParameterRuntimeWriteSequences,
} from '../../stores/deviceParameterRuntimeWriteOwners';
import { deviceParameterRuntimeWriteParameterId } from './setDeviceParameterRuntimeWriteOwner';

/**
 * Web controller receipts distinguish effective, pending and refused writes.
 * Native queue admission does not report which parameter stamps actually applied
 * (a bypassed device can discard one); it must never be promoted to this receipt.
 */
export function captureDeviceParameterRuntimeWriteAuthority(
    trackId: string,
    deviceId: string,
    requestedParamId: string
) {
    const paramId = deviceParameterRuntimeWriteParameterId(trackId, deviceId, requestedParamId);
    const owner = Symbol('device parameter runtime write');
    const key = JSON.stringify([trackId, deviceId, paramId]);
    const sequence = deviceParameterRuntimeWriteSequences.get(key);
    const ownsCurrentWrite = (): boolean =>
        deviceParameterRuntimeWriteOwners.get(trackId)?.get(deviceId)?.get(paramId) === owner;

    return {
        owner,
        isCurrent: () =>
            ownsCurrentWrite() ||
            (pendingDeviceParameterRuntimeWriteOwners.get(key)?.has(owner) === true &&
                deviceParameterRuntimeWriteSequences.get(key) === sequence),
        canCommit: (): boolean => ownsCurrentWrite() || deviceParameterRuntimeWriteSequences.get(key) === sequence,
        release: (): void => {
            pendingDeviceParameterRuntimeWriteOwners.get(key)?.delete(owner);
            if (ownsCurrentWrite()) {
                deviceParameterRuntimeWriteOwners.get(trackId)?.get(deviceId)?.delete(paramId);
            }
        },
    };
}
