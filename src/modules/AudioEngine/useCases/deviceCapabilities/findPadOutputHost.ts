import { hostsPadOutputs } from './hostsPadOutputs';

/** The first pad-output host on a chain, or undefined when the chain holds none. */
export function findPadOutputHost<Device extends Readonly<{ type: string }>>(
    devices: readonly Device[]
): Device | undefined {
    return devices.find((device) => hostsPadOutputs(device.type));
}
