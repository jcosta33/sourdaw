import { type DeviceSnapshot } from '#/utils/handlerContract';

import { clampDeviceParameterValue } from '../../models/DeviceParameterLaw';
import { type SoundPreset } from '../../models/SoundPreset';

function hasUniqueIds(values: readonly string[]): boolean {
    return new Set(values).size === values.length;
}

function hasBoundedId(value: string): boolean {
    return value.length > 0 && value.length <= 128;
}

function canonicalParameters(
    deviceType: string,
    values: Readonly<Record<string, number>>
): Record<string, number> | null {
    const entries = Object.entries(values).sort(([left], [right]) => left.localeCompare(right));
    if (entries.some(([parameterId, value]) => !hasBoundedId(parameterId) || !Number.isFinite(value))) {
        return null;
    }
    return Object.fromEntries(
        entries.map(([parameterId, value]) => [
            parameterId,
            clampDeviceParameterValue({ deviceType, paramId: parameterId, value }),
        ])
    );
}

/** Rechecks a command snapshot against the authoritative catalog without trusting caller values or ids. */
export function matchesMaterializedPresetDevices(preset: SoundPreset, devices: readonly DeviceSnapshot[]): boolean {
    if (preset.devices.length !== devices.length || !hasUniqueIds(devices.map((device) => device.id))) {
        return false;
    }
    return preset.devices.every((presetDevice, index) => {
        const device = devices[index];
        const parameterValues = canonicalParameters(presetDevice.type, presetDevice.parameterValues);
        if (!device || !parameterValues) {
            return false;
        }
        const parameterIds = Object.keys(parameterValues);
        return (
            hasBoundedId(device.id) &&
            device.name === presetDevice.name &&
            device.type === presetDevice.type &&
            device.bypassed === false &&
            Object.keys(device.parameterValues).length === parameterIds.length &&
            parameterIds.every((parameterId) => device.parameterValues[parameterId] === parameterValues[parameterId])
        );
    });
}
