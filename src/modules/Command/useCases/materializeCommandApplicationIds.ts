import { type AppAction, type AppActionType } from '#/utils/handlerContract';

import { type CommandApplicationAssignedId } from '../models/VersionedCommandEnvelope';

import { commandTrackDefaultsPort } from './commandTrackDefaultsPort';

type MaterializedCommandApplicationIds = {
    action: AppAction;
    applicationAssignedIds: readonly CommandApplicationAssignedId[];
};

type ApplicationIdRule = {
    argument: string;
    prefix: string;
};

export const COMMAND_APPLICATION_ID_RULES: Partial<Record<AppActionType, ApplicationIdRule>> = {
    addAdjustmentRegion: { argument: 'regionId', prefix: 'adjustment-region-command-' },
    addAutomationLane: { argument: 'laneId', prefix: 'automation-command-' },
    addAutomationPoint: { argument: 'pointId', prefix: 'automation-point-command-' },
    addChordEvent: { argument: 'eventId', prefix: 'chord-command-' },
    addClip: { argument: 'id', prefix: 'clip-command-' },
    addDevice: { argument: 'deviceId', prefix: 'device-command-' },
    addMarker: { argument: 'markerId', prefix: 'marker-command-' },
    addSection: { argument: 'sectionId', prefix: 'section-command-' },
    addSidechainRoute: { argument: 'routeId', prefix: 'sidechain-command-' },
    addTrack: { argument: 'id', prefix: 'track-command-' },
    createAdjustmentLayer: { argument: 'layerId', prefix: 'adjustment-layer-command-' },
    createBus: { argument: 'busId', prefix: 'bus-command-' },
    createTrackAlternative: { argument: 'alternativeId', prefix: 'alternative-command-' },
    createVcaGroup: { argument: 'vcaGroupId', prefix: 'vca-command-' },
    duplicateClip: { argument: 'targetClipId', prefix: 'clip-command-' },
    duplicateClipToNextBar: { argument: 'targetClipId', prefix: 'clip-command-' },
    duplicateTrack: { argument: 'targetTrackId', prefix: 'track-command-' },
    splitClip: { argument: 'rightClipId', prefix: 'clip-command-' },
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function materializeNestedNoteIds(action: Extract<AppAction, { type: 'addNotes' }>): MaterializedCommandApplicationIds {
    const cloned = structuredClone(action);
    const applicationAssignedIds: CommandApplicationAssignedId[] = [];
    let changed = false;
    for (const [index, note] of cloned.payload.notes.entries()) {
        if (typeof note.id === 'string' && note.id !== '') {
            applicationAssignedIds.push({ argument: `notes[${String(index)}].id`, value: note.id });
            continue;
        }
        const value = `note-command-${crypto.randomUUID()}`;
        note.id = value;
        changed = true;
        applicationAssignedIds.push({ argument: `notes[${String(index)}].id`, value });
    }
    return { action: changed ? cloned : action, applicationAssignedIds };
}

function materializeMidiInputOwnerId(
    action: Extract<AppAction, { type: 'armTrack' }>
): MaterializedCommandApplicationIds {
    if (action.payload.midiInputOwnerId !== undefined) {
        return {
            action,
            applicationAssignedIds:
                typeof action.payload.midiInputOwnerId === 'string'
                    ? [{ argument: 'midiInputOwnerId', value: action.payload.midiInputOwnerId }]
                    : [],
        };
    }
    const cloned = structuredClone(action);
    const value = `arm-command-${crypto.randomUUID()}`;
    cloned.payload.midiInputOwnerId = value;
    return {
        action: cloned,
        applicationAssignedIds: [{ argument: 'midiInputOwnerId', value }],
    };
}

function materializeTrackCreationIds(
    action: Extract<AppAction, { type: 'addTrack' }>
): MaterializedCommandApplicationIds {
    const cloned = structuredClone(action);
    const applicationAssignedIds: CommandApplicationAssignedId[] = [];
    let changed = false;
    if (!cloned.payload.id) {
        cloned.payload.id = `track-command-${crypto.randomUUID()}`;
        changed = true;
        applicationAssignedIds.push({ argument: 'id', value: cloned.payload.id });
    }
    if (cloned.payload.id && !applicationAssignedIds.some((entry) => entry.argument === 'id')) {
        applicationAssignedIds.push({ argument: 'id', value: cloned.payload.id });
    }
    if (!cloned.payload.initialAlternativeId) {
        cloned.payload.initialAlternativeId = `alternative-command-${crypto.randomUUID()}`;
        changed = true;
        applicationAssignedIds.push({
            argument: 'initialAlternativeId',
            value: cloned.payload.initialAlternativeId,
        });
    }
    if (
        cloned.payload.initialAlternativeId &&
        !applicationAssignedIds.some((entry) => entry.argument === 'initialAlternativeId')
    ) {
        applicationAssignedIds.push({
            argument: 'initialAlternativeId',
            value: cloned.payload.initialAlternativeId,
        });
    }
    if (cloned.payload.kind === 'midi' && !cloned.payload.initialDeviceId) {
        cloned.payload.initialDeviceId = `device-command-${crypto.randomUUID()}`;
        changed = true;
        applicationAssignedIds.push({ argument: 'initialDeviceId', value: cloned.payload.initialDeviceId });
    }
    if (
        cloned.payload.kind === 'midi' &&
        cloned.payload.initialDeviceId &&
        !applicationAssignedIds.some((entry) => entry.argument === 'initialDeviceId')
    ) {
        applicationAssignedIds.push({ argument: 'initialDeviceId', value: cloned.payload.initialDeviceId });
    }
    if (cloned.payload.color === undefined) {
        const color = commandTrackDefaultsPort.reserveTrackColor();
        if (color !== undefined) {
            cloned.payload.color = color;
            changed = true;
        }
    }
    return { action: changed ? cloned : action, applicationAssignedIds };
}

function materializeBusCreationIds(
    action: Extract<AppAction, { type: 'createBus' }>
): MaterializedCommandApplicationIds {
    const cloned = structuredClone(action);
    const applicationAssignedIds: CommandApplicationAssignedId[] = [];
    let changed = false;
    if (!cloned.payload.busId) {
        cloned.payload.busId = `bus-command-${crypto.randomUUID()}`;
        changed = true;
        applicationAssignedIds.push({ argument: 'busId', value: cloned.payload.busId });
    }
    if (cloned.payload.busId && !applicationAssignedIds.some((entry) => entry.argument === 'busId')) {
        applicationAssignedIds.push({ argument: 'busId', value: cloned.payload.busId });
    }
    if (!cloned.payload.initialAlternativeId) {
        cloned.payload.initialAlternativeId = `alternative-command-${crypto.randomUUID()}`;
        changed = true;
        applicationAssignedIds.push({
            argument: 'initialAlternativeId',
            value: cloned.payload.initialAlternativeId,
        });
    }
    if (
        cloned.payload.initialAlternativeId &&
        !applicationAssignedIds.some((entry) => entry.argument === 'initialAlternativeId')
    ) {
        applicationAssignedIds.push({
            argument: 'initialAlternativeId',
            value: cloned.payload.initialAlternativeId,
        });
    }
    if (cloned.payload.color === undefined) {
        const color = commandTrackDefaultsPort.reserveTrackColor();
        if (color !== undefined) {
            cloned.payload.color = color;
            changed = true;
        }
    }
    return { action: changed ? cloned : action, applicationAssignedIds };
}

export function materializeCommandApplicationIds(action: AppAction): MaterializedCommandApplicationIds {
    if (action.type === 'addNotes') {
        return materializeNestedNoteIds(action);
    }
    if (action.type === 'armTrack') {
        return materializeMidiInputOwnerId(action);
    }
    if (action.type === 'addTrack') {
        return materializeTrackCreationIds(action);
    }
    if (action.type === 'createBus') {
        return materializeBusCreationIds(action);
    }

    const rule = COMMAND_APPLICATION_ID_RULES[action.type];
    const payload: unknown = 'payload' in action ? action.payload : undefined;
    if (!rule || !isRecord(payload)) {
        return { action, applicationAssignedIds: [] };
    }
    const existingValue = payload[rule.argument];
    if (typeof existingValue === 'string' && existingValue !== '') {
        return {
            action,
            applicationAssignedIds: [{ argument: rule.argument, value: existingValue }],
        };
    }

    const cloned = structuredClone(action);
    const clonedPayload: unknown = 'payload' in cloned ? cloned.payload : undefined;
    if (!isRecord(clonedPayload)) {
        return { action, applicationAssignedIds: [] };
    }
    const value = `${rule.prefix}${crypto.randomUUID()}`;
    clonedPayload[rule.argument] = value;
    return {
        action: cloned,
        applicationAssignedIds: [{ argument: rule.argument, value }],
    };
}
