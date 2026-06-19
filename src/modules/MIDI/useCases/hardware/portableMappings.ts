import { notifyUser } from '#/utils/Notification/notifyUser';

import { type ControllerMapping } from '../../models/ControllerProfile';
import { hardwareControllerStore } from '../../stores/hardwareControllerStore';

/**
 * Export current hardware mappings as a JSON string (J3).
 */
export function exportHardwareMappings(profileId: string): string | null {
    const state = hardwareControllerStore.value;
    const profile = state?.profiles.find((param) => param.id === profileId);
    if (!profile) {
        return null;
    }

    return JSON.stringify(profile.mappings, null, 2);
}

const VALID_CONTROL_TYPES: ReadonlySet<ControllerMapping['controlType']> = new Set(['pad', 'knob', 'fader', 'button']);
const VALID_ACTION_TYPES: ReadonlySet<ControllerMapping['action']['type']> = new Set([
    'parameter',
    'transport',
    'workflow',
]);

function isControllerMapping(value: unknown): value is ControllerMapping {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const entry = value as Record<string, unknown>;

    if (typeof entry.id !== 'string') {
        return false;
    }
    if (
        typeof entry.controlType !== 'string' ||
        !VALID_CONTROL_TYPES.has(entry.controlType as ControllerMapping['controlType'])
    ) {
        return false;
    }
    if (typeof entry.controlIndex !== 'number' || typeof entry.channel !== 'number') {
        return false;
    }
    if (typeof entry.action !== 'object' || entry.action === null) {
        return false;
    }
    const action = entry.action as Record<string, unknown>;
    if (
        typeof action.type !== 'string' ||
        !VALID_ACTION_TYPES.has(action.type as ControllerMapping['action']['type'])
    ) {
        return false;
    }
    if (action.target !== undefined && typeof action.target !== 'string') {
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

    const mappings: ControllerMapping[] = parsed;
    hardwareControllerStore.set({
        ...state,
        profiles: state.profiles.map((param) => (param.id === profileId ? { ...param, mappings } : param)),
    });
}
