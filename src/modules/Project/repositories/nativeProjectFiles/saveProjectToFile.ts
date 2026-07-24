import { writeFileBytes } from '#/utils/tauriBridge';

import { type ProjectData } from '../../models/ProjectData';

import { isTauriAvailable } from './helpers';

/**
 * Save a project to the native filesystem.
 *
 * @param path - Absolute path to save the .sourdaw file
 * @param projectData - Serialized project state (the same JSON structure used by localStorage)
 */
export async function saveProjectToFile(path: string, projectData: ProjectData): Promise<void> {
    if (!isTauriAvailable()) {
        throw new Error('Tauri not available');
    }
    const json = JSON.stringify(projectData, null, 2);
    const bytes = new TextEncoder().encode(json);
    await writeFileBytes({ path, bytes });
}
