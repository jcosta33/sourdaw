import { readDrumKitOutputGain as readDrumDeviceOutputGain } from '../../models/DrumKitSelection';

/** One drum device's output gain: its `level` in dB as a linear multiplier. */
export function readDrumKitOutputGain(device: { parameterValues: Record<string, number> }): number {
    return readDrumDeviceOutputGain(device);
}
