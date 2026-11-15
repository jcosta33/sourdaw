import { revokePluginFolderGrant } from '../../../repositories/pluginBridge/revokePluginFolderGrant';
import { type GrantedPluginFolder, pluginScanStore } from '../../../stores/pluginScanStore';

import { getState, isWithinFolder } from './helpers';
import { refreshPluginFolderGrants } from './refreshPluginFolderGrants';

export type RemovePluginFolderOutcome = { removed: true } | { removed: false; reason: string };

/**
 * The folder list once `folder` is revoked. A successful refresh already
 * restated the list; otherwise the revoke still succeeded, so the folder is
 * gone even though the rest of the list could not be restated.
 */
function foldersAfterRevoke(
    grantedFolders: GrantedPluginFolder[],
    folder: string,
    refreshed: boolean
): GrantedPluginFolder[] {
    if (refreshed) {
        return grantedFolders;
    }
    return grantedFolders.filter((granted) => granted.path !== folder);
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
        grantedFolders: foldersAfterRevoke(state.grantedFolders, folder, refresh.refreshed),
        scannedPlugins: state.scannedPlugins.filter((plugin) => !isWithinFolder(plugin.path, folder)),
    });
    return { removed: true };
}
