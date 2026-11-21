import { resolveDrumKitOutputGain as resolveFirstDrumDeviceOutputGain } from '../../models/DrumKitSelection';

/** The output gain of the drum device the kit is selected from. */
export function resolveDrumKitOutputGain(
    devices: readonly { type: string; parameterValues: Record<string, number> }[]
): number {
    return resolveFirstDrumDeviceOutputGain(devices);
}
