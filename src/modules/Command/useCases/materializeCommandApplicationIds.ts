import { type AppAction, type AppActionType } from '#/utils/handlerContract';

import { type CommandApplicationAssignedId } from '../models/VersionedCommandEnvelope';

type MaterializedCommandApplicationIds = {
    action: AppAction;
    applicationAssignedIds: readonly CommandApplicationAssignedId[];
};

type ApplicationIdRule = {
    argument: string;
    prefix: string;
};

const APPLICATION_ID_RULES: Partial<Record<AppActionType, ApplicationIdRule>> = {
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
    if (action.payload.notes.every((note) => typeof note.id === 'string' && note.id !== '')) {
        return { action, applicationAssignedIds: [] };
    }

    const cloned = structuredClone(action);
    const applicationAssignedIds: CommandApplicationAssignedId[] = [];
    for (const [index, note] of cloned.payload.notes.entries()) {
        if (typeof note.id === 'string' && note.id !== '') {
            continue;
        }
        const value = `note-command-${crypto.randomUUID()}`;
        note.id = value;
        applicationAssignedIds.push({ argument: `notes[${String(index)}].id`, value });
    }
    return { action: cloned, applicationAssignedIds };
}

function materializeMidiInputOwnerId(
    action: Extract<AppAction, { type: 'armTrack' }>
): MaterializedCommandApplicationIds {
    if (action.payload.midiInputOwnerId !== undefined) {
        return { action, applicationAssignedIds: [] };
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
    if (!cloned.payload.id) {
        cloned.payload.id = `track-command-${crypto.randomUUID()}`;
        applicationAssignedIds.push({ argument: 'id', value: cloned.payload.id });
    }
    if (!cloned.payload.initialAlternativeId) {
        cloned.payload.initialAlternativeId = `alternative-command-${crypto.randomUUID()}`;
        applicationAssignedIds.push({
            argument: 'initialAlternativeId',
            value: cloned.payload.initialAlternativeId,
        });
    }
    if (cloned.payload.kind === 'midi' && !cloned.payload.initialDeviceId) {
        cloned.payload.initialDeviceId = `device-command-${crypto.randomUUID()}`;
        applicationAssignedIds.push({ argument: 'initialDeviceId', value: cloned.payload.initialDeviceId });
    }
    return applicationAssignedIds.length === 0
        ? { action, applicationAssignedIds }
        : { action: cloned, applicationAssignedIds };
}

function materializeBusCreationIds(
    action: Extract<AppAction, { type: 'createBus' }>
): MaterializedCommandApplicationIds {
    const cloned = structuredClone(action);
    const applicationAssignedIds: CommandApplicationAssignedId[] = [];
    if (!cloned.payload.busId) {
        cloned.payload.busId = `bus-command-${crypto.randomUUID()}`;
        applicationAssignedIds.push({ argument: 'busId', value: cloned.payload.busId });
    }
    if (!cloned.payload.initialAlternativeId) {
        cloned.payload.initialAlternativeId = `alternative-command-${crypto.randomUUID()}`;
        applicationAssignedIds.push({
            argument: 'initialAlternativeId',
            value: cloned.payload.initialAlternativeId,
        });
    }
    return applicationAssignedIds.length === 0
        ? { action, applicationAssignedIds }
        : { action: cloned, applicationAssignedIds };
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

    const rule = APPLICATION_ID_RULES[action.type];
    const payload: unknown = 'payload' in action ? action.payload : undefined;
    if (!rule || !isRecord(payload)) {
        return { action, applicationAssignedIds: [] };
    }
    if (typeof payload[rule.argument] === 'string' && payload[rule.argument] !== '') {
        return { action, applicationAssignedIds: [] };
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
