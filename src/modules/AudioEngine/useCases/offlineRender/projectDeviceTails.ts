import { getDeviceAutomationParameterId, resolveDeviceAutomationTargetIndex } from '#/utils/automationDeviceTarget';

import { isEngineHostedPluginDeviceType } from '../../repositories/deviceStrategy/isEngineHostedPluginDeviceType';
import { type TailDeclarationLike } from '../../services/estimateRenderTailSeconds';

import { readHostedPluginTail } from './hostedPluginTail';

type DeviceChainEntry = {
    id: string;
    type: string;
    parameterValues: Record<string, number>;
    deviceState?: unknown;
    bypassed: boolean;
    externalInstanceId?: string;
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
    /**
     * The tail a hosted plugin instance reported about itself. A hosted device
     * declares none by type — every one spells `external-plugin` — so its tail
     * is its instance's. Defaults to the live report PluginHost records.
     */
    tailForHostedInstance?: (externalInstanceId: string) => TailDeclarationLike | undefined;
};

function deviceTail(
    device: DeviceChainEntry,
    tailForDeviceType: ProjectDeviceTailsInput['tailForDeviceType'],
    tailForHostedInstance: NonNullable<ProjectDeviceTailsInput['tailForHostedInstance']>
): TailDeclarationLike | undefined {
    if (isEngineHostedPluginDeviceType(device.type) && device.externalInstanceId !== undefined) {
        return tailForHostedInstance(device.externalInstanceId);
    }
    return tailForDeviceType(device.type);
}

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
export function projectDeviceTails({
    devices,
    automationLanes = [],
    tailForDeviceType,
    tailForHostedInstance = readHostedPluginTail,
}: ProjectDeviceTailsInput) {
    const projected = devices.map((device) => ({
        id: device.id,
        type: device.type,
        parameterValues: device.parameterValues,
        deviceState: device.deviceState,
        bypassed: device.bypassed,
        tail: deviceTail(device, tailForDeviceType, tailForHostedInstance),
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
