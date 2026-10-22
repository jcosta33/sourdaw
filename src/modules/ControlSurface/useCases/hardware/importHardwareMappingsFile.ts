import { notifyUser } from '#/utils/Notification/notifyUser';

import { readHardwareMappingsFile } from '../../repositories/readHardwareMappingsFile';
import { hardwareControllerStore } from '../../stores/hardwareControllerStore';

import { importHardwareMappings } from './importHardwareMappings';

// Mapping JSON needs no audio payload; allow large profiles without reading an unbounded file.
const MAX_MAPPING_FILE_BYTES = 16 * 1024 * 1024;

export async function importHardwareMappingsFile(
    profileId: string,
    file: File,
    isCurrent: () => boolean
): Promise<'imported' | 'rejected' | 'cancelled'> {
    if (!isCurrent()) {
        return 'cancelled';
    }
    const profile = hardwareControllerStore.value?.profiles.find((candidate) => candidate.id === profileId);
    if (!profile) {
        notifyUser(`Failed to import hardware mappings: unknown profile "${profileId}"`, 'error');
        return 'rejected';
    }
    if (file.size > MAX_MAPPING_FILE_BYTES) {
        notifyUser('Failed to import hardware mappings: file exceeds the 16 MiB limit', 'error');
        return 'rejected';
    }
    const stillOwnsImport = (): boolean =>
        isCurrent() && hardwareControllerStore.value?.profiles.find((candidate) => candidate.id === profileId) === profile;

    let json: string;
    try {
        json = await readHardwareMappingsFile(file);
    } catch (error) {
        if (!stillOwnsImport()) {
            return 'cancelled';
        }
        const detail = error instanceof Error ? error.message : String(error);
        notifyUser(`Failed to import hardware mappings: ${detail}`, 'error');
        return 'rejected';
    }
    if (!stillOwnsImport()) {
        return 'cancelled';
    }
    return importHardwareMappings(profileId, json) ? 'imported' : 'rejected';
}
