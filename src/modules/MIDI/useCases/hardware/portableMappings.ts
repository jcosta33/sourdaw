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

/**
 * Import hardware mappings from a JSON string (J3).
 */
export function importHardwareMappings(profileId: string, json: string): void {
    const state = hardwareControllerStore.value;
    if (!state) {
        return;
    }

    try {
        const parsed: unknown = JSON.parse(json);
        if (!Array.isArray(parsed)) {
            return;
        }
        const VALID_CONTROL_TYPES = ['pad', 'knob', 'fader', 'button'];
        const VALID_ACTION_TYPES = ['parameter', 'transport', 'workflow'];
        for (const entry of parsed) {
            if (
                typeof entry !== 'object' ||
                entry === null ||
                !VALID_CONTROL_TYPES.includes((entry as Record<string, unknown>).controlType as string) ||
                typeof (entry as Record<string, unknown>).controlIndex !== 'number' ||
                typeof (entry as Record<string, unknown>).channel !== 'number' ||
                typeof (entry as Record<string, unknown>).action !== 'object' ||
                (entry as Record<string, unknown>).action === null ||
                !VALID_ACTION_TYPES.includes(
                    ((entry as Record<string, unknown>).action as Record<string, unknown>).type as string
                )
            ) {
                return;
            }
        }
        const mappings = parsed as ControllerMapping[];
        hardwareControllerStore.set({
            ...state,
            profiles: state.profiles.map((param) => (param.id === profileId ? { ...param, mappings } : param)),
        });
    } catch (error) {
        console.error('Failed to import hardware mappings:', error);
    }
}
