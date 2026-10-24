import { notifyUser } from '#/utils/Notification/notifyUser';

import { downloadHardwareMappingsFile } from '../../repositories/downloadHardwareMappingsFile';

import { exportHardwareMappings } from './exportHardwareMappings';

export function downloadHardwareMappings(profileId: string): boolean {
    try {
        const json = exportHardwareMappings(profileId);
        if (json === null) {
            notifyUser(`Failed to export hardware mappings: unknown profile "${profileId}"`, 'error');
            return false;
        }
        downloadHardwareMappingsFile(json, `${encodeURIComponent(profileId)}-mappings.json`);
        return true;
    } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        notifyUser(`Failed to export hardware mappings: ${detail}`, 'error');
        return false;
    }
}
