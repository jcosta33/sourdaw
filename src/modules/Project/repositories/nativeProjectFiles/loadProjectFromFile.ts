import { type ProjectData } from '#/modules/Project/models/ProjectData';
import { tauriInvoke } from './helpers';

/**
 * Load a project from the native filesystem.
 *
 * @param path - Absolute path to the .sourdaw file
 * @returns Parsed project state
 */
export async function loadProjectFromFile(path: string): Promise<ProjectData> {
    const bytes = await tauriInvoke<number[]>('read_audio_file', { path });
    const decoder = new TextDecoder();
    const json = decoder.decode(new Uint8Array(bytes));
    return JSON.parse(json) as ProjectData;
}