import { desktopInvoke } from './desktopInvoke';

/**
 * List project files in a directory.
 *
 * @param dirPath - Directory to scan
 * @returns Array of .sourdaw file paths
 */
export async function listProjectFiles(dirPath: string): Promise<Array<{ name: string; path: string }>> {
    const entries = await desktopInvoke<Array<{ name: string; path: string; is_directory: boolean }>>('list_directory', {
        path: dirPath,
    });
    return entries
        .filter((event) => !event.is_directory && event.name.endsWith('.sourdaw'))
        .map((event) => ({ name: event.name, path: event.path }));
}
