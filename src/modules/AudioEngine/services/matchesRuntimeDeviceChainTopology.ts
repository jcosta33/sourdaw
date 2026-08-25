import type { TrackChannelStrip } from '../models/AudioEngineState';
import type { RuntimeGraphDeltaNode } from '../models/RuntimeGraphDelta';

/** Exact topology comparison shared by graph writes and read-only discharge proofs. */
export function matchesRuntimeDeviceChainTopology(
    strip: Pick<TrackChannelStrip, 'trackId' | 'deviceNodes'> | undefined,
    expected: RuntimeGraphDeltaNode
): boolean {
    return (
        strip !== undefined &&
        strip.trackId === expected.id &&
        strip.deviceNodes.length === expected.devices.length &&
        strip.deviceNodes.every((device, index) => {
            const expectedDevice = expected.devices[index];
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
