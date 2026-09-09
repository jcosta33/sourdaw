import { type ProjectContext } from '../../models/ProjectContext';
import { type RuntimeAction, type RuntimeActionType } from '../../models/RuntimeAction';
import { type LlmActionRejection, type SectionPlanningSignature } from '../llmActionBridgeContracts';
import { type ToolCallResult } from '../toolCallParser';

import {
    findAvailableDeviceType,
    findDevice,
    findDeviceTarget,
    findTrack,
    hasExactKeys,
    isFiniteNumber,
    isValidParameterValue,
    rejection,
} from './bridgeArgumentGuards';
import { createLlmActionStrategyRegistry } from './createLlmActionStrategyRegistry';

export const deviceActionNames = [
    'addDevice',
    'removeDevice',
    'bypassDevice',
    'setDeviceParameter',
    'createDrumPreviewBranches',
] as const satisfies readonly Extract<RuntimeActionType, string>[];

export type DeviceCallName = (typeof deviceActionNames)[number];

type DeviceStrategyInput = {
    call: ToolCallResult;
    context: ProjectContext;
    index: number;
    sectionSignatures: readonly SectionPlanningSignature[];
};

type DeviceStrategy<Name extends DeviceCallName> = (
    input: DeviceStrategyInput
) => Extract<RuntimeAction, { type: Name }> | LlmActionRejection;

type DeviceStrategyDefinition<Name extends DeviceCallName> = {
    [StrategyName in Name]: {
        name: StrategyName;
        transform: DeviceStrategy<StrategyName>;
    };
}[Name];

const deviceStrategyDefinitions = [
    {
        name: 'addDevice',
        transform: ({ call, context, index }) => {
            const args = call.arguments;
            const track = findTrack(context, args.trackId);
            const deviceType = findAvailableDeviceType(context, args.deviceType);
            const hasSupportedKeys =
                hasExactKeys(args, ['trackId', 'deviceType']) ||
                hasExactKeys(args, ['trackId', 'deviceType', 'afterDeviceId']);
            let afterDevice;
            if (typeof args.afterDeviceId === 'string') {
                afterDevice = track?.devices.find((device) => device.id === args.afterDeviceId);
            }
            if (
                !hasSupportedKeys ||
                !track ||
                track.kind === 'vca' ||
                track.frozen === true ||
                !deviceType ||
                (args.afterDeviceId !== undefined && !afterDevice)
            ) {
                return rejection(
                    index,
                    call.name,
                    'Expected a non-frozen device-capable track, one platform-available built-in device type, and an optional anchor device on that track'
                );
            }
            return {
                type: 'addDevice',
                payload: {
                    trackId: track.id,
                    deviceType: deviceType.id,
                    ...(afterDevice ? { afterDeviceId: afterDevice.id } : {}),
                },
            };
        },
    },
    {
        name: 'removeDevice',
        transform: ({ call, context, index }) => {
            const args = call.arguments;
            const target = findDeviceTarget(context, args.deviceId);
            if (!hasExactKeys(args, ['deviceId']) || !target) {
                return rejection(index, call.name, 'Expected one existing deviceId');
            }
            return { type: 'removeDevice', payload: { deviceId: target.device.id } };
        },
    },
    {
        name: 'setDeviceParameter',
        transform: ({ call, context, index }) => {
            const args = call.arguments;
            if (
                !hasExactKeys(args, ['deviceId', 'paramId', 'value']) ||
                typeof args.deviceId !== 'string' ||
                typeof args.paramId !== 'string' ||
                !isFiniteNumber(args.value)
            ) {
                return rejection(index, call.name, 'Expected an available device parameter and finite value');
            }
            const target = findDeviceTarget(context, args.deviceId);
            const parameter = (target?.device.parameters ?? []).find((candidate) => candidate.id === args.paramId);
            if (
                !target ||
                target.track.frozen === true ||
                !parameter ||
                !isValidParameterValue(parameter, args.value)
            ) {
                return rejection(
                    index,
                    call.name,
                    'Expected a descriptor-backed parameter value within project bounds'
                );
            }
            return {
                type: 'setDeviceParameter',
                payload: {
                    deviceId: target.device.id,
                    paramId: parameter.id,
                    value: args.value,
                    expectedTrackId: target.track.id,
                    expectedDeviceType: target.device.type,
                    expectedDeviceIds: target.track.devices.map((device) => device.id),
                    expectedValue: parameter.value,
                    expectedTrackFrozen: false,
                },
            };
        },
    },
    {
        name: 'bypassDevice',
        transform: ({ call, context, index }) => {
            const args = call.arguments;
            if (
                !hasExactKeys(args, ['deviceId', 'bypassed']) ||
                !findDevice(context, args.deviceId) ||
                typeof args.deviceId !== 'string' ||
                typeof args.bypassed !== 'boolean'
            ) {
                return rejection(index, call.name, 'Expected an available deviceId and boolean bypassed value');
            }
            return { type: 'bypassDevice', payload: { deviceId: args.deviceId, bypassed: args.bypassed } };
        },
    },
    {
        name: 'createDrumPreviewBranches',
        transform: ({ call, index, sectionSignatures }) => {
            const args = call.arguments;
            const varyingRoles = args.varyingRoles;
            const sectionMatches = sectionSignatures.filter(({ sectionId }) => sectionId === args.sectionId);
            if (
                !hasExactKeys(args, ['sectionId', 'candidateCount', 'varyingRoles']) ||
                typeof args.sectionId !== 'string' ||
                sectionMatches.length !== 1 ||
                args.candidateCount !== 3 ||
                !Array.isArray(varyingRoles) ||
                varyingRoles.length !== 2 ||
                varyingRoles[0] !== 'snare' ||
                varyingRoles[1] !== 'hi-hat'
            ) {
                return rejection(
                    index,
                    call.name,
                    'Expected one exact section, exactly three candidates, and ordered Snare then Hi-Hat variation roles'
                );
            }
            return {
                type: 'createDrumPreviewBranches',
                payload: {
                    sectionId: args.sectionId,
                    candidateCount: 3,
                    varyingRoles: ['snare', 'hi-hat'],
                },
            };
        },
    },
] as const satisfies readonly DeviceStrategyDefinition<DeviceCallName>[];

export const deviceStrategyRegistry = createLlmActionStrategyRegistry<
    DeviceCallName,
    DeviceStrategyInput,
    RuntimeAction | LlmActionRejection
>(deviceStrategyDefinitions, deviceActionNames);

function isDeviceCallName(value: string): value is DeviceCallName {
    return deviceActionNames.some((actionName) => actionName === value);
}

export function bridgeDeviceToolCall(input: DeviceStrategyInput): RuntimeAction | LlmActionRejection | null {
    if (!isDeviceCallName(input.call.name)) {
        return null;
    }
    const strategy = deviceStrategyRegistry.get(input.call.name);
    if (!strategy) {
        throw new Error(`Missing LLM action strategy: ${input.call.name}`);
    }
    return strategy(input);
}
