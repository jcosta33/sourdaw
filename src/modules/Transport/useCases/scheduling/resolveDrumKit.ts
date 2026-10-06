import { getDrumKitByIndex } from '#/modules/AudioEngine/useCases';
import { getDrumKitIndex } from '#/utils/deviceTypeMatching';

import { isDrumDevice } from './isDrumDevice';

type SynthParams = NonNullable<ReturnType<typeof getDrumKitByIndex>>['voices'][number]['params'];

type DrumKit = {
    id: string;
    name: string;
    voices: Array<{ name: string; pitchRange: [number, number]; params: SynthParams }>;
};

export function resolveDrumKit(devices: { type: string; parameterValues: Record<string, number> }[]): DrumKit | null {
    const kitDevice = devices.find((device) => isDrumDevice(device.type));
    if (!kitDevice) {
        return null;
    }
    return getDrumKitByIndex(getDrumKitIndex(kitDevice.parameterValues));
}
