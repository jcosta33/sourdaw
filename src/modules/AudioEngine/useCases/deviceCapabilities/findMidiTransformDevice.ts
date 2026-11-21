import { isMidiTransformDevice } from './isMidiTransformDevice';

/** The first MIDI-transform device on a chain, or undefined when the chain holds none. */
export function findMidiTransformDevice<Device extends Readonly<{ type: string }>>(
    devices: readonly Device[]
): Device | undefined {
    return devices.find((device) => isMidiTransformDevice(device.type));
}
