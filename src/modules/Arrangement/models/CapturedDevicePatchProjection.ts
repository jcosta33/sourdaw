import { type DevicePatchTransitionMetadata, resolveDevicePatchTransition } from '#/utils/resolveDevicePatchTransition';
import { valuesEqual } from '#/utils/structuralEquality';

import { clampDeviceParameterValue } from './DeviceParameterLaw';
import { type DevicePatchState } from './DevicePatchState';
import { type Device, type DeviceStateChunk } from './Track';

function matchesCapturedDeviceState(device: Device, expectedChunk: DevicePatchState['deviceState']): boolean {
    if (expectedChunk === null) {
        return !Object.hasOwn(device, 'deviceState');
    }
    return Object.hasOwn(device, 'deviceState') && valuesEqual(device.deviceState, expectedChunk);
}

function matchesCapturedParameter(parameters: Device['parameterValues'], key: string, previous: unknown): boolean {
    if (previous === null) {
        return !Object.hasOwn(parameters, key);
    }
    return (
        typeof previous === 'number' &&
        Number.isFinite(previous) &&
        Object.hasOwn(parameters, key) &&
        parameters[key] === previous
    );
}

/** Compile one guarded footprint before its owner publishes any field. */
export function projectCapturedDevicePatch(
    device: Device,
    expected: DevicePatchState,
    next: DevicePatchState,
    mode: 'authored' | 'restore-captured' = 'authored'
): Device | null {
    if (!matchesCapturedDeviceState(device, expected.deviceState)) {
        return null;
    }
    const keys = Object.keys(expected.parameterValues);
    const nextKeys = Object.keys(next.parameterValues);
    if (keys.length !== nextKeys.length || keys.some((key) => !Object.hasOwn(next.parameterValues, key))) {
        return null;
    }
    const parameterValues = structuredClone(device.parameterValues);
    for (const key of keys) {
        if (!matchesCapturedParameter(device.parameterValues, key, expected.parameterValues[key])) {
            return null;
        }
        const value = next.parameterValues[key];
        if (value === null) {
            delete parameterValues[key];
            continue;
        }
        if (typeof value !== 'number' || !Number.isFinite(value)) {
            return null;
        }
        parameterValues[key] =
            mode === 'restore-captured'
                ? value
                : clampDeviceParameterValue({ deviceType: device.type, paramId: key, value });
    }
    const { deviceState: previousChunk, ...withoutChunk } = device;
    void previousChunk;
    const nextDevice = { ...withoutChunk, parameterValues };
    if (next.deviceState === null) {
        return nextDevice;
    }
    return { ...nextDevice, deviceState: structuredClone(next.deviceState) };
}

/** Compile an exact write from the projected device's captured leaves. */
export function projectCapturedDevicePatchWithMetadata(
    device: Device,
    expected: DevicePatchState,
    next: DevicePatchState,
    metadata: DevicePatchTransitionMetadata<DeviceStateChunk>
): Device | null {
    if (Object.hasOwn(device, 'deviceState') && device.deviceState === undefined) {
        return null;
    }
    const parameterValues: DevicePatchState['parameterValues'] = {};
    for (const key of Object.keys(expected.parameterValues)) {
        if (!Object.hasOwn(device.parameterValues, key)) {
            parameterValues[key] = null;
            continue;
        }
        const value = device.parameterValues[key];
        if (typeof value !== 'number' || !Number.isFinite(value)) {
            return null;
        }
        parameterValues[key] = value;
    }
    const transition = resolveDevicePatchTransition(
        { deviceState: device.deviceState ?? null, parameterValues },
        expected,
        next,
        metadata
    );
    return transition ? projectCapturedDevicePatch(device, transition.expected, transition.next) : null;
}
