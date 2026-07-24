import { readFileBytes } from '#/utils/tauriBridge';

import { type ProjectData } from '../../models/ProjectData';

import { isTauriAvailable } from './helpers';

/**
 * Load a project from the native filesystem.
 *
 * @param path - Absolute path to the .sourdaw file
 * @returns Parsed project state
 */
export async function loadProjectFromFile(path: string): Promise<ProjectData> {
    if (!isTauriAvailable()) {
        throw new Error('Tauri not available');
    }
    const bytes = await readFileBytes({ path });
    const json = new TextDecoder().decode(bytes);
    return JSON.parse(json) as ProjectData;
}
