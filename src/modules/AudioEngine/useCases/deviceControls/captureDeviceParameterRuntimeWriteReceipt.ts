import {
    deviceParameterRuntimeWriteContexts as writeContexts,
    deviceParameterRuntimeWriteCounter,
    deviceParameterRuntimeWriteSequences as completedWrites,
    pendingDeviceParameterRuntimeWriteOwners,
} from '../../stores/deviceParameterRuntimeWriteOwners';

import { deviceParameterRuntimeWriteParameterId } from './deviceParameterRuntimeWriteParameterId';
import { setDeviceParameterRuntimeWriteOwner } from './setDeviceParameterRuntimeWriteOwner';

/** Capture a producer now, and start its receipt when a controller actually writes. */
export function captureDeviceParameterRuntimeWriteReceipt(trackId: string, deviceId: string, requestedParamId: string) {
    const paramId = deviceParameterRuntimeWriteParameterId(trackId, deviceId, requestedParamId);
    const context = writeContexts.findLast(
        (entry) => entry.trackId === trackId && entry.deviceId === deviceId && entry.paramId === paramId
    );
    const owner = context?.owner;
    return {
        pending: () => {
            if (owner) {
                const key = JSON.stringify([trackId, deviceId, paramId]);
                const pending = pendingDeviceParameterRuntimeWriteOwners.get(key) ?? new Set<symbol>();
                pending.add(owner);
                pendingDeviceParameterRuntimeWriteOwners.set(key, pending);
            }
        },
        begin: () => {
            const sequence = ++deviceParameterRuntimeWriteCounter.nextWrite;
            const key = JSON.stringify([trackId, deviceId, paramId]);
            return () => {
                if ((completedWrites.get(key) ?? 0) > sequence) {
                    return;
                }
                completedWrites.set(key, sequence);
                pendingDeviceParameterRuntimeWriteOwners.delete(key);
                setDeviceParameterRuntimeWriteOwner(trackId, deviceId, paramId, owner);
            };
        },
    };
}
