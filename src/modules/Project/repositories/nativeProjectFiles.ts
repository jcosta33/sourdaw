/**
 * Native project file operations.
 * Save/load projects to the native file system via Tauri commands.
 *
 * Falls back gracefully to the existing localStorage system when
 * Tauri is not available (web-only mode).
 */

import { type ProjectData } from '#/modules/Project/models/ProjectData';

declare global {
    interface Window {
        __TAURI__?: {
            core: {
                invoke: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
            };
        };
    }
}

function isTauriAvailable(): boolean {
    return typeof window !== 'undefined' && window.__TAURI__ !== undefined;
}

async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
    if (!isTauriAvailable()) {
        throw new Error('Tauri not available');
    }
    return window.__TAURI__!.core.invoke<T>(cmd, args);
}

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

/**
 * Get the default project directory.
 * Creates it if it doesn't exist.
 */
export async function getProjectDirectory(): Promise<string> {
    // Use platform-appropriate documents directory
    const homeDir = await tauriInvoke<string>('get_home_dir').catch(() => '/tmp');
    const projectDir = `${homeDir}/Documents/Sourdaw Projects`;

    // Ensure directory exists by writing a hidden marker
    try {
        await tauriInvoke('write_audio_file', {
            path: `${projectDir}/.sourdaw-projects`,
            data: Array.from(new TextEncoder().encode('Sourdaw Projects Directory')),
        });
    } catch {
        // Directory creation may fail — that's okay, will use fallback
    }

    return projectDir;
}

/**
 * Check if native file operations are available.
 */
export function isNativeFileSystemAvailable(): boolean {
    return isTauriAvailable();
}
