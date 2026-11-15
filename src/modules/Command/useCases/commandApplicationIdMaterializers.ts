import { type AppAction } from '#/utils/handlerContract';

import { COMMAND_APPLICATION_ID_RULES } from '../models/CommandApplicationIdRule';
import { type CommandApplicationAssignedId } from '../models/VersionedCommandEnvelope';

import { commandTrackDefaultsPort } from './commandTrackDefaultsPort';

export type MaterializedCommandApplicationIds = {
    action: AppAction;
    applicationAssignedIds: readonly CommandApplicationAssignedId[];
};

/**
 * Application defaults are drawn from pools shared by the whole session — the next track colour is
 * taken from a palette that advances on every draw. Only a command that can reach the project may
 * draw one; a caller that compiles a command to measure it passes `false` and leaves the pool where
 * it found it.
 */
export type CommandApplicationDefaults = { reserveApplicationDefaults: boolean };

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
    const existingOwnerId = action.payload.midiInputOwnerId;
    if (typeof existingOwnerId === 'string') {
        return { action, applicationAssignedIds: [{ argument: 'midiInputOwnerId', value: existingOwnerId }] };
    }
    if (existingOwnerId !== undefined) {
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

function materializeImportedStemIds(
    action: Extract<AppAction, { type: 'importStemSet' }>
): MaterializedCommandApplicationIds {
    const applicationAssignedIds: CommandApplicationAssignedId[] = [
        { argument: 'folderId', value: action.payload.folderId },
    ];
    if (action.payload.folderAlternativeId) {
        applicationAssignedIds.push({
            argument: 'folderAlternativeId',
            value: action.payload.folderAlternativeId,
        });
    }
    for (const [index, stem] of action.payload.stems.entries()) {
        applicationAssignedIds.push(
            { argument: `stems[${String(index)}].trackId`, value: stem.trackId },
            { argument: `stems[${String(index)}].clipId`, value: stem.clipId }
        );
        if (stem.trackAlternativeId) {
            applicationAssignedIds.push({
                argument: `stems[${String(index)}].trackAlternativeId`,
                value: stem.trackAlternativeId,
            });
        }
    }
    return { action, applicationAssignedIds };
}

function materializeTrackCreationIds(
    action: Extract<AppAction, { type: 'addTrack' }>,
    defaults: CommandApplicationDefaults
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
    if (cloned.payload.color === undefined && defaults.reserveApplicationDefaults) {
        const color = commandTrackDefaultsPort.reserveTrackColor();
        if (color !== undefined) {
            cloned.payload.color = color;
            changed = true;
        }
    }
    return { action: changed ? cloned : action, applicationAssignedIds };
}

function materializeBusCreationIds(
    action: Extract<AppAction, { type: 'createBus' }>,
    defaults: CommandApplicationDefaults
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
    if (cloned.payload.color === undefined && defaults.reserveApplicationDefaults) {
        const color = commandTrackDefaultsPort.reserveTrackColor();
        if (color !== undefined) {
            cloned.payload.color = color;
            changed = true;
        }
    }
    return { action: changed ? cloned : action, applicationAssignedIds };
}

function materializeByIdRule(action: AppAction): MaterializedCommandApplicationIds {
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

export const commandApplicationIdMaterializers = {
    nestedNotes: materializeNestedNoteIds,
    midiInputOwner: materializeMidiInputOwnerId,
    importedStems: materializeImportedStemIds,
    trackCreation: materializeTrackCreationIds,
    busCreation: materializeBusCreationIds,
    byIdRule: materializeByIdRule,
};
