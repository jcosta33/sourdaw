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
