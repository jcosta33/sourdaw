import {
    deviceParameterRuntimeWriteOwners,
    pendingDeviceParameterRuntimeWriteOwners,
    deviceParameterRuntimeWriteSequences,
} from '../../stores/deviceParameterRuntimeWriteOwners';
import { nativeBuiltinBody } from '../livePlayback/nativeBuiltinBodies';
import { deviceTypeOnStrip } from './deviceTypeOnStrip';

export function deviceParameterRuntimeWriteParameterId(trackId: string, deviceId: string, paramId: string): string {
    const type = deviceTypeOnStrip(trackId, deviceId);
    return (type ? nativeBuiltinBody(type)?.parameterName(paramId) : undefined) ?? paramId;
}

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

type WriteContext = { trackId: string; deviceId: string; paramId: string; owner: symbol | undefined };
const writeContexts: WriteContext[] = [];
let nextWrite = 0;
const completedWrites = deviceParameterRuntimeWriteSequences;

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
            const sequence = ++nextWrite;
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
