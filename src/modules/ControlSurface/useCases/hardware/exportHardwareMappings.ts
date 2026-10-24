import { hardwareControllerStore } from '../../stores/hardwareControllerStore';

/**
 * Export current hardware mappings as a JSON string (J3).
 * Preserve the legacy bare mapping array, distinct from versioned binding bundles.
 */
export function exportHardwareMappings(profileId: string): string | null {
    const state = hardwareControllerStore.value;
    const profile = state?.profiles.find((param) => param.id === profileId);
    if (!profile) {
        return null;
    }

    return JSON.stringify(profile.mappings, null, 2);
}
