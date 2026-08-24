import { getPluginById } from '#/modules/Arrangement/useCases';

import { type AgentRunScope } from '../../models/AgentRun';
import { type RuntimeAction } from '../../models/RuntimeAction';
import { type ToolCallResult } from '../../transformers/toolCallParser';

import { type BatchLocalActionIdentity } from './BatchLocalActionIdentity';
import { getSharedVocalFxBusesPromptScope } from './getSharedVocalFxBusesPromptScope';

type BridgeSharedVocalFxBusesPlanInput = {
    calls: readonly ToolCallResult[];
    context: Parameters<typeof getSharedVocalFxBusesPromptScope>[0];
    selected: boolean;
};

type BridgeSharedVocalFxBusesPlanResult =
    | { status: 'none' }
    | { status: 'rejected'; reason: string }
    | {
          status: 'accepted';
          actions: RuntimeAction[];
          identities: BatchLocalActionIdentity[];
          verifiedProviderProposalScope: AgentRunScope;
      };

function valuesEqual(left: unknown, right: unknown): boolean {
    if (Object.is(left, right)) {
        return true;
    }
    if (Array.isArray(left) || Array.isArray(right)) {
        return (
            Array.isArray(left) &&
            Array.isArray(right) &&
            left.length === right.length &&
            left.every((value, index) => valuesEqual(value, right[index]))
        );
    }
    if (typeof left !== 'object' || left === null || typeof right !== 'object' || right === null) {
        return false;
    }
    const leftRecord = left as Record<string, unknown>;
    const rightRecord = right as Record<string, unknown>;
    const leftKeys = Object.keys(leftRecord).toSorted();
    const rightKeys = Object.keys(rightRecord).toSorted();
    return (
        leftKeys.length === rightKeys.length &&
        leftKeys.every((key, index) => key === rightKeys[index] && valuesEqual(leftRecord[key], rightRecord[key]))
    );
}

export function bridgeSharedVocalFxBusesPlan({
    calls,
    context,
    selected,
}: BridgeSharedVocalFxBusesPlanInput): BridgeSharedVocalFxBusesPlanResult {
    if (!selected) {
        return { status: 'none' };
    }
    const scope = getSharedVocalFxBusesPromptScope(context);
    if (scope.status === 'invalid') {
        return { status: 'rejected', reason: scope.reason };
    }
    if (!valuesEqual(calls, scope.capability.orderedToolPlan)) {
        return {
            status: 'rejected',
            reason: 'Provider plan does not match the selected shared vocal-effects workflow',
        };
    }

    const groupIdentities = scope.capability.effectGroups.map((group) => ({
        group,
        busId: `bus-ai-${crypto.randomUUID()}`,
        deviceId: `device-ai-${crypto.randomUUID()}`,
    }));
    const remainingDeviceIdsByTrack = new Map(
        context.tracks.map((track) => [track.id, track.devices.map((device) => device.id)] as const)
    );
    const sourceActions = scope.capability.effectGroups.flatMap((group) =>
        group.sources.flatMap((source) => {
            const owners = context.tracks.filter((track) =>
                track.devices.some((device) => device.id === source.deviceId)
            );
            const owner = owners.length === 1 ? owners[0] : undefined;
            const expectedDeviceIds = owner ? remainingDeviceIdsByTrack.get(owner.id) : undefined;
            if (
                !owner ||
                owner.id !== source.trackId ||
                owner.gain !== source.originalGain ||
                !expectedDeviceIds?.includes(source.deviceId)
            ) {
                return [];
            }
            remainingDeviceIdsByTrack.set(
                owner.id,
                expectedDeviceIds.filter((candidate) => candidate !== source.deviceId)
            );
            return [
                {
                    type: 'removeDevice' as const,
                    payload: {
                        deviceId: source.deviceId,
                        expectedTrackId: owner.id,
                        expectedDeviceIds,
                    },
                },
                {
                    type: 'setTrackGain' as const,
                    payload: { trackId: owner.id, gain: source.targetGain },
                },
            ];
        })
    );
    const expectedSourceActionCount = scope.capability.effectGroups.reduce(
        (count, group) => count + group.sources.length * 2,
        0
    );
    if (sourceActions.length !== expectedSourceActionCount) {
        return { status: 'rejected', reason: 'EX-08 removal targets are not uniquely owned by the current project' };
    }
    const actions: RuntimeAction[] = [
        ...sourceActions,
        ...groupIdentities.flatMap(({ group, busId, deviceId }) => {
            const descriptor = getPluginById(group.deviceType);
            if (!descriptor) {
                return [];
            }
            const targetParameters = [
                ...group.sharedParameterValues.map(({ parameterId, value }) => ({ parameterId, value })),
                { parameterId: group.mixParameterId, value: 1 },
            ];
            const parameterActions = targetParameters.flatMap(({ parameterId, value }) => {
                const parameter = descriptor.parameters.find((candidate) => candidate.id === parameterId);
                if (!parameter || !Number.isFinite(parameter.defaultValue)) {
                    return [];
                }
                if (Object.is(parameter.defaultValue, value)) {
                    return [];
                }
                return [
                    {
                        type: 'setDeviceParameter' as const,
                        payload: {
                            deviceId,
                            paramId: parameterId,
                            value,
                            expectedTrackId: busId,
                            expectedDeviceType: group.deviceType,
                            expectedDeviceIds: [deviceId],
                            expectedValue: parameter.defaultValue,
                            expectedTrackFrozen: false,
                        },
                    },
                ];
            });
            if (
                parameterActions.length !==
                targetParameters.filter(({ parameterId, value }) => {
                    const parameter = descriptor.parameters.find((candidate) => candidate.id === parameterId);
                    return parameter && !Object.is(parameter.defaultValue, value);
                }).length
            ) {
                return [];
            }
            return [
                { type: 'createBus' as const, payload: { name: group.busName } },
                { type: 'addDevice' as const, payload: { trackId: busId, deviceType: group.deviceType } },
                ...parameterActions,
            ];
        }),
        ...groupIdentities.flatMap(({ group, busId }) =>
            group.sources.map((source) => ({
                type: 'addSend' as const,
                payload: {
                    trackId: source.trackId,
                    busId,
                    level: source.sendLevel,
                    preFader: source.preFader,
                    expectedAbsent: true as const,
                },
            }))
        ),
    ];
    const expectedActionCount =
        sourceActions.length +
        scope.capability.effectGroups.reduce((count, group) => {
            const descriptor = getPluginById(group.deviceType);
            if (!descriptor) {
                return count;
            }
            const targets = [
                ...group.sharedParameterValues.map(({ parameterId, value }) => ({ parameterId, value })),
                { parameterId: group.mixParameterId, value: 1 },
            ];
            const changedTargets = targets.filter(({ parameterId, value }) => {
                const parameter = descriptor.parameters.find((candidate) => candidate.id === parameterId);
                return parameter && !Object.is(parameter.defaultValue, value);
            }).length;
            return count + 2 + changedTargets + group.sources.length;
        }, 0);
    if (actions.length !== expectedActionCount) {
        return { status: 'rejected', reason: 'EX-08 device parameter descriptors are incomplete' };
    }
    return {
        status: 'accepted',
        actions,
        identities: groupIdentities.flatMap(({ busId, deviceId }, index) => [
            { actionType: 'createBus' as const, actionOrdinal: index, busId, initialGain: 1 },
            { actionType: 'addDevice' as const, actionOrdinal: index, deviceId },
        ]),
        verifiedProviderProposalScope: {
            targetIds: [
                ...new Set(
                    scope.capability.effectGroups.flatMap((group) =>
                        group.sources.flatMap((source) => [source.deviceId, source.trackId])
                    )
                ),
            ],
            targetRanges: [],
            protectedTargetIds: scope.capability.protectedObjects.map((target) => target.id),
            protectedRanges: [],
        },
    };
}
