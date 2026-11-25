import { type DevicePatchTransitionMetadata, resolveDevicePatchTransition } from '#/utils/resolveDevicePatchTransition';
import { valuesEqual } from '#/utils/structuralEquality';

import { clampDeviceParameterValue } from './DeviceParameterLaw';
import { type DevicePatchState } from './DevicePatchState';
import { type Device, type DeviceStateChunk } from './Track';

/** Compile one guarded footprint before its owner publishes any field. */
export function projectCapturedDevicePatch(
    device: Device,
    expected: DevicePatchState,
    next: DevicePatchState,
    mode: 'authored' | 'restore-captured' = 'authored'
): Device | null {
    if (
        Object.hasOwn(device, 'deviceState') !== (expected.deviceState !== null) ||
        (expected.deviceState !== null && !valuesEqual(device.deviceState, expected.deviceState))
    ) {
        return null;
    }
    const keys = Object.keys(expected.parameterValues);
    const nextKeys = Object.keys(next.parameterValues);
    if (keys.length !== nextKeys.length || keys.some((key) => !Object.hasOwn(next.parameterValues, key))) {
        return null;
    }
    const parameterValues = structuredClone(device.parameterValues);
    for (const key of keys) {
        const previous = expected.parameterValues[key];
        const value = next.parameterValues[key];
        if (
            (previous !== null && (typeof previous !== 'number' || !Number.isFinite(previous))) ||
            Object.hasOwn(device.parameterValues, key) !== (previous !== null) ||
            (previous !== null && device.parameterValues[key] !== previous)
        ) {
            return null;
        }
        if (value === null) {
            delete parameterValues[key];
        } else if (typeof value === 'number' && Number.isFinite(value)) {
            parameterValues[key] =
                mode === 'restore-captured'
                    ? value
                    : clampDeviceParameterValue({ deviceType: device.type, paramId: key, value });
        } else {
            return null;
        }
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
