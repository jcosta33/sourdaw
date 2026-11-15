import { revokePluginFolderGrant } from '../../../repositories/pluginBridge/revokePluginFolderGrant';
import { pluginScanStore } from '../../../stores/pluginScanStore';

import { getState } from './helpers';
import { refreshPluginFolderGrants } from './refreshPluginFolderGrants';

export type RemovePluginFolderOutcome = { removed: true } | { removed: false; reason: string };

/** Whether `path` is `folder` itself or lies inside it, on either separator. */
function isWithinFolder(path: string, folder: string): boolean {
    if (path === folder) {
        return true;
    }
    if (folder.endsWith('/') || folder.endsWith('\\')) {
        return path.startsWith(folder);
    }
    return path.startsWith(`${folder}/`) || path.startsWith(`${folder}\\`);
}

/**
 * Withdraw a plugin folder grant and drop the plugins found under it.
 *
 * The plugins go with the folder because nothing will rescan them: a scan
 * no longer reaches the folder, so a row left behind would be a plugin the
 * browser offers and the host can no longer be asked about. A sibling that
 * only shares a name prefix (`Plugins-old` beside `Plugins`) is not inside
 * the folder and stays.
 */
export async function removePluginFolder(folder: string): Promise<RemovePluginFolderOutcome> {
    try {
        await revokePluginFolderGrant(folder);
    } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        return { removed: false, reason: `Could not remove ${folder}: ${detail}` };
    }

    const refresh = await refreshPluginFolderGrants();
    const state = getState();
    pluginScanStore.set({
        ...state,
        // The revoke succeeded, so the folder is gone whether or not the
        // refresh could restate the rest of the list.
        grantedFolders: refresh.refreshed
            ? state.grantedFolders
            : state.grantedFolders.filter((granted) => granted.path !== folder),
        scannedPlugins: state.scannedPlugins.filter((plugin) => !isWithinFolder(plugin.path, folder)),
    });
    return { removed: true };
}
