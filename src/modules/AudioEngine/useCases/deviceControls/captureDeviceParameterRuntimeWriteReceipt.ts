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
    const key = JSON.stringify([trackId, deviceId, paramId]);
    const startingPending = pendingDeviceParameterRuntimeWriteOwners.get(key);
    let pending: Set<symbol> | undefined;
    return {
        pending: () => {
            if (pendingDeviceParameterRuntimeWriteOwners.get(key) !== startingPending) {
                return false;
            }
            // Queue admission replaces cancellation authority, never the applied DSP stamp.
            // Keep ownerless admission too, so an obsolete gesture cannot erase it.
            pending = new Set(owner ? [owner] : []);
            pendingDeviceParameterRuntimeWriteOwners.set(key, pending);
            return true;
        },
        begin: () => {
            const sequence = ++deviceParameterRuntimeWriteCounter.nextWrite;
            return () => {
                if ((completedWrites.get(key) ?? 0) > sequence) {
                    return;
                }
                completedWrites.set(key, sequence);
                const currentPending = pendingDeviceParameterRuntimeWriteOwners.get(key);
                if (currentPending === pending || currentPending === startingPending) {
                    pendingDeviceParameterRuntimeWriteOwners.delete(key);
                }
                setDeviceParameterRuntimeWriteOwner(trackId, deviceId, paramId, owner);
            };
        },
    };
}
