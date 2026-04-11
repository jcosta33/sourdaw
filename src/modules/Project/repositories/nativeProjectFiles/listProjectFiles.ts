import { tauriInvoke } from './helpers';

/**
 * List project files in a directory.
 *
 * @param dirPath - Directory to scan
 * @returns Array of .sourdaw file paths
 */
export async function listProjectFiles(dirPath: string): Promise<Array<{ name: string; path: string }>> {
    const entries = await tauriInvoke<Array<{ name: string; path: string; is_directory: boolean }>>('list_directory', {
        path: dirPath,
    });
    return entries
        .filter((e) => !e.is_directory && e.name.endsWith('.sourdaw'))
        .map((e) => ({ name: e.name, path: e.path }));
}