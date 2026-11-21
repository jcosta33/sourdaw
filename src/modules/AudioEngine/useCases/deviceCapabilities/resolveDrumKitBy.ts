import { resolveDrumKitBy as resolveKitOfFirstDrumDevice } from '../../models/DrumKitSelection';

/** The kit the first drum device on the chain selects, mapped through the caller's `lookup`. */
export function resolveDrumKitBy<Kit>(
    devices: readonly { type: string; parameterValues: Record<string, number> }[],
    lookup: (kitIndex: number) => Kit | null
): Kit | null {
    return resolveKitOfFirstDrumDevice(devices, lookup);
}
