import { getDrumKitDefByIndex } from '#/modules/Synth/useCases';
import { resolveDrumKitBy } from '#/utils/deviceTypeMatching';

type DrumKitDef = NonNullable<ReturnType<typeof getDrumKitDefByIndex>>;

export function resolveDrumKitDef(
    devices: { type: string; parameterValues: Record<string, number> }[]
): DrumKitDef | null {
    return resolveDrumKitBy(devices, getDrumKitDefByIndex);
}
