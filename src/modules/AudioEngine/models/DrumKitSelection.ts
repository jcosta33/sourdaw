import { dbToGain } from '#/utils/audioLevelLaw';

import { isDrumDevice } from './NoteInputKindByDeviceType';

type DrumKitDeviceValues = { type: string; parameterValues: Record<string, number> };

function findDrumDevice(devices: readonly DrumKitDeviceValues[]): DrumKitDeviceValues | undefined {
    return devices.find((device) => isDrumDevice(device.type));
}

/**
 * The one drum-kit resolution live playback and offline render both run:
 * the first drum device on the chain selects the kit by its `kit` parameter
 * (the legacy `kitId` when absent, index 0 when neither is set), and `lookup`
 * maps that index to the caller's kit shape. Null when the chain has no drum
 * device or `lookup` knows no kit at that index.
 *
 * Callers differ only in `lookup` — the dedicated drum-voice definitions or
 * the factory kit table — so the device test and the index rule cannot drift
 * between the live scheduler and an export.
 */
export function resolveDrumKitBy<Kit>(
    devices: readonly DrumKitDeviceValues[],
    lookup: (kitIndex: number) => Kit | null
): Kit | null {
    const kitDevice = findDrumDevice(devices);
    if (!kitDevice) {
        return null;
    }
    return lookup(kitDevice.parameterValues.kit ?? kitDevice.parameterValues.kitId ?? 0);
}

/**
 * The `level` default the drum-kit descriptor declares (`builtin-drum-kit`,
 * inherited by every drum-machine variant), in dB. A kit that stores no level
 * plays at unity, which is how every kit played before it had a level, so a
 * project saved before the control existed sounds unchanged.
 *
 * The kit's former unitless `gain` is retired, not migrated: nothing ever read
 * it, so a stored value describes no sound anyone heard, and reading it now
 * would change saved mixes. No route reads it.
 */
export const DRUM_KIT_DEFAULT_LEVEL_DB = 0;

/**
 * One drum device's output gain: its `level` in dB as a linear multiplier of
 * every hit the kit plays, applied after velocity and clip gain have set it.
 */
export function readDrumKitOutputGain(device: { parameterValues: Record<string, number> }): number {
    return dbToGain(device.parameterValues.level ?? DRUM_KIT_DEFAULT_LEVEL_DB);
}

/**
 * The output gain of the drum device `resolveDrumKitBy` selects the kit from,
 * so every route levels a kit by the same device that chose it.
 */
export function resolveDrumKitOutputGain(devices: readonly DrumKitDeviceValues[]): number {
    const kitDevice = findDrumDevice(devices);
    return kitDevice ? readDrumKitOutputGain(kitDevice) : dbToGain(DRUM_KIT_DEFAULT_LEVEL_DB);
}
