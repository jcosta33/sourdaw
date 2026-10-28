import { isBuiltinSynthDevice, isDrumDevice } from '#/utils/deviceTypeMatching';

import type { TrackChannelStrip } from '../models/AudioEngineState';
import type { RuntimeGraphDeltaNode } from '../models/RuntimeGraphDelta';

/** Exact topology comparison shared by graph writes and read-only discharge proofs. */
export function matchesRuntimeDeviceChainTopology(
    strip: Pick<TrackChannelStrip, 'trackId' | 'deviceNodes'> | undefined,
    expected: RuntimeGraphDeltaNode
): boolean {
    // The project and native topology retain note-scheduled instruments, but
    // their voices feed the strip without occupying persistent Web Audio slots.
    const persistentDevices = expected.devices.filter(
        (device) => !isBuiltinSynthDevice(device.type) && !isDrumDevice(device.type)
    );
    return (
        strip !== undefined &&
        strip.trackId === expected.id &&
        strip.deviceNodes.length === persistentDevices.length &&
        strip.deviceNodes.every((device, index) => {
            const expectedDevice = persistentDevices[index];
            const parameterIds = device.parameterIds ?? [];
            return (
                expectedDevice !== undefined &&
                device.deviceId === expectedDevice.id &&
                device.type === expectedDevice.type &&
                device.externalInstanceId === expectedDevice.externalInstanceId &&
                parameterIds.length === expectedDevice.parameterIds.length &&
                parameterIds.every(
                    (parameterId, parameterIndex) => parameterId === expectedDevice.parameterIds[parameterIndex]
                )
            );
        })
    );
}
