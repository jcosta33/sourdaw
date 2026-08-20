import { migrateStoredDeviceParameterValues } from '../../models/StoredDeviceParameterMigration';
import { type Device, type Send, type TrackKind } from '../../models/Track';
import { type TrackTemplate } from '../../models/TrackTemplate';

import { storage } from './helpers';

type UnknownRecord = {
    [key: string]: unknown;
};

const TRACK_KINDS = new Set<string>(['audio', 'midi', 'bus', 'master', 'folder']);

function isRecord(value: unknown): value is UnknownRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isTrackKind(value: unknown): value is TrackKind {
    return typeof value === 'string' && TRACK_KINDS.has(value);
}

function validateStoredParameterValues(value: unknown): Record<string, number> | null {
    if (!isRecord(value)) {
        return null;
    }

    const parameters: Record<string, number> = {};

    for (const [parameterId, parameterValue] of Object.entries(value)) {
        if (typeof parameterValue !== 'number' || !Number.isFinite(parameterValue)) {
            return null;
        }

        parameters[parameterId] = parameterValue;
    }

    return parameters;
}

function validateStoredDevice(value: unknown): Device | null {
    if (!isRecord(value)) {
        return null;
    }

    if (
        typeof value.id !== 'string' ||
        typeof value.name !== 'string' ||
        typeof value.type !== 'string' ||
        typeof value.bypassed !== 'boolean'
    ) {
        return null;
    }

    const parameterValues = validateStoredParameterValues(value.parameterValues);
    if (parameterValues === null) {
        return null;
    }

    if (value.externalPluginId !== undefined && typeof value.externalPluginId !== 'string') {
        return null;
    }

    if (value.externalInstanceId !== undefined && typeof value.externalInstanceId !== 'string') {
        return null;
    }

    if (value.externalStateChunk !== undefined && typeof value.externalStateChunk !== 'string') {
        return null;
    }

    // Carried so a template saved from a device with state reloads with it rather
    // than resetting to the module default. Omitted rather than rejected when it is
    // not shaped like a chunk: the state is opaque here, so an unrecognised one must
    // not cost the user the whole template. The projection validates it properly.
    const deviceState = isStoredDeviceState(value.deviceState) ? value.deviceState : undefined;

    return {
        id: value.id,
        name: value.name,
        type: value.type,
        bypassed: value.bypassed,
        // A template is the second place stored device parameters come back
        // from, and it predates a declared-unit change the same way a project
        // does. See `StoredDeviceParameterMigration`.
        parameterValues: migrateStoredDeviceParameterValues(value.type, parameterValues),
        externalPluginId: value.externalPluginId,
        externalInstanceId: value.externalInstanceId,
        externalStateChunk: value.externalStateChunk,
        deviceState,
    };
}

function isStoredDeviceState(value: unknown): value is Device['deviceState'] {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return false;
    }
    const candidate: Record<string, unknown> = { ...value };
    return (
        typeof candidate.version === 'number' &&
        Number.isFinite(candidate.version) &&
        typeof candidate.data === 'object' &&
        candidate.data !== null &&
        !Array.isArray(candidate.data)
    );
}

function validateStoredDevices(value: unknown): Device[] | null {
    if (!Array.isArray(value)) {
        return null;
    }

    const devices: Device[] = [];

    for (const deviceValue of value) {
        const device = validateStoredDevice(deviceValue);
        if (device === null) {
            return null;
        }

        devices.push(device);
    }

    return devices;
}

function validateStoredSend(value: unknown): Send | null {
    if (!isRecord(value)) {
        return null;
    }

    if (
        typeof value.busId !== 'string' ||
        typeof value.level !== 'number' ||
        !Number.isFinite(value.level) ||
        typeof value.preFader !== 'boolean'
    ) {
        return null;
    }

    return {
        busId: value.busId,
        level: value.level,
        preFader: value.preFader,
    };
}

function validateStoredSends(value: unknown): Send[] | null {
    if (!Array.isArray(value)) {
        return null;
    }

    const sends: Send[] = [];

    for (const sendValue of value) {
        const send = validateStoredSend(sendValue);
        if (send === null) {
            return null;
        }

        sends.push(send);
    }

    return sends;
}

function validateStoredTrackTemplate(value: unknown): TrackTemplate | null {
    if (!isRecord(value)) {
        return null;
    }

    const devices = validateStoredDevices(value.devices);
    const sends = validateStoredSends(value.sends);

    if (
        typeof value.id !== 'string' ||
        typeof value.name !== 'string' ||
        typeof value.category !== 'string' ||
        !isTrackKind(value.trackKind) ||
        devices === null ||
        sends === null ||
        typeof value.gain !== 'number' ||
        !Number.isFinite(value.gain) ||
        typeof value.pan !== 'number' ||
        !Number.isFinite(value.pan) ||
        typeof value.color !== 'string' ||
        typeof value.createdAt !== 'number' ||
        !Number.isFinite(value.createdAt)
    ) {
        return null;
    }

    return {
        id: value.id,
        name: value.name,
        category: value.category,
        trackKind: value.trackKind,
        devices,
        sends,
        gain: value.gain,
        pan: value.pan,
        color: value.color,
        createdAt: value.createdAt,
    };
}

function validateStoredTrackTemplates(value: unknown): TrackTemplate[] {
    if (!Array.isArray(value)) {
        return [];
    }

    const templates: TrackTemplate[] = [];

    for (const templateValue of value) {
        const template = validateStoredTrackTemplate(templateValue);
        if (template !== null) {
            templates.push(template);
        }
    }

    return templates;
}

export function loadTrackTemplates(): TrackTemplate[] {
    return validateStoredTrackTemplates(storage.get());
}
