import { isDeviceReleaseAdmitted } from '#/infra/release/deviceReleaseAdmission';
import { type DeviceSnapshot } from '#/utils/handlerContract';

import { type SoundPreset } from '../../models/SoundPreset';

import { canonicalPresetDeviceParameters } from './canonicalPresetDeviceParameters';

function nextId(prefix: string): string {
    return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

function hasUniqueIds(values: readonly string[]): boolean {
    return new Set(values).size === values.length;
}

function hasBoundedId(value: string): boolean {
    return value.length > 0 && value.length <= 128;
}

/** Builds a stable project shape from catalog data; presentation never supplies device values. */
export function materializePresetDevices(preset: SoundPreset): readonly DeviceSnapshot[] | null {
    if (preset.devices.length === 0 || preset.devices.length > 64) {
        return null;
    }
    const devices = preset.devices.map((device): DeviceSnapshot | null => {
        if (
            !hasBoundedId(device.type) ||
            !isDeviceReleaseAdmitted(device.type) ||
            !device.name.trim() ||
            device.name.length > 256
        ) {
            return null;
        }
        const parameterValues = canonicalPresetDeviceParameters(device.type, device.parameterValues);
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
