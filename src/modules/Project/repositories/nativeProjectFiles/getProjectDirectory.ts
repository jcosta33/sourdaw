import { tauriInvoke } from './tauriInvoke';

/**
 * Get the default project directory path.
 *
 * Creates the directory only when it does not already exist. A plain "get" must
 * not write on every call: importing this module or calling it in a read-only
 * context (e.g. a CI temp dir) used to drop a hidden `.sourdaw-projects` marker
 * file as an unconditional side effect. We now probe for the directory first and
 * only create it on demand.
 */
export async function getProjectDirectory(): Promise<string> {
    // Use platform-appropriate documents directory
    const homeDir = await tauriInvoke<string>('get_home_dir').catch(() => '/tmp');
    const projectDir = `${homeDir}/Documents/Sourdaw Projects`;

    // Probe for the directory; `list_directory` rejects when it is absent.
    const exists = await tauriInvoke('list_directory', { path: projectDir }).then(
        () => true,
        () => false
    );
    if (exists) {
        return projectDir;
    }

    // Create on demand by writing a hidden marker (the write also creates the
    // parent directory).
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
