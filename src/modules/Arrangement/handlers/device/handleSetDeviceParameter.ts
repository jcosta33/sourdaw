import { updateDeviceParam } from '#/modules/AudioEngine/useCases';
import { captureAutomationRecordingRollback } from '#/modules/Automation/useCases';
import { createHandler } from '#/utils/createHandler';
import { runAllEffects } from '#/utils/runEffects';

import { getPluginById } from '../../models/DeviceParameter';
import { clampDeviceParameterValue } from '../../models/DeviceParameterLaw';
import { setDeviceParameter } from '../../useCases/device/setDeviceParameter/setDeviceParameter';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

function hasExecutionGuards(action: {
    payload: {
        expectedTrackId?: string;
        expectedDeviceType?: string;
        expectedDeviceIds?: readonly string[];
        expectedValue?: number;
        expectedTrackFrozen?: boolean;
    };
}): boolean {
    return (
        action.payload.expectedTrackId !== undefined ||
        action.payload.expectedDeviceType !== undefined ||
        action.payload.expectedDeviceIds !== undefined ||
        action.payload.expectedValue !== undefined ||
        action.payload.expectedTrackFrozen !== undefined
    );
}

function executionGuardsMatch(action: {
    payload: {
        deviceId: string;
        paramId: string;
        expectedTrackId?: string;
        expectedDeviceType?: string;
        expectedDeviceIds?: readonly string[];
        expectedValue?: number;
        expectedTrackFrozen?: boolean;
    };
}): boolean {
    if (!hasExecutionGuards(action)) {
        return true;
    }
    const owners = (getTrackStoreState()?.tracks ?? []).filter((track) =>
        track.devices.some((device) => device.id === action.payload.deviceId)
    );
    const owner = owners.length === 1 ? owners[0] : undefined;
    const device = owner?.devices.find((candidate) => candidate.id === action.payload.deviceId);
    const currentDeviceIds = owner?.devices.map((candidate) => candidate.id);
    return (
        owner !== undefined &&
        device !== undefined &&
        (action.payload.expectedTrackId === undefined || owner.id === action.payload.expectedTrackId) &&
        (action.payload.expectedDeviceType === undefined || device.type === action.payload.expectedDeviceType) &&
        (action.payload.expectedDeviceIds === undefined ||
            (action.payload.expectedDeviceIds.length === currentDeviceIds?.length &&
                action.payload.expectedDeviceIds.every((deviceId, index) => currentDeviceIds[index] === deviceId))) &&
        (action.payload.expectedValue === undefined ||
            device.parameterValues[action.payload.paramId] === action.payload.expectedValue) &&
        (action.payload.expectedTrackFrozen === undefined || owner.frozen === action.payload.expectedTrackFrozen)
    );
}

function handleGuardedSetDeviceParameter(action: { payload: { deviceId: string; paramId: string; value: number } }) {
    if (!executionGuardsMatch(action)) {
        return { status: 'conflict' as const };
    }
    return toHandlerExecutionResult(
        setDeviceParameter(action.payload.deviceId, action.payload.paramId, action.payload.value)
    );
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
    prepareAbort: (action) => {
        const rollbackAutomationRecording = captureAutomationRecordingRollback();
        const owner = getTrackStoreState()?.tracks.find((track) =>
            track.devices.some((device) => device.id === action.payload.deviceId)
        );
        const previousValue = owner?.devices.find((device) => device.id === action.payload.deviceId)?.parameterValues[
            action.payload.paramId
        ];
        return () => {
            const effects: Array<() => void> = [rollbackAutomationRecording];
            if (owner && previousValue !== undefined) {
                effects.unshift(() => {
                    try {
                        updateDeviceParam(owner.id, action.payload.deviceId, action.payload.paramId, previousValue);
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
    execute: (alpha) => handleGuardedSetDeviceParameter(alpha),
    isNoop: (action) => {
        if (!executionGuardsMatch(action)) {
            return false;
        }
        return (
            getTrackStoreState()
                ?.tracks.flatMap((track) => track.devices)
                .find((device) => device.id === action.payload.deviceId)?.parameterValues[action.payload.paramId] ===
            action.payload.value
        );
    },
    describe: (alpha) => {
        const state = getTrackStoreState();
        const owner = state?.tracks.find((track) =>
            track.devices.some((device) => device.id === alpha.payload.deviceId)
        );
        const prev = owner?.devices.find((device) => device.id === alpha.payload.deviceId);
        const previousValue = prev?.parameterValues[alpha.payload.paramId];
        const exactLabel = describeParameterOutcome(alpha.payload);
        const expectedPreviousValue = alpha.payload.expectedValue ?? previousValue;
        const expectedTrackId = alpha.payload.expectedTrackId ?? owner?.id;
        const expectedDeviceType = alpha.payload.expectedDeviceType ?? prev?.type;
        const expectedDeviceIds = alpha.payload.expectedDeviceIds ?? owner?.devices.map((device) => device.id);
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
                              expectedTrackFrozen: alpha.payload.expectedTrackFrozen ?? owner?.frozen,
                          },
                      }
                    : null,
        };
    },
    undoable: true,
    requiresAbortCompensation: false,
});
