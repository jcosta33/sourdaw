import { desktopAddPluginFolder, isDesktopRuntime } from '#/utils/desktopBridge';

import { type PluginFolderAddResult } from './types';

/**
 * Ask the desktop shell to pick a folder and grant it as a plugin scan root.
 *
 * No path is sent: the shell grants only the folder its own picker returned.
 * Outside the desktop app there is no native scan to grant a root to.
 */
export async function addPluginFolder(): Promise<PluginFolderAddResult> {
    if (!isDesktopRuntime()) {
        return { status: 'refused', reason: 'Plugin folders can be added only in the desktop app.' };
    }
    return desktopAddPluginFolder();
}
