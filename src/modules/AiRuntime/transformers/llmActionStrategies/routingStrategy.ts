import { wouldCreateRoutingCycle } from '#/utils/routingCycle';

import { type ProjectContext } from '../../models/ProjectContext';
import { type RuntimeAction, type RuntimeActionType } from '../../models/RuntimeAction';
import { normalizeSafeProjectName } from '../../validators/normalizeSafeProjectName';
import { type LlmActionRejection, type SidechainRouteDeviceAdmission } from '../llmActionBridgeContracts';
import { type ToolCallResult } from '../toolCallParser';

import {
    findProviderOutputTarget,
    findSend,
    findSidechainRoutes,
    findSupportedSidechainDevices,
    findTrack,
    hasExactKeys,
    isFiniteNumber,
    isProviderRoutableSource,
    rejection,
} from './bridgeArgumentGuards';
import { createLlmActionStrategyRegistry } from './createLlmActionStrategyRegistry';

export const routingActionNames = [
    'createBus',
    'addSend',
    'removeSend',
    'setSend',
    'addSidechainRoute',
    'removeSidechainRoute',
] as const satisfies readonly Extract<RuntimeActionType, string>[];

export type RoutingCallName = (typeof routingActionNames)[number];

type RoutingStrategyInput = {
    call: ToolCallResult;
    context: ProjectContext;
    index: number;
    sidechainRouteDeviceAdmissions: readonly SidechainRouteDeviceAdmission[];
};

type RoutingStrategy<Name extends RoutingCallName> = (
    input: RoutingStrategyInput
) => Extract<RuntimeAction, { type: Name }> | LlmActionRejection;

type RoutingStrategyDefinition<Name extends RoutingCallName> = {
    [StrategyName in Name]: {
        name: StrategyName;
        transform: RoutingStrategy<StrategyName>;
    };
}[Name];

const routingStrategyDefinitions = [
    {
        name: 'createBus',
        transform: ({ call, index }) => {
            const args = call.arguments;
            const name = normalizeSafeProjectName(args.name);
            if (!hasExactKeys(args, ['name']) || !name) {
                return rejection(
                    index,
                    call.name,
                    'Expected only a non-empty bus name no longer than 120 characters without framing or control characters'
                );
            }
            return { type: 'createBus', payload: { name } };
        },
    },
    {
        name: 'setSend',
        transform: ({ call, context, index }) => {
            const args = call.arguments;
            const source = findTrack(context, args.trackId);
            const bus = findProviderOutputTarget(context, args.busId);
            const existing = findSend(context, args.trackId, args.busId);
            if (
                !hasExactKeys(args, ['trackId', 'busId', 'level']) ||
                !isProviderRoutableSource(source) ||
                bus?.kind !== 'bus' ||
                source.id === bus.id ||
                !existing ||
                !isFiniteNumber(args.level) ||
                args.level < 0 ||
                args.level > 1
            ) {
                return rejection(
                    index,
                    call.name,
                    'Expected an available source track, distinct bus track, and finite level from 0 through 1'
                );
            }
            return {
                type: 'setSend',
                payload: {
                    trackId: source.id,
                    busId: bus.id,
                    level: args.level,
                    expectedLevel: existing.level,
                    expectedPreFader: existing.preFader,
                },
            };
        },
    },
    {
        name: 'addSend',
        transform: ({ call, context, index }) => {
            const args = call.arguments;
            const source = findTrack(context, args.trackId);
            const bus = findProviderOutputTarget(context, args.busId);
            const existing = findSend(context, args.trackId, args.busId);
            if (
                !hasExactKeys(args, ['trackId', 'busId', 'level']) ||
                !isProviderRoutableSource(source) ||
                bus?.kind !== 'bus' ||
                source.id === bus.id ||
                existing ||
                !isFiniteNumber(args.level) ||
                args.level < 0 ||
                args.level > 1
            ) {
                return rejection(
                    index,
                    call.name,
                    'Expected an available source, a distinct bus without an existing send, and a finite level from 0 through 1'
                );
            }
            if (
                wouldCreateRoutingCycle({
                    sourceId: source.id,
                    targetId: bus.id,
                    tracks: context.tracks,
                    sidechainRoutes: context.sidechainRoutes ?? [],
                })
            ) {
                return rejection(index, call.name, 'Expected a new acyclic send route');
            }
            return {
                type: 'addSend',
                payload: { trackId: source.id, busId: bus.id, level: args.level, expectedAbsent: true },
            };
        },
    },
    {
        name: 'removeSend',
        transform: ({ call, context, index }) => {
            const args = call.arguments;
            const source = findTrack(context, args.trackId);
            const bus = findProviderOutputTarget(context, args.busId);
            const existing = findSend(context, args.trackId, args.busId);
            if (
                !hasExactKeys(args, ['trackId', 'busId']) ||
                !isProviderRoutableSource(source) ||
                bus?.kind !== 'bus' ||
                !existing
            ) {
                return rejection(index, call.name, 'Expected an existing send from an available source to a bus');
            }
            return {
                type: 'removeSend',
                payload: {
                    trackId: source.id,
                    busId: bus.id,
                    expectedLevel: existing.level,
                    expectedPreFader: existing.preFader,
                },
            };
        },
    },
    {
        name: 'addSidechainRoute',
        transform: ({ call, context, index, sidechainRouteDeviceAdmissions }) => {
            const args = call.arguments;
            const source = findTrack(context, args.sourceTrackId);
            const target = findTrack(context, args.targetTrackId);
            const hasSupportedKeys =
                hasExactKeys(args, ['sourceTrackId', 'targetTrackId']) ||
                hasExactKeys(args, ['sourceTrackId', 'targetTrackId', 'targetDeviceId']);
            if (
                !hasSupportedKeys ||
                !isProviderRoutableSource(source) ||
                !isProviderRoutableSource(target) ||
                source.id === target.id
            ) {
                return rejection(index, call.name, 'Expected two distinct routable source and target tracks');
            }
            if (
                args.targetDeviceId !== undefined &&
                !sidechainRouteDeviceAdmissions.some(
                    (admission) =>
                        admission.sourceTrackId === source.id &&
                        admission.targetTrackId === target.id &&
                        admission.targetDeviceId === args.targetDeviceId
                )
            ) {
                return rejection(index, call.name, 'targetDeviceId requires an exact application-owned capability');
            }
            const supportedDevices = findSupportedSidechainDevices(target);
            let targetDevice = supportedDevices.find((device) => device.id === args.targetDeviceId);
            if (args.targetDeviceId === undefined && supportedDevices.length === 1) {
                targetDevice = supportedDevices[0];
            }
            if (!targetDevice) {
                return rejection(
                    index,
                    call.name,
                    'Expected one exact supported sidechain compressor on the target track'
                );
            }
            const duplicate = (context.sidechainRoutes ?? []).some(
                (route) => route.sourceTrackId === source.id && route.targetDeviceId === targetDevice.id
            );
            const closesCycle = wouldCreateRoutingCycle({
                sourceId: source.id,
                targetId: target.id,
                tracks: context.tracks,
                sidechainRoutes: context.sidechainRoutes ?? [],
            });
            if (duplicate || closesCycle) {
                return rejection(index, call.name, 'Expected a new acyclic sidechain route');
            }
            return {
                type: 'addSidechainRoute',
                payload: {
                    sourceTrackId: source.id,
                    targetTrackId: target.id,
                    ...(args.targetDeviceId === undefined ? {} : { targetDeviceId: targetDevice.id }),
                },
            };
        },
    },
    {
        name: 'removeSidechainRoute',
        transform: ({ call, context, index }) => {
            const args = call.arguments;
            const source = findTrack(context, args.sourceTrackId);
            const target = findTrack(context, args.targetTrackId);
            if (
                !hasExactKeys(args, ['sourceTrackId', 'targetTrackId']) ||
                !isProviderRoutableSource(source) ||
                !isProviderRoutableSource(target) ||
                source.id === target.id
            ) {
                return rejection(index, call.name, 'Expected two distinct routable source and target tracks');
            }
            const matches = findSidechainRoutes(context, source.id, target.id);
            if (matches.length !== 1) {
                return rejection(index, call.name, 'Expected exactly one existing sidechain route between the tracks');
            }
            return {
                type: 'removeSidechainRoute',
                payload: { sourceTrackId: source.id, targetTrackId: target.id },
            };
        },
    },
] as const satisfies readonly RoutingStrategyDefinition<RoutingCallName>[];

export const routingStrategyRegistry = createLlmActionStrategyRegistry<
    RoutingCallName,
    RoutingStrategyInput,
    RuntimeAction | LlmActionRejection
>(routingStrategyDefinitions, routingActionNames);

function isRoutingCallName(value: string): value is RoutingCallName {
    return routingActionNames.some((actionName) => actionName === value);
}

export function bridgeRoutingToolCall(input: RoutingStrategyInput): RuntimeAction | LlmActionRejection | null {
    if (!isRoutingCallName(input.call.name)) {
        return null;
    }
    const strategy = routingStrategyRegistry.get(input.call.name);
    if (!strategy) {
        throw new Error(`Missing LLM action strategy: ${input.call.name}`);
    }
    return strategy(input);
}
