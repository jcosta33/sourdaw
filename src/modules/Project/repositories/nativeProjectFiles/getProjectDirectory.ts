import { tauriInvoke } from './helpers';

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
