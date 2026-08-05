import { estimateRenderTailSeconds, type TailDeclarationLike } from '../../services/estimateRenderTailSeconds';

import { projectDeviceTails } from './projectDeviceTails';

export type GetDeviceChainTailSecondsInput = {
    devices: ReadonlyArray<{
        id: string;
        type: string;
        parameterValues: Record<string, number>;
        deviceState?: unknown;
        bypassed: boolean;
    }>;
    tailForDeviceType: (deviceType: string) => TailDeclarationLike | undefined;
    automationLanes?: ReadonlyArray<{ parameterId: string; enabled?: boolean }>;
};

/**
 * How long one device chain keeps sounding after its last input.
 *
 * This exists so there is exactly **one** implementation of "evaluate what a
 * chain's declarations add up to". There used to be two answers: the export path
 * evaluated each device's `DeviceTailDeclaration`, while freeze sized its render
 * from a substring test on the device type (`includes('reverb') ||
 * includes('delay')` → 8 beats, else 4) that no descriptor fed. The two could not
 * agree, and freeze's copy silently truncated any tail device whose id contained
 * neither word — the Dutch Oven and Bacteria among them — and shortened every
 * tail as the session's tempo rose, because beats are not seconds.
 *
 * Both callers now evaluate the same declarations through the same estimator, so
 * adding a tail-producing device means writing its declaration and nothing else.
 */
export function getDeviceChainTailSeconds({
    devices,
    tailForDeviceType,
    automationLanes,
}: GetDeviceChainTailSecondsInput): ReturnType<typeof estimateRenderTailSeconds> {
    return estimateRenderTailSeconds([
        { devices: projectDeviceTails({ devices, automationLanes, tailForDeviceType }) },
    ]);
}
