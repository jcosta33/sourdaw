import { getDrumKitDefByIndex } from '#/modules/Synth/useCases';

import { isDrumDevice } from './isDrumDevice';

type DrumKitDef = NonNullable<ReturnType<typeof getDrumKitDefByIndex>>;

export function resolveDrumKitDef(
    devices: { type: string; parameterValues: Record<string, number> }[]
): DrumKitDef | null {
    const kitDevice = devices.find((device) => isDrumDevice(device.type));
    if (!kitDevice) {
        return null;
    }
    const kitIndex = kitDevice.parameterValues.kit ?? kitDevice.parameterValues.kitId ?? 0;
    return getDrumKitDefByIndex(kitIndex);
}
