import { type DeviceSnapshot } from '#/utils/handlerContract';

import { clampDeviceParameterValue } from '../../models/DeviceParameterLaw';
import { type SoundPreset } from '../../models/SoundPreset';

function nextId(prefix: string): string {
    return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

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

/** Builds a stable project shape from catalog data; presentation never supplies device values. */
export function materializePresetDevices(preset: SoundPreset): readonly DeviceSnapshot[] | null {
    if (preset.devices.length === 0 || preset.devices.length > 64) {
        return null;
    }
    const devices = preset.devices.map((device): DeviceSnapshot | null => {
        if (!hasBoundedId(device.type) || !device.name.trim() || device.name.length > 256) {
            return null;
        }
        const parameterValues = canonicalParameters(device.type, device.parameterValues);
        if (!parameterValues) {
            return null;
        }
        return {
            id: nextId('preset-device'),
            name: device.name,
            type: device.type,
            bypassed: false,
            parameterValues,
        };
    });
    if (devices.some((device) => device === null)) {
        return null;
    }
    const materialized = devices as DeviceSnapshot[];
    return hasUniqueIds(materialized.map((device) => device.id)) ? materialized : null;
}
