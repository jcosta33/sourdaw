import { isRecord } from '#/utils/structuralEquality';

import { type PlannedDeviceOwnerSource } from './PlannedDeviceWrite';
import { type Device, type DeviceStateChunk, type DeviceStateValue } from './Track';

function readValue(value: unknown): DeviceStateValue | undefined {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') {
        return value;
    }
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : undefined;
    }
    if (Array.isArray(value)) {
        const result: DeviceStateValue[] = [];
        for (const item of value) {
            const parsed = readValue(item);
            if (parsed === undefined) {
                return undefined;
            }
            result.push(parsed);
        }
        return result;
    }
    if (!isRecord(value)) {
        return undefined;
    }
    return readRecord(value) ?? undefined;
}

function readRecord(value: Record<string, unknown>): Record<string, DeviceStateValue> | null {
    const entries: Array<[string, DeviceStateValue]> = [];
    for (const [key, item] of Object.entries(value)) {
        const parsed = readValue(item);
        if (parsed === undefined) {
            return null;
        }
        entries.push([key, parsed]);
    }
    return Object.fromEntries(entries);
}

function readChunk(value: unknown): DeviceStateChunk | null {
    if (
        !isRecord(value) ||
        typeof value.version !== 'number' ||
        !Number.isFinite(value.version) ||
        !isRecord(value.data)
    ) {
        return null;
    }
    const data = readRecord(value.data);
    if (!data) {
        return null;
    }
    return { version: value.version, data };
}

function readDevice(item: unknown): Device | null {
    if (
        !isRecord(item) ||
        typeof item.id !== 'string' ||
        typeof item.type !== 'string' ||
        typeof item.name !== 'string' ||
        typeof item.bypassed !== 'boolean' ||
        !isRecord(item.parameterValues)
    ) {
        return null;
    }
    const parameters: Array<[string, number]> = [];
    for (const [key, entry] of Object.entries(item.parameterValues)) {
        if (typeof entry !== 'number' || !Number.isFinite(entry)) {
            return null;
        }
        parameters.push([key, entry]);
    }
    const device: Device = {
        id: item.id,
        type: item.type,
        name: item.name,
        bypassed: item.bypassed,
        parameterValues: Object.fromEntries(parameters),
    };
    if (Object.hasOwn(item, 'deviceState')) {
        const chunk = readChunk(item.deviceState);
        if (!chunk) {
            return null;
        }
        device.deviceState = chunk;
    }
    for (const key of ['externalPluginId', 'externalInstanceId', 'externalStateChunk'] as const) {
        if (Object.hasOwn(item, key)) {
            const entry = item[key];
            if (typeof entry !== 'string') {
                return null;
            }
            device[key] = entry;
        }
    }
    return device;
}

/** Decode only the current owner fields planning reads; no defaults or snapshot migration. */
export function readPlannedDeviceOwnerSource(value: unknown): PlannedDeviceOwnerSource | null {
    if (
        !isRecord(value) ||
        typeof value.id !== 'string' ||
        !Array.isArray(value.devices) ||
        (Object.hasOwn(value, 'frozen') && typeof value.frozen !== 'boolean')
    ) {
        return null;
    }
    const devices: Device[] = [];
    for (const item of value.devices) {
        const device = readDevice(item);
        if (!device) {
            return null;
        }
        devices.push(device);
    }
    const owner: PlannedDeviceOwnerSource = { id: value.id, devices };
    if (typeof value.frozen === 'boolean') {
        owner.frozen = value.frozen;
    }
    return owner;
}
