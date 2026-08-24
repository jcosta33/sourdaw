import { getPluginById } from '#/modules/Arrangement/useCases';

import { type AgentRunScope } from '../../models/AgentRun';
import { type RuntimeAction } from '../../models/RuntimeAction';
import { type ToolCallResult } from '../../transformers/toolCallParser';

import { type BatchLocalActionIdentity } from './BatchLocalActionIdentity';
import { getBackingVocalPlatePromptScope } from './getBackingVocalPlatePromptScope';

type BridgeBackingVocalPlatePlanInput = {
    calls: readonly ToolCallResult[];
    context: Parameters<typeof getBackingVocalPlatePromptScope>[0];
    selected: boolean;
};

type BridgeBackingVocalPlatePlanResult =
    | { status: 'none' }
    | { status: 'rejected'; reason: string }
    | {
          status: 'accepted';
          actions: RuntimeAction[];
          identities: BatchLocalActionIdentity[];
          renderTailSeconds: number;
          verifiedProviderProposalScope: AgentRunScope;
      };

const EX_01_ONLY_TOOL_NAMES = new Set(['automateSendRanges', 'renderProjectSections']);

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

function getDefaultParameterValue(deviceType: string, parameterId: string): number | null {
    const parameter = getPluginById(deviceType)?.parameters.find((candidate) => candidate.id === parameterId);
    if (!parameter || !Number.isFinite(parameter.defaultValue)) {
        return null;
    }
    return parameter.defaultValue;
}

export function bridgeBackingVocalPlatePlan({
    calls,
    context,
    selected,
}: BridgeBackingVocalPlatePlanInput): BridgeBackingVocalPlatePlanResult {
    if (!selected) {
        const restrictedCall = calls.find((call) => EX_01_ONLY_TOOL_NAMES.has(call.name));
        if (restrictedCall) {
            return {
                status: 'rejected',
                reason: `${restrictedCall.name} is available only through the selected backing-vocal plate workflow`,
            };
        }
        return { status: 'none' };
    }
    const scope = getBackingVocalPlatePromptScope(context);
    if (scope.status === 'invalid') {
        return { status: 'rejected', reason: scope.reason };
    }
    if (!valuesEqual(calls, scope.capability.orderedToolPlan)) {
        return {
            status: 'rejected',
            reason: 'Provider plan does not match the selected backing-vocal plate workflow',
        };
    }

    const filterTypeDefault = getDefaultParameterValue('builtin-filter', 'filter-type');
    const cutoffDefault = getDefaultParameterValue('builtin-filter', 'filter-cutoff');
    if (filterTypeDefault === null || cutoffDefault === null) {
        return { status: 'rejected', reason: 'EX-01 Filter parameter descriptors are unavailable' };
    }

    const busId = `bus-ai-${crypto.randomUUID()}`;
    const filterDeviceId = `device-ai-${crypto.randomUUID()}`;
    const plateDeviceId = `device-ai-${crypto.randomUUID()}`;
    const values = scope.capability.fixedValues;
    const removableReverbIds = scope.capability.backingVocals.flatMap((track) => track.removableReverbDeviceIds);
    const trackIds = scope.capability.backingVocals.map((track) => track.trackId);
    const sectionIds = scope.capability.chorusSections.map((section) => section.sectionId);
    const actions: RuntimeAction[] = [
        ...removableReverbIds.map((deviceId) => ({ type: 'removeDevice' as const, payload: { deviceId } })),
        { type: 'createBus', payload: { name: values.busName } },
        { type: 'addDevice', payload: { trackId: busId, deviceType: values.filterDeviceType } },
        {
            type: 'setDeviceParameter',
            payload: {
                deviceId: filterDeviceId,
                paramId: 'filter-type',
                value: values.filterType,
                expectedTrackId: busId,
                expectedDeviceType: values.filterDeviceType,
                expectedDeviceIds: [filterDeviceId],
                expectedValue: filterTypeDefault,
                expectedTrackFrozen: false,
            },
        },
        {
            type: 'setDeviceParameter',
            payload: {
                deviceId: filterDeviceId,
                paramId: 'filter-cutoff',
                value: values.highPassHz,
                expectedTrackId: busId,
                expectedDeviceType: values.filterDeviceType,
                expectedDeviceIds: [filterDeviceId],
                expectedValue: cutoffDefault,
                expectedTrackFrozen: false,
            },
        },
        {
            type: 'addDevice',
            payload: { trackId: busId, deviceType: values.plateDeviceType, afterDeviceId: filterDeviceId },
        },
        ...trackIds.map((trackId) => ({
            type: 'addSend' as const,
            payload: {
                trackId,
                busId,
                level: values.sendLevel,
                preFader: values.sendPreFader,
                expectedAbsent: true as const,
            },
        })),
        {
            type: 'automateSendRanges',
            payload: {
                trackIds,
                busId,
                sectionIds,
                tailBars: values.automationTailBars,
                targetLevelDb: values.automationTargetLevelDb,
            },
        },
        { type: 'renderProjectSections', payload: { sectionIds } },
    ];
    return {
        status: 'accepted',
        actions,
        identities: [
            { actionType: 'createBus', actionOrdinal: 0, busId },
            { actionType: 'addDevice', actionOrdinal: 0, deviceId: filterDeviceId },
            { actionType: 'addDevice', actionOrdinal: 1, deviceId: plateDeviceId },
        ],
        renderTailSeconds: values.renderTailSeconds,
        verifiedProviderProposalScope: {
            targetIds: [...removableReverbIds, ...trackIds],
            targetRanges: scope.capability.chorusSections.map((section) => ({
                startBeat: section.startBeat,
                endBeat: section.endBeat,
            })),
            protectedTargetIds: scope.capability.protectedObjects.map((object) => object.id),
            protectedRanges: [],
        },
    };
}
