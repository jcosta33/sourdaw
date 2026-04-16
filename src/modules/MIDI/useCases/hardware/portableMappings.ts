import { hardwareControllerStore } from '../../stores/hardwareControllerStore';
import { type ControllerMapping } from '../../models/ControllerProfile';

/**
 * Export current hardware mappings as a JSON string (J3).
 */
export function exportHardwareMappings(profileId: string): string | null {
    const state = hardwareControllerStore.value;
    const profile = state?.profiles.find((p) => p.id === profileId);
    if (!profile) return null;

    return JSON.stringify(profile.mappings, null, 2);
}

/**
 * Import hardware mappings from a JSON string (J3).
 */
export function importHardwareMappings(profileId: string, json: string): void {
    const state = hardwareControllerStore.value;
    if (!state) return;

    try {
        const mappings = JSON.parse(json) as ControllerMapping[];
        hardwareControllerStore.set({
            ...state,
            profiles: state.profiles.map((p) =>
                p.id === profileId ? { ...p, mappings } : p
            ),
        });
    } catch (e) {
        console.error('Failed to import hardware mappings:', e);
    }
}
