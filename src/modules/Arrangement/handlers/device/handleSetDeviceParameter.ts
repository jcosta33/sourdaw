import { updateDeviceParam } from '#/modules/AudioEngine/useCases';
import { captureAutomationRecordingRollback } from '#/modules/Automation/useCases';
import { createHandler } from '#/utils/createHandler';
import { type HandlerValidationContext } from '#/utils/handlerContract';
import { runAllEffects } from '#/utils/runEffects';

import { getPluginById } from '../../models/DeviceParameter';
import { clampDeviceParameterValue } from '../../models/DeviceParameterLaw';
import { setDeviceParameter } from '../../useCases/device/setDeviceParameter/setDeviceParameter';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { getPlannedTrackState } from '../getPlannedTrackState';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

function hasExecutionGuards(action: {
    payload: {
        expectedTrackId?: string;
        expectedDeviceType?: string;
        expectedDeviceIds?: readonly string[];
        expectedValue?: number;
        expectedValuePresent?: boolean;
        expectedTrackFrozen?: boolean;
    };
}): boolean {
    return (
        action.payload.expectedTrackId !== undefined ||
        action.payload.expectedDeviceType !== undefined ||
        action.payload.expectedDeviceIds !== undefined ||
        action.payload.expectedValue !== undefined ||
        action.payload.expectedValuePresent !== undefined ||
        action.payload.expectedTrackFrozen !== undefined
    );
}

function executionGuardsMatch(
    action: {
        payload: {
            deviceId: string;
            paramId: string;
            expectedTrackId?: string;
            expectedDeviceType?: string;
            expectedDeviceIds?: readonly string[];
            expectedValue?: number;
            expectedValuePresent?: boolean;
            expectedTrackFrozen?: boolean;
        };
    },
    context?: HandlerValidationContext
): boolean {
    if (!hasExecutionGuards(action)) {
        return true;
    }
    const currentTracks = getTrackStoreState()?.tracks ?? [];
    const candidateTrackIds = new Set(currentTracks.map((track) => track.id));
    for (const priorAction of context?.actions.slice(0, context.actionIndex) ?? []) {
        if (priorAction.type === 'addTrack' && priorAction.payload.id) {
            candidateTrackIds.add(priorAction.payload.id);
        }
        if (priorAction.type === 'createBus' && priorAction.payload.busId) {
            candidateTrackIds.add(priorAction.payload.busId);
        }
    }
    const owners = [...candidateTrackIds]
        .map((trackId) =>
            context ? getPlannedTrackState(context, trackId) : currentTracks.find((track) => track.id === trackId)
        )
        .filter((track) => track?.devices.some((device) => device.id === action.payload.deviceId));
    const owner = owners.length === 1 ? (owners[0] ?? undefined) : undefined;
    const device = owner?.devices.find((candidate) => candidate.id === action.payload.deviceId);
    const currentDeviceIds = owner?.devices.map((candidate) => candidate.id);
    const valuePresent = device ? Object.hasOwn(device.parameterValues, action.payload.paramId) : false;
    return (
        owner !== undefined &&
        device !== undefined &&
        (action.payload.expectedTrackId === undefined || owner.id === action.payload.expectedTrackId) &&
        (action.payload.expectedDeviceType === undefined || device.type === action.payload.expectedDeviceType) &&
        (action.payload.expectedDeviceIds === undefined ||
            (action.payload.expectedDeviceIds.length === currentDeviceIds?.length &&
                action.payload.expectedDeviceIds.every((deviceId, index) => currentDeviceIds[index] === deviceId))) &&
        (action.payload.expectedValuePresent === undefined || action.payload.expectedValuePresent === valuePresent) &&
        (action.payload.expectedValue === undefined ||
            (valuePresent && device.parameterValues[action.payload.paramId] === action.payload.expectedValue)) &&
        (action.payload.expectedTrackFrozen === undefined || owner.frozen === action.payload.expectedTrackFrozen)
    );
}

function handleGuardedSetDeviceParameter(action: {
    payload: { deviceId: string; paramId: string; value: number; deleteParameter?: boolean };
}) {
    if (!executionGuardsMatch(action)) {
        return { status: 'conflict' as const };
    }
    let didWrite: boolean;
    if (action.payload.deleteParameter) {
        didWrite = setDeviceParameter(action.payload.deviceId, action.payload.paramId, action.payload.value, {
            deleteParameter: true,
        });
    } else {
        didWrite = setDeviceParameter(action.payload.deviceId, action.payload.paramId, action.payload.value);
    }
    return toHandlerExecutionResult(didWrite);
}

function formatParameterValue(value: number, unit: string): string {
    if (unit === ':1') {
        return `${String(value)}:1`;
    }
    if (unit) {
        return `${String(value)} ${unit}`;
    }
    return String(value);
}

function describeParameterOutcome(input: { deviceId: string; paramId: string; value: number }): string | null {
    const owners = (getTrackStoreState()?.tracks ?? []).filter((track) =>
        track.devices.some((device) => device.id === input.deviceId)
    );
    const owner = owners.length === 1 ? owners[0] : undefined;
    const device = owner?.devices.find((candidate) => candidate.id === input.deviceId);
    const previousValue = device?.parameterValues[input.paramId];
    if (!owner || !device || previousValue === undefined) {
        return null;
    }
    const parameter = getPluginById(device.type)?.parameters.find((candidate) => candidate.id === input.paramId);
    if (!parameter) {
        return null;
    }
    const committedValue = clampDeviceParameterValue({
        deviceType: device.type,
        paramId: input.paramId,
        value: input.value,
    });
    return `Set "${owner.name}" (${owner.id}) device "${device.name}" (${device.id}, ${device.type}) parameter "${parameter.name}" (${parameter.id}) from ${formatParameterValue(previousValue, parameter.unit)} to ${formatParameterValue(committedValue, parameter.unit)}`;
}

function createRuntimeParameterRollbackFailure(input: {
    deviceId: string;
    error: unknown;
    paramId: string;
    trackId: string;
}): Error {
    const detail = input.error instanceof Error ? input.error.message : String(input.error);
    return new Error(
        `Runtime parameter rollback failed for ${input.trackId}/${input.deviceId}/${input.paramId}; manual repair is required: ${detail}`,
        { cause: input.error }
    );
}

export const handleSetDeviceParameter = createHandler<'setDeviceParameter'>({
    validate: (action, context) => executionGuardsMatch(action, context),
    prepareAbort: (action) => {
        const rollbackAutomationRecording = captureAutomationRecordingRollback();
        const owner = getTrackStoreState()?.tracks.find((track) =>
            track.devices.some((device) => device.id === action.payload.deviceId)
        );
        const previousValue = owner?.devices.find((device) => device.id === action.payload.deviceId)?.parameterValues[
            action.payload.paramId
        ];
        const parameter = owner?.devices.find((device) => device.id === action.payload.deviceId)?.type;
        const defaultValue = parameter
            ? getPluginById(parameter)?.parameters.find((candidate) => candidate.id === action.payload.paramId)
                  ?.defaultValue
            : undefined;
        return () => {
            const effects: Array<() => void> = [rollbackAutomationRecording];
            const runtimeRollbackValue = previousValue ?? defaultValue;
            if (owner && runtimeRollbackValue !== undefined) {
                effects.unshift(() => {
                    try {
                        updateDeviceParam(
                            owner.id,
                            action.payload.deviceId,
                            action.payload.paramId,
                            runtimeRollbackValue
                        );
                    } catch (error) {
                        throw createRuntimeParameterRollbackFailure({
                            deviceId: action.payload.deviceId,
                            error,
                            paramId: action.payload.paramId,
                            trackId: owner.id,
                        });
                    }
                });
            }
            runAllEffects(effects);
        };
    },
    execute: handleGuardedSetDeviceParameter,
    isNoop: (action) => {
        if (!executionGuardsMatch(action)) {
            return false;
        }
        const device = getTrackStoreState()
            ?.tracks.flatMap((track) => track.devices)
            .find((candidate) => candidate.id === action.payload.deviceId);
        if (action.payload.deleteParameter) {
            return device !== undefined && !Object.hasOwn(device.parameterValues, action.payload.paramId);
        }
        return device?.parameterValues[action.payload.paramId] === action.payload.value;
    },
    describe: (alpha) => {
        const state = getTrackStoreState();
        const owner = state?.tracks.find((track) =>
            track.devices.some((device) => device.id === alpha.payload.deviceId)
        );
        const prev = owner?.devices.find((device) => device.id === alpha.payload.deviceId);
        const previousValue = prev?.parameterValues[alpha.payload.paramId];
        const previousValuePresent = prev ? Object.hasOwn(prev.parameterValues, alpha.payload.paramId) : false;
        const parameter = prev
            ? getPluginById(prev.type)?.parameters.find((candidate) => candidate.id === alpha.payload.paramId)
            : undefined;
        const exactLabel = describeParameterOutcome(alpha.payload);
        const expectedPreviousValue = alpha.payload.expectedValue ?? previousValue ?? parameter?.defaultValue;
        const expectedPreviousValuePresent =
            alpha.payload.expectedValuePresent ??
            (alpha.payload.expectedValue === undefined ? previousValuePresent : true);
        const expectedTrackId = alpha.payload.expectedTrackId ?? owner?.id;
        const expectedDeviceType = alpha.payload.expectedDeviceType ?? prev?.type;
        const expectedDeviceIds = alpha.payload.expectedDeviceIds ?? owner?.devices.map((device) => device.id);
        const expectedTrackFrozen = alpha.payload.expectedTrackFrozen ?? owner?.frozen;
        const committedValue = expectedDeviceType
            ? clampDeviceParameterValue({
                  deviceType: expectedDeviceType,
                  paramId: alpha.payload.paramId,
                  value: alpha.payload.value,
              })
            : undefined;
        return {
            label: exactLabel ?? `Set ${alpha.payload.paramId}`,
            inverseAction:
                expectedTrackId &&
                expectedDeviceType &&
                expectedDeviceIds &&
                expectedPreviousValue !== undefined &&
                committedValue !== undefined
                    ? {
                          type: 'setDeviceParameter',
                          payload: {
                              deviceId: alpha.payload.deviceId,
                              paramId: alpha.payload.paramId,
                              value: expectedPreviousValue,
                              expectedTrackId,
                              expectedDeviceType,
                              expectedDeviceIds: [...expectedDeviceIds],
                              expectedValue: committedValue,
                              expectedValuePresent: true,
                              ...(expectedTrackFrozen === undefined ? {} : { expectedTrackFrozen }),
                              ...(expectedPreviousValuePresent ? {} : { deleteParameter: true }),
                          },
                      }
                    : null,
            redoAction:
                expectedTrackId &&
                expectedDeviceType &&
                expectedDeviceIds &&
                expectedPreviousValue !== undefined &&
                committedValue !== undefined
                    ? {
                          type: 'setDeviceParameter',
                          payload: {
                              deviceId: alpha.payload.deviceId,
                              paramId: alpha.payload.paramId,
                              value: committedValue,
                              expectedTrackId,
                              expectedDeviceType,
                              expectedDeviceIds: [...expectedDeviceIds],
                              expectedValue: expectedPreviousValuePresent ? expectedPreviousValue : undefined,
                              expectedValuePresent: expectedPreviousValuePresent,
                              ...(expectedTrackFrozen === undefined ? {} : { expectedTrackFrozen }),
                          },
                      }
                    : undefined,
        };
    },
    previewExecution: 'unsupported-external',
    undoable: true,
    requiresAbortCompensation: false,
});
