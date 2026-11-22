import { getPluginById } from '#/modules/Arrangement/useCases';

import { type RuntimeAction } from '../../models/RuntimeAction';
import { type ToolCallResult } from '../../transformers/toolCallParser';

import { type BatchLocalActionIdentity } from './BatchLocalActionIdentity';
import { getDrumRenderComparisonPromptScope } from './getDrumRenderComparisonPromptScope';

type BridgeDrumRenderComparisonPlanInput = {
    calls: readonly ToolCallResult[];
    context: Parameters<typeof getDrumRenderComparisonPromptScope>[0];
    selected: boolean;
};

type BridgeDrumRenderComparisonPlanResult =
    | { status: 'none' }
    | { status: 'rejected'; reason: string }
    | {
          status: 'accepted';
          actions: RuntimeAction[];
          identities: BatchLocalActionIdentity[];
          renderTailSeconds: number;
          providerKnownTargetIds: string[];
      };

const AUTO_MAKEUP_PARAM_ID = 'comp-auto-makeup';

/** The Auto Makeup value a placed compressor starts with: its declared default. */
function readPlacedAutoMakeup(deviceType: string): number | undefined {
    return getPluginById(deviceType)?.parameters.find((parameter) => parameter.id === AUTO_MAKEUP_PARAM_ID)
        ?.defaultValue;
}

/**
 * A placed compressor starts with Auto Makeup off; this workflow's parallel gain was voiced with
 * the browser's makeup gain in the output, so it turns the switch on (ADR 0064).
 */
function setAutoMakeup(input: {
    deviceId: string;
    busId: string;
    deviceType: string;
    value: number;
    placedValue: number;
}): RuntimeAction {
    return {
        type: 'setDeviceParameter',
        payload: {
            deviceId: input.deviceId,
            paramId: AUTO_MAKEUP_PARAM_ID,
            value: input.value,
            expectedTrackId: input.busId,
            expectedDeviceType: input.deviceType,
            expectedDeviceIds: [input.deviceId],
            expectedValue: input.placedValue,
            expectedTrackFrozen: false,
        },
    };
}

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

export function bridgeDrumRenderComparisonPlan({
    calls,
    context,
    selected,
}: BridgeDrumRenderComparisonPlanInput): BridgeDrumRenderComparisonPlanResult {
    if (!selected) {
        return { status: 'none' };
    }
    const scope = getDrumRenderComparisonPromptScope(context);
    if (scope.status === 'invalid') {
        return { status: 'rejected', reason: scope.reason };
    }
    if (!valuesEqual(calls, scope.capability.orderedToolPlan)) {
        return { status: 'rejected', reason: 'Provider plan does not match the selected EX-11 workflow' };
    }

    const autoMakeupDefault = readPlacedAutoMakeup(scope.capability.fixedValues.compressorDeviceType);
    if (autoMakeupDefault === undefined) {
        return { status: 'rejected', reason: 'EX-11 Compressor Auto Makeup descriptor is unavailable' };
    }

    const drumBusId = `bus-ai-${crypto.randomUUID()}`;
    const parallelBusId = `bus-ai-${crypto.randomUUID()}`;
    const compressorDeviceId = `device-ai-${crypto.randomUUID()}`;
    const fixed = scope.capability.fixedValues;
    const actions: RuntimeAction[] = [
        { type: 'createBus', payload: { name: fixed.drumBusName } },
        ...scope.capability.closeDrums.map((track) => ({
            type: 'setTrackOutput' as const,
            payload: {
                trackId: track.trackId,
                outputId: drumBusId,
                expectedOutputId: track.currentOutputId,
            },
        })),
        { type: 'createBus', payload: { name: fixed.parallelBusName } },
        { type: 'addDevice', payload: { trackId: parallelBusId, deviceType: fixed.compressorDeviceType } },
        setAutoMakeup({
            deviceId: compressorDeviceId,
            busId: parallelBusId,
            deviceType: fixed.compressorDeviceType,
            value: fixed.compressorAutoMakeup,
            placedValue: autoMakeupDefault,
        }),
        {
            type: 'addSend',
            payload: {
                trackId: drumBusId,
                busId: parallelBusId,
                level: fixed.sendLevel,
                preFader: fixed.sendPreFader,
                expectedAbsent: true,
            },
        },
        { type: 'setTrackGain', payload: { trackId: parallelBusId, gain: fixed.parallelGain } },
        {
            type: 'renderProjectSections',
            payload: { sectionIds: scope.capability.renderSections.map((section) => section.sectionId) },
        },
    ];
    return {
        status: 'accepted',
        actions,
        identities: [
            {
                actionType: 'createBus',
                actionOrdinal: 0,
                busId: drumBusId,
                initialGain: 1,
                expectedAbsentTrackNames: [fixed.drumBusName, fixed.parallelBusName],
                expectedTrackOutputs: [
                    { trackId: scope.capability.room.trackId, outputId: scope.capability.room.currentOutputId },
                ],
            },
            { actionType: 'createBus', actionOrdinal: 1, busId: parallelBusId, initialGain: 1 },
            { actionType: 'addDevice', actionOrdinal: 0, deviceId: compressorDeviceId },
        ],
        renderTailSeconds: fixed.renderTailSeconds,
        providerKnownTargetIds: scope.capability.closeDrums.map((track) => track.trackId),
    };
}
