import { notifyUser } from '#/utils/Notification/notifyUser';

import { type ControllerMapping } from '../../models/ControllerProfile';
import { hardwareControllerStore } from '../../stores/hardwareControllerStore';

const VALID_CONTROL_TYPES: ReadonlySet<string> = new Set<ControllerMapping['controlType']>([
    'pad',
    'knob',
    'fader',
    'button',
]);
const VALID_ACTION_TYPES: ReadonlySet<string> = new Set<ControllerMapping['action']['type']>([
    'parameter',
    'transport',
    'workflow',
]);

function isValidControlType(value: unknown): value is ControllerMapping['controlType'] {
    if (typeof value !== 'string') {
        return false;
    }

    return VALID_CONTROL_TYPES.has(value);
}

function isValidActionType(value: unknown): value is ControllerMapping['action']['type'] {
    if (typeof value !== 'string') {
        return false;
    }

    return VALID_ACTION_TYPES.has(value);
}

function isControllerMapping(value: unknown): value is ControllerMapping {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    if (!('id' in value) || typeof value.id !== 'string') {
        return false;
    }
    if (!('controlType' in value) || !isValidControlType(value.controlType)) {
        return false;
    }
    if (!('controlIndex' in value) || typeof value.controlIndex !== 'number') {
        return false;
    }
    if (!('channel' in value) || typeof value.channel !== 'number') {
        return false;
    }
    if (!('action' in value) || typeof value.action !== 'object' || value.action === null) {
        return false;
    }

    const action = value.action;
    if (!('type' in action) || !isValidActionType(action.type)) {
        return false;
    }
    if ('target' in action && action.target !== undefined && typeof action.target !== 'string') {
        return false;
    }
    return true;
}

/**
 * Import hardware mappings from a JSON string (J3).
 *
 * A malformed document or an entry that fails {@link isControllerMapping}
 * surfaces an error notification rather than failing silently, so the user
 * learns the import did nothing instead of assuming it succeeded.
 */
export function importHardwareMappings(profileId: string, json: string): void {
    const state = hardwareControllerStore.value;
    if (!state) {
        return;
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(json);
    } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        notifyUser(`Failed to import hardware mappings: ${detail}`, 'error');
        return;
    }

    if (!Array.isArray(parsed) || !parsed.every(isControllerMapping)) {
        notifyUser('Failed to import hardware mappings: file is not a valid controller mapping list', 'error');
        return;
    }

    if (!state.profiles.some((param) => param.id === profileId)) {
        notifyUser(`Failed to import hardware mappings: unknown profile "${profileId}"`, 'error');
        return;
    }

    const mappings: ControllerMapping[] = parsed;
    hardwareControllerStore.set({
        ...state,
        profiles: state.profiles.map((param) => (param.id === profileId ? { ...param, mappings } : param)),
    });
}
