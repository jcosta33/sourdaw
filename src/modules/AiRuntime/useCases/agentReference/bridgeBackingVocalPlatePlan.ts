import { getPluginById } from '#/modules/Arrangement/useCases';
import { digest } from '#/utils/canonicalDigest';
import { type AppAction } from '#/utils/handlerContract';

import { type MetricNativeLiteralUse, type WorkflowNativeLiteralUse } from '../../models/MetricGoalAdmission';
import { type RuntimeAction } from '../../models/RuntimeAction';
import { type ToolCallResult } from '../../transformers/toolCallParser';
import { getExactAgentActionHash } from '../getExactAgentActionHash';
import { type MetricRequestAuthority } from '../metricGoalContractTypes';
import { readRequestMetricNumbers } from '../readRequestMetricNumbers';

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
          providerKnownTargetIds: string[];
          nativeLiteralUses: WorkflowNativeLiteralUse[];
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
        ...createdPlateProvenance(actions, busId, filterDeviceId, plateDeviceId, values.highPassHz),
        renderTailSeconds: values.renderTailSeconds,
        providerKnownTargetIds: [...removableReverbIds, ...trackIds],
    };
}

/** Join an actual workflow field to one written candidate after final identity materialization. */
export function freezeWorkflowNativeLiteralUses(input: {
    uses: readonly WorkflowNativeLiteralUse[] | undefined;
    actions: readonly AppAction[];
    authority: MetricRequestAuthority | undefined;
    request: string;
}): MetricNativeLiteralUse[] {
    const authority = input.authority;
    if (
        authority === undefined ||
        authority.kind !== 'literal' ||
        authority.origin !== 'configured-joint-intake' ||
        authority.callId === null ||
        authority.turn === null ||
        authority.requestDigest !== digest(input.request.trim())
    ) {
        return [];
    }
    const numbers = readRequestMetricNumbers(input.request);
    return (input.uses ?? []).flatMap((use) => {
        const matches = numbers.filter((candidate) => candidate.unit === use.unit && candidate.value === use.value);
        const action = input.actions[use.actionIndex];
        const owner = input.actions[use.ownerActionIndex];
        const device = input.actions[use.deviceActionIndex];
        if (
            matches.length !== 1 ||
            action?.type !== 'setDeviceParameter' ||
            owner?.type !== 'createBus' ||
            device?.type !== 'addDevice'
        ) {
            return [];
        }
        const candidate = matches[0]!;
        if (
            action.payload.deviceId !== use.deviceId ||
            action.payload.expectedTrackId !== use.ownerId ||
            action.payload.expectedDeviceType !== use.deviceType ||
            action.payload.paramId !== use.paramId ||
            action.payload.value !== use.value ||
            action.payload.valueUnit !== use.unit ||
            owner.payload.busId !== use.ownerId ||
            device.payload.deviceId !== use.deviceId ||
            device.payload.trackId !== use.ownerId ||
            device.payload.deviceType !== use.deviceType
        ) {
            return [];
        }
        return [
            {
                ...use,
                authorityId: authority.authorityId,
                requestDigest: authority.requestDigest,
                candidateId: candidate.candidateId,
                token: candidate.token,
                start: candidate.start,
                actionHash: getExactAgentActionHash({ operation: action.type, arguments: action.payload }),
                ownerActionHash: getExactAgentActionHash({ operation: owner.type, arguments: owner.payload }),
                deviceActionHash: getExactAgentActionHash({ operation: device.type, arguments: device.payload }),
                binding: null,
            },
        ];
    });
}

function createdPlateProvenance(
    actions: readonly RuntimeAction[],
    busId: string,
    filterDeviceId: string,
    plateDeviceId: string,
    highPassHz: number
): Pick<Extract<BridgeBackingVocalPlatePlanResult, { status: 'accepted' }>, 'identities' | 'nativeLiteralUses'> {
    return {
        identities: [
            { actionType: 'createBus', actionOrdinal: 0, busId },
            { actionType: 'addDevice', actionOrdinal: 0, deviceId: filterDeviceId },
            { actionType: 'addDevice', actionOrdinal: 1, deviceId: plateDeviceId },
        ],
        nativeLiteralUses: [
            {
                workflow: 'backing-vocal-plate',
                field: 'highPassHz',
                actionIndex: actions.findIndex(
                    (action) => action.type === 'setDeviceParameter' && action.payload.paramId === 'filter-cutoff'
                ),
                ownerActionIndex: actions.findIndex((action) => action.type === 'createBus'),
                deviceActionIndex: actions.findIndex((action) => action.type === 'addDevice'),
                ownerId: busId,
                deviceId: filterDeviceId,
                deviceType: 'builtin-filter',
                paramId: 'filter-cutoff',
                unit: 'Hz',
                value: highPassHz,
            },
        ],
    };
}
