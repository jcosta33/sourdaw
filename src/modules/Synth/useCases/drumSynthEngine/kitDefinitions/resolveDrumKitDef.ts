import { getDrumKitIndex, isDrumDevice } from '#/utils/deviceTypeMatching';

import { getDrumKitDefByIndex } from './getDrumKitDefByIndex';

type DrumKitDef = NonNullable<ReturnType<typeof getDrumKitDefByIndex>>;

/**
 * The dedicated kit definition a track's drum device plays, for every drum
 * device type. Live playback and offline render both resolve through this one
 * function so an export voices the same kit the musician heard.
 */
export function resolveDrumKitDef(
    devices: { type: string; parameterValues: Record<string, number> }[]
): DrumKitDef | null {
    const kitDevice = devices.find((device) => isDrumDevice(device.type));
    if (!kitDevice) {
        return null;
    }
    return getDrumKitDefByIndex(getDrumKitIndex(kitDevice.parameterValues));
}
