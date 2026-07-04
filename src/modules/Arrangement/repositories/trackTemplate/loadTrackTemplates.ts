import { type TrackKind } from '../../models/Track';
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

function isTrackTemplateDevices(value: unknown): value is TrackTemplate['devices'] {
    return Array.isArray(value);
}

function isTrackTemplateSends(value: unknown): value is TrackTemplate['sends'] {
    return Array.isArray(value);
}

function validateStoredTrackTemplate(value: unknown): TrackTemplate | null {
    if (!isRecord(value)) {
        return null;
    }

    if (
        typeof value.id !== 'string' ||
        typeof value.name !== 'string' ||
        typeof value.category !== 'string' ||
        !isTrackKind(value.trackKind) ||
        !isTrackTemplateDevices(value.devices) ||
        !isTrackTemplateSends(value.sends) ||
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
        devices: value.devices,
        sends: value.sends,
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
