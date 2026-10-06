import { getDrumKitByIndex } from '#/modules/AudioEngine/useCases';
import { resolveDrumKitBy } from '#/utils/deviceTypeMatching';

type SynthParams = NonNullable<ReturnType<typeof getDrumKitByIndex>>['voices'][number]['params'];

type DrumKit = {
    id: string;
    name: string;
    voices: Array<{ name: string; pitchRange: [number, number]; params: SynthParams }>;
};

export function resolveDrumKit(devices: { type: string; parameterValues: Record<string, number> }[]): DrumKit | null {
    return resolveDrumKitBy(devices, getDrumKitByIndex);
}
