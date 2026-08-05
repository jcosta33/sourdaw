import { getDeviceAutomationParameterId, resolveDeviceAutomationTargetIndex } from '#/utils/automationDeviceTarget';

import { type TailDeclarationLike } from '../../services/estimateRenderTailSeconds';

type DeviceChainEntry = {
    id: string;
    type: string;
    parameterValues: Record<string, number>;
    deviceState?: unknown;
    bypassed: boolean;
};

export type ProjectDeviceTailsInput = {
    devices: ReadonlyArray<DeviceChainEntry>;
    automationLanes?: ReadonlyArray<{ parameterId: string; enabled?: boolean }>;
    /**
     * Resolves a device type to its declared tail. Injected rather than looked
     * up here: the descriptors live in Arrangement's models, and AudioEngine
     * importing Arrangement's use-case barrel closes a module cycle. The caller,
     * which sits downstream of both, supplies the lookup.
     */
    tailForDeviceType: (deviceType: string) => TailDeclarationLike | undefined;
};

function declarationUsesAutomatedGate(tail: TailDeclarationLike | undefined, parameterId: string): boolean {
    if (!tail) {
        return false;
    }
    if (tail.kind === 'parallel') {
        return tail.tails.some((child) => declarationUsesAutomatedGate(child, parameterId));
    }
    return tail.kind === 'stateFeedbackLoop' && tail.automatableEnabledParameterId === parameterId;
}

/**
 * Carry each device's declared tail from its descriptor into the estimator's
 * shape.
 *
 * One function rather than a line inlined at each call site, because the number
 * of places that answer "how long does this chain ring?" is exactly the number
 * of answers that can disagree. Freeze used to answer it with a substring test
 * on the device type that no descriptor fed; that is the defect this seam
 * exists to make unrepeatable.
 */
export function projectDeviceTails({ devices, automationLanes = [], tailForDeviceType }: ProjectDeviceTailsInput) {
    const projected = devices.map((device) => ({
        id: device.id,
        type: device.type,
        parameterValues: device.parameterValues,
        deviceState: device.deviceState,
        bypassed: device.bypassed,
        tail: tailForDeviceType(device.type),
    }));

    const automatedParameterIds = projected.map(() => new Set<string>());
    for (const lane of automationLanes) {
        if (lane.enabled === false) {
            continue;
        }
        const deviceIndex = resolveDeviceAutomationTargetIndex(lane.parameterId, projected, (device, parameterId) => {
            return (
                device.parameterValues[parameterId] !== undefined &&
                declarationUsesAutomatedGate(device.tail, parameterId)
            );
        });
        if (deviceIndex < 0) {
            continue;
        }
        const parameterId = getDeviceAutomationParameterId(lane.parameterId);
        if (parameterId) {
            automatedParameterIds[deviceIndex]?.add(parameterId);
        }
    }

    return projected.map((device, index) => ({
        ...device,
        automatedParameterIds: Array.from(automatedParameterIds[index] ?? []),
    }));
}
