import { type AppAction } from '#/utils/handlerContract';

import {
    type CommandApplicationDefaults,
    type MaterializedCommandApplicationIds,
} from '../models/MaterializedCommandApplicationIds';
import { type CommandApplicationAssignedId } from '../models/VersionedCommandEnvelope';

import { commandTrackDefaultsPort } from './commandTrackDefaultsPort';

export function materializeTrackCreationIds(
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
