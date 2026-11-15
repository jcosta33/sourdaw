import { desktopInvoke, isDesktopRuntime } from '#/utils/desktopBridge';

import { type PluginFolderGrant } from './types';

/** The plugin folders the user granted. Outside the desktop app there are none. */
export async function getPluginFolderGrants(): Promise<PluginFolderGrant[]> {
    if (!isDesktopRuntime()) {
        return [];
    }
    return desktopInvoke('get_plugin_folder_grants') as Promise<PluginFolderGrant[]>;
}
