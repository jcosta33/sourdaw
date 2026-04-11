import { type ProjectData } from '#/modules/Project/models/ProjectData';
import { tauriInvoke } from './helpers';

/**
 * Save a project to the native filesystem.
 *
 * @param path - Absolute path to save the .sourdaw file
 * @param projectData - Serialized project state (the same JSON structure used by localStorage)
 */
export async function saveProjectToFile(path: string, projectData: ProjectData): Promise<void> {
    const json = JSON.stringify(projectData, null, 2);
    const encoder = new TextEncoder();
    const bytes = Array.from(encoder.encode(json));
    await tauriInvoke('write_audio_file', { path, data: bytes });
}