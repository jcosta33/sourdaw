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

function isValidId(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0 && value.trim() === value;
}

function isMidiValue(value: unknown, minimum: number, maximum: number): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value >= minimum && value <= maximum;
}

function isValidAction(value: unknown): value is ControllerMapping['action'] {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    if (!('type' in value) || !isValidActionType(value.type)) {
        return false;
    }
    return !('target' in value) || value.target === undefined || typeof value.target === 'string';
}

function isControllerMapping(value: unknown): value is ControllerMapping {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    if (!('id' in value) || !isValidId(value.id)) {
        return false;
    }
    if (!('controlType' in value) || !isValidControlType(value.controlType)) {
        return false;
    }
    if (!('controlIndex' in value) || !isMidiValue(value.controlIndex, 0, 127)) {
        return false;
    }
    if (!('channel' in value) || !isMidiValue(value.channel, 1, 16)) {
        return false;
    }
    if (!('action' in value) || !isValidAction(value.action)) {
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
export function importHardwareMappings(profileId: string, json: string): boolean {
    const state = hardwareControllerStore.value;
    if (!state) {
        return false;
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(json);
    } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        notifyUser(`Failed to import hardware mappings: ${detail}`, 'error');
        return false;
    }

    if (!Array.isArray(parsed) || !parsed.every(isControllerMapping)) {
        notifyUser('Failed to import hardware mappings: file is not a valid controller mapping list', 'error');
        return false;
    }

    if (new Set(parsed.map((mapping) => mapping.id)).size !== parsed.length) {
        notifyUser('Failed to import hardware mappings: mapping IDs must be unique', 'error');
        return false;
    }

    if (!state.profiles.some((param) => param.id === profileId)) {
        notifyUser(`Failed to import hardware mappings: unknown profile "${profileId}"`, 'error');
        return false;
    }

    const mappings: ControllerMapping[] = parsed;
    hardwareControllerStore.set({
        ...state,
        profiles: state.profiles.map((param) => (param.id === profileId ? { ...param, mappings } : param)),
    });
    return true;
}
